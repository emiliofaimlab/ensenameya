-- ============================================================================
-- Motivo de cancelación (decisión 23 del cliente, 24-jul · EP-23)
--
-- AL07 ya pide el motivo con un selector + texto libre desde el rediseño, y al
-- enviar se tiraba: `bookings` no tenía dónde guardarlo. El cliente pidió
-- persistirlo, así que la columna existe y `cancel_booking` la escribe.
--
-- Sin enum: la lista de motivos la mueve producto (hoy son cinco, mañana otros)
-- y un enum obliga a migración por cada cambio. Texto libre acotado a 500, que
-- es lo que cabe en el `textarea` de la pantalla más el motivo elegido.
--
-- El motivo lo escribe la MISMA RPC que cancela — el cliente no tiene UPDATE
-- sobre `bookings` (US-1402) y no se le abre uno para esto.
-- ============================================================================

alter table public.bookings
  add column if not exists cancel_reason text
    check (cancel_reason is null or length(cancel_reason) <= 500);

comment on column public.bookings.cancel_reason is
  'Motivo declarado al cancelar (AL07). Lo escribe cancel_booking; nulo si se canceló por timeout o desde admin.';

-- Añadir un parámetro cambia la firma, así que la vieja se retira: dejarla
-- viva sería una segunda puerta que cancela sin registrar el motivo.
drop function if exists public.cancel_booking(uuid);

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_bk       record;
  v_is_tutor boolean;
  v_earliest timestamptz;
  v_pay      record;
  v_pct      int;
  v_refund   bigint := 0;
begin
  select id, student_id, tutor_id, status
    into v_bk
  from public.bookings
  where id = p_booking_id
    and (student_id = v_uid or tutor_id = v_uid)
    and status in ('pending_payment', 'pending_acceptance', 'confirmed');
  if v_bk.id is null then
    raise exception 'reserva no cancelable o inexistente' using errcode = 'check_violation';
  end if;

  v_is_tutor := (v_uid = v_bk.tutor_id);

  -- RN-37 sobre la sesión más próxima aún agendada.
  select min(start_at) into v_earliest
  from public.sessions
  where booking_id = p_booking_id and status = 'scheduled';

  if v_is_tutor then
    v_pct := 100;
  elsif v_earliest is null or v_earliest - now() >= interval '24 hours' then
    v_pct := 100;
  else
    v_pct := 50;
  end if;

  -- Reembolso solo si el pago fue capturado.
  select status, gross_amount into v_pay from public.payments where booking_id = p_booking_id;
  if v_pay.status in ('paid', 'partially_refunded') then
    v_refund := round(v_pay.gross_amount * v_pct / 100.0);
    update public.payments
      set status = (case when v_pct >= 100 then 'refunded' else 'partially_refunded' end)::public.payment_status,
          refunded_amount = v_refund
      where booking_id = p_booking_id;
  elsif v_pay.status = 'pending' then
    -- Nunca se cobró (pending_payment): sin reembolso.
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    v_refund := 0;
  end if;

  update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        -- El texto llega ya compuesto de la pantalla ("motivo — detalle").
        cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
    where id = p_booking_id;
  update public.sessions set status = 'cancelled', cancelled_at = now()
    where booking_id = p_booking_id and status = 'scheduled';

  return jsonb_build_object('refund_pct', v_pct, 'refund_amount', v_refund);
end;
$$;

grant execute on function public.cancel_booking(uuid, text) to authenticated;
