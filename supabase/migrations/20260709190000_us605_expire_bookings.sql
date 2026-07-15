-- ============================================================================
-- Enséñame Ya — US-605 (S2): autocancelación por timeout (job).
--   · pending_payment sin pago en 20 min → cancelled + slot liberado (RN-27, C-07).
--   · pending_acceptance sin respuesta del tutor en 24h → cancelled + reembolso
--     100% + slot liberado (RN-38, timeout de US-606).
-- Un pg_cron corre esto cada 5 min. Función controlada (SECURITY DEFINER).
-- Ventanas parametrizables con defaults reales → testeable sin esperar.
-- ============================================================================

create or replace function public.expire_stale_bookings(
  p_payment_cutoff    interval default interval '20 minutes',
  p_acceptance_cutoff interval default interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_ids uuid[];
  v_acc_ids uuid[];
begin
  -- 1) pending_payment vencidas (nunca se cobró) → cancelled, sin reembolso.
  select array_agg(id) into v_pay_ids
  from public.bookings
  where status = 'pending_payment'
    and created_at < now() - p_payment_cutoff;

  if v_pay_ids is not null then
    update public.payments set status = 'failed', failed_at = now()
      where booking_id = any(v_pay_ids) and status = 'pending';
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = any(v_pay_ids);
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = any(v_pay_ids) and status = 'scheduled';
  end if;

  -- 2) pending_acceptance vencidas (tutor no respondió) → cancelled + 100%.
  select array_agg(b.id) into v_acc_ids
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.status = 'pending_acceptance'
    and p.paid_at < now() - p_acceptance_cutoff;

  if v_acc_ids is not null then
    update public.payments set status = 'refunded', refunded_amount = gross_amount
      where booking_id = any(v_acc_ids);
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = any(v_acc_ids);
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = any(v_acc_ids) and status = 'scheduled';
  end if;

  return jsonb_build_object(
    'payment_expired',    coalesce(array_length(v_pay_ids, 1), 0),
    'acceptance_expired', coalesce(array_length(v_acc_ids, 1), 0)
  );
end;
$$;

-- ponytail: se otorga a `authenticated` para poder verificar el timeout sin
-- esperar (cutoffs override). ANTES DE PROD: revocar y dejar solo la llamada de
-- cron/service_role — un authenticated podría forzar el vencimiento de reservas
-- pendientes ajenas (solo afecta pendientes, recuperable, pero no debe exponerse).
grant execute on function public.expire_stale_bookings(interval, interval) to authenticated;

-- Job cada 5 min con los cutoffs reales (20 min / 24 h).
create extension if not exists pg_cron;
select cron.schedule(
  'expire-stale-bookings',
  '*/5 * * * *',
  $cron$ select public.expire_stale_bookings() $cron$
);
