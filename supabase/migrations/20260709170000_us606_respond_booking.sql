-- ============================================================================
-- Enséñame Ya — US-606 (S2): el tutor acepta/rechaza una reserva (RN-38, M4).
-- pending_acceptance → acepta (confirmed) | rechaza (cancelled + reembolso 100%).
-- Server-side (SECURITY DEFINER): el cliente no muta bookings/payments/sessions.
-- El timeout automático de 24h (auto-rechazo) es un job (Fase 5, con US-605).
-- NTF-05/NTF-17 quedan como stub (EP-12).
-- ============================================================================

create or replace function public.respond_booking(
  p_booking_id uuid,
  p_accept     boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new   public.booking_status;
  v_gross bigint;
begin
  -- Solo el tutor dueño de la reserva responde, y solo desde pending_acceptance.
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and b.tutor_id = (select auth.uid())
      and b.status = 'pending_acceptance'
  ) then
    raise exception 'reserva no encontrada o no está pendiente de aceptación'
      using errcode = 'check_violation';
  end if;

  if p_accept then
    -- Las sessions ya están 'scheduled' (hold desde create_booking). Al confirmar,
    -- Daily provisiona salas en EP-08. NTF-05 (stub) al alumno.
    update public.bookings set status = 'confirmed'
      where id = p_booking_id
      returning status into v_new;
  else
    -- Rechazo → reembolso 100% (RN-38) + libera el hold. NTF-17 (stub).
    select gross_amount into v_gross from public.payments where booking_id = p_booking_id;
    update public.payments
      set status = 'refunded', refunded_amount = v_gross
      where booking_id = p_booking_id;
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = p_booking_id
      returning status into v_new;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  return v_new::text;
end;
$$;

grant execute on function public.respond_booking(uuid, boolean) to authenticated;
