-- ============================================================================
-- Enséñame Ya — US-1001 (SCR-TU09): saldo del tutor para su dashboard.
-- Lectura agregada por MONEDA: disponible (liquidable ya), en retención (aún
-- no), y ya pagado. Es RPC para no duplicar en JS la lógica de elegibilidad de
-- `build_payout_for_tutor` (misma definición de "liquidable" → una sola fuente).
-- SECURITY DEFINER pero solo mira lo del propio tutor (auth.uid()).
-- ============================================================================

create or replace function public.tutor_balance(p_retention_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  return jsonb_build_object(
    -- Disponible: pago 'paid' de reserva completada, retención vencida, no pagado aún.
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select p.currency, sum(p.tutor_net_amount) as total
        from public.payments p
        join public.bookings b on b.id = p.booking_id
        where b.tutor_id = v_uid and p.status = 'paid' and b.status = 'completed'
          and b.completed_at <= v_cutoff
          and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
        group by p.currency
      ) a
    ), '[]'::jsonb),
    -- En retención: liquidable salvo que la retención aún no venció.
    'in_retention', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select p.currency, sum(p.tutor_net_amount) as total
        from public.payments p
        join public.bookings b on b.id = p.booking_id
        where b.tutor_id = v_uid and p.status = 'paid' and b.status = 'completed'
          and b.completed_at > v_cutoff
          and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
        group by p.currency
      ) r
    ), '[]'::jsonb),
    -- Ya pagado: payouts liquidados.
    'paid_out', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select currency, sum(amount) as total
        from public.payouts
        where tutor_id = v_uid and status = 'paid'
        group by currency
      ) pd
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.tutor_balance(int) to authenticated;
