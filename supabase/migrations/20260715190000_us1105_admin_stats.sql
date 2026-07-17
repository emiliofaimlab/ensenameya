-- ============================================================================
-- Enséñame Ya — US-1105 (SCR-AD13): KPIs globales para el admin.
--
-- S-44 propone vistas materializadas "por rendimiento". Es un SUPUESTO, no un
-- requisito, y para el volumen del MVP una agregación en vivo es instantánea.
-- Una matview obligaría a un `pg_cron` de refresco (más piezas, datos con
-- retraso) para resolver un problema que aún no existe. Se queda en función en
-- vivo; el día que el histórico pese, esta misma función se reemplaza por un
-- `select` sobre una matview sin tocar el frontend.
--
-- Es una RPC (no como US-1104, que sumaba en el servidor): aquí agregar es UNA
-- consulta, y traer miles de filas a JS para sumarlas sería absurdo. Cerrada a
-- admin: son cifras de negocio de toda la plataforma.
--
-- Períodos: filtra por `created_at` de cada entidad (consistente con US-1104).
-- El dinero se agrupa por moneda — sumar monedas distintas daría un número sin
-- sentido (RN-13). Hoy todo es USD, pero la función no lo asume.
-- ============================================================================

create or replace function public.admin_stats(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := case when p_from is null then '-infinity'::timestamptz
                             else p_from::timestamptz end;
  -- `to` inclusivo: el admin elige un día, no un instante → +1 día en exclusiva.
  v_to   timestamptz := case when p_to is null then 'infinity'::timestamptz
                             else (p_to + 1)::timestamptz end;
  v_bookings_total int;
  v_bookings_paid  int;
  v_active_tutors  int;
  v_money          jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin ve las estadísticas'
      using errcode = 'insufficient_privilege';
  end if;

  -- Reservas creadas en el período y cuántas llegaron a pagarse (conversión).
  select count(*),
         count(*) filter (
           where exists (
             select 1 from public.payments p
             where p.booking_id = b.id
               and p.status in ('paid', 'partially_refunded', 'refunded')
           )
         )
    into v_bookings_total, v_bookings_paid
  from public.bookings b
  where b.created_at >= v_from and b.created_at < v_to;

  -- Tutores activos = con al menos una reserva en el período (S-44 lo llama así).
  select count(distinct b.tutor_id) into v_active_tutors
  from public.bookings b
  where b.created_at >= v_from and b.created_at < v_to;

  -- Dinero por moneda: GMV (lo que se llegó a cobrar), comisión, neto tutor y
  -- reembolsado. Solo pagos que alcanzaron 'paid' en algún momento cuentan como
  -- GMV; el reembolso se muestra aparte para que el neto sea evidente.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'currency',   currency,
             'gmv',        gmv,
             'commission', commission,
             'tutor_net',  tutor_net,
             'refunded',   refunded
           ) order by currency),
           '[]'::jsonb
         )
    into v_money
  from (
    select p.currency,
           sum(p.gross_amount) filter (where p.status in ('paid','partially_refunded','refunded')) as gmv,
           sum(p.platform_fee_amount) filter (where p.status in ('paid','partially_refunded','refunded')) as commission,
           sum(p.tutor_net_amount) filter (where p.status in ('paid','partially_refunded','refunded')) as tutor_net,
           sum(p.refunded_amount) as refunded
    from public.payments p
    where p.created_at >= v_from and p.created_at < v_to
    group by p.currency
    having sum(p.gross_amount) filter (where p.status in ('paid','partially_refunded','refunded')) is not null
        or sum(p.refunded_amount) > 0
  ) per_currency;

  return jsonb_build_object(
    'bookings_total', v_bookings_total,
    'bookings_paid',  v_bookings_paid,
    'conversion_pct', case when v_bookings_total > 0
                          then round(100.0 * v_bookings_paid / v_bookings_total, 1)
                          else 0 end,
    'active_tutors',  v_active_tutors,
    'money',          v_money
  );
end;
$$;

grant execute on function public.admin_stats(date, date) to authenticated;
