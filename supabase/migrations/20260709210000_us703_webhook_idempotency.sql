-- ============================================================================
-- Enséñame Ya — US-703 (S2): idempotencia de webhooks de pago (RN-26/34).
-- Cada evento del PSP se procesa UNA sola vez: se deduplica por `event_id`.
-- confirm_payment gana un `p_event_id` opcional; cuando el webhook real (C-01)
-- lo pase, un evento repetido es no-op. La verificación de firma (RN-34) vive en
-- el endpoint HTTP del webhook (Edge Function), que llega con el proveedor real.
-- ============================================================================

create table public.payment_webhook_events (
  event_id     text        primary key,        -- id único del evento del proveedor
  booking_id   uuid        references public.bookings (id) on delete cascade,
  processed_at timestamptz not null default now()
);

alter table public.payment_webhook_events enable row level security;
-- Sin políticas ni grants: solo las RPC SECURITY DEFINER (owner) la tocan.

-- confirm_payment v2: + p_event_id (dedup). Reemplaza la firma (uuid, boolean).
drop function if exists public.confirm_payment(uuid, boolean);

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
    update public.bookings set status = 'pending_acceptance'
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
