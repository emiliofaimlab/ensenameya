-- ============================================================================
-- US-1502 · Métricas de pago / payout / webhook (EP-15, Doc 6 §6.8/6.13, S-47)
--
-- No hay tabla de métricas ni la va a haber: los tres números salen de las
-- filas que ya existen. Se añaden a `admin_stats`, que es la RPC que AD13 ya
-- llama con el mismo período — una consulta más, no una pantalla más.
--
-- "Latencia de webhook" con lo que hay: `payment_webhook_events` solo guarda
-- `processed_at`, así que no se puede medir el tiempo de PROCESO. Lo que sí se
-- mide, y es lo que importa en soporte, es cuánto tarda un cobro en confirmarse
-- desde que se crea. Y sobre todo el caso feo: pagos cobrados **sin evento**,
-- que significa que el webhook nunca llegó.
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
  v_to   timestamptz := case when p_to is null then 'infinity'::timestamptz
                             else (p_to + 1)::timestamptz end;
  v_bookings_total int;
  v_bookings_paid  int;
  v_active_tutors  int;
  v_money          jsonb;
  v_pay_total      int;
  v_pay_failed     int;
  v_payout_failed  int;
  v_payout_hold    int;
  v_hook_secs      numeric;
  v_hook_missing   int;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin ve las estadísticas'
      using errcode = 'insufficient_privilege';
  end if;

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

  select count(distinct b.tutor_id) into v_active_tutors
  from public.bookings b
  where b.created_at >= v_from and b.created_at < v_to;

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

  -- ── US-1502 ───────────────────────────────────────────────────────────────
  -- 1) Fallo de cobro: de todos los intentos del período, cuántos murieron.
  select count(*), count(*) filter (where p.status = 'failed')
    into v_pay_total, v_pay_failed
  from public.payments p
  where p.created_at >= v_from and p.created_at < v_to;

  -- 2) Payouts en problema. `on_hold` va aparte de `failed`: uno lo paró un
  --    admin a propósito y el otro se rompió solo.
  select count(*) filter (where po.status = 'failed'),
         count(*) filter (where po.status = 'on_hold')
    into v_payout_failed, v_payout_hold
  from public.payouts po
  where po.created_at >= v_from and po.created_at < v_to;

  -- 3) Webhook: mediana de segundos entre crear el pago y procesar su evento, y
  --    cobros SIN evento — el webhook que nunca llegó, que es la primera
  --    pregunta de soporte (misma lógica que el detalle de pago de US-1104).
  select percentile_cont(0.5) within group (
           order by extract(epoch from (w.processed_at - p.created_at))
         )
    into v_hook_secs
  from public.payments p
  join public.payment_webhook_events w on w.booking_id = p.booking_id
  where p.created_at >= v_from and p.created_at < v_to;

  select count(*) into v_hook_missing
  from public.payments p
  where p.created_at >= v_from and p.created_at < v_to
    and p.status in ('paid', 'partially_refunded', 'refunded')
    and not exists (
      select 1 from public.payment_webhook_events w where w.booking_id = p.booking_id
    );

  return jsonb_build_object(
    'bookings_total', v_bookings_total,
    'bookings_paid',  v_bookings_paid,
    'conversion_pct', case when v_bookings_total > 0
                          then round(100.0 * v_bookings_paid / v_bookings_total, 1)
                          else 0 end,
    'active_tutors',  v_active_tutors,
    'money',          v_money,
    'ops', jsonb_build_object(
      'payments_total',      v_pay_total,
      'payments_failed',     v_pay_failed,
      'payment_failure_pct', case when v_pay_total > 0
                                  then round(100.0 * v_pay_failed / v_pay_total, 1)
                                  else 0 end,
      'payouts_failed',      v_payout_failed,
      'payouts_on_hold',     v_payout_hold,
      'webhook_median_secs', round(coalesce(v_hook_secs, 0)),
      'webhook_missing',     v_hook_missing
    )
  );
end;
$$;

grant execute on function public.admin_stats(date, date) to authenticated;
