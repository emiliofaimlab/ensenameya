-- ============================================================================
-- Enséñame Ya — R24-19 (reunión 24-jul): auto-aceptar reservas.
--
-- Preferencia por tutor: si `auto_accept_bookings` está activo, una reserva
-- pagada salta directa a `confirmed` en vez de esperar su aceptación manual en
-- `pending_acceptance` (US-606). Las sesiones ya están en hold desde
-- create_booking; aceptar solo mueve el booking, así que auto-aceptar = poner
-- `confirmed` en el mismo confirm_payment.
--
-- El tutor puede togglearlo desde su panel (column-grant), como headline/bio.
-- No toca dinero ni el split (S-15): solo el estado del booking.
-- ============================================================================

alter table public.tutor_profiles
  add column if not exists auto_accept_bookings boolean not null default false;

-- El tutor edita su propia preferencia (RLS + column-grant, US-1403).
grant update (auto_accept_bookings) on public.tutor_profiles to authenticated;

-- ── confirm_payment v3: respeta el auto-aceptar del tutor ────────────────────
create or replace function public.confirm_payment(
  p_booking_id uuid,
  p_success    boolean default true,
  p_event_id   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_status public.payment_status;
  v_new        public.booking_status;
  v_auto       boolean;
begin
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.student_id = (select auth.uid())
  ) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- US-703: dedup por event-id (procesar cada evento una sola vez).
  if p_event_id is not null then
    insert into public.payment_webhook_events (event_id, booking_id)
    values (p_event_id, p_booking_id)
    on conflict (event_id) do nothing;
    if not found then
      select status into v_new from public.bookings where id = p_booking_id;
      return v_new::text;  -- evento ya procesado → no-op
    end if;
  end if;

  select status into v_pay_status from public.payments where booking_id = p_booking_id;

  -- Idempotencia por estado (un pago ya resuelto no se reprocesa).
  if v_pay_status in ('paid', 'refunded', 'partially_refunded') then
    select status into v_new from public.bookings where id = p_booking_id;
    return v_new::text;
  end if;

  if p_success then
    update public.payments set status = 'paid', paid_at = now() where booking_id = p_booking_id;

    -- R24-19: ¿el tutor de esta reserva auto-acepta?
    select coalesce(tp.auto_accept_bookings, false) into v_auto
      from public.bookings b
      join public.tutor_profiles tp on tp.profile_id = b.tutor_id
      where b.id = p_booking_id;

    update public.bookings
      set status = case when v_auto then 'confirmed' else 'pending_acceptance' end::public.booking_status
      where id = p_booking_id and status = 'pending_payment'
      returning status into v_new;
  else
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = p_booking_id
      returning status into v_new;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  return v_new::text;
end;
$$;

grant execute on function public.confirm_payment(uuid, boolean, text) to authenticated;
