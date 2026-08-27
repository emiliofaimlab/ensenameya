-- ============================================================================
-- Enséñame Ya — `confirm_payment` deja de ser invocable desde el cliente
-- (regla de oro 2 · S-15 / RN-26 · Doc 3 §permisos)
--
-- QUÉ ESTABA MAL. La función que marca un pago como cobrado estaba concedida a
-- `authenticated` y su único control era "eres el dueño de la reserva". Es
-- decir: cualquier alumno con sesión podía abrir la consola del navegador,
-- llamarla y darse por pagado. Hoy no roba dinero porque no hay dinero — el
-- proveedor ruteado es `simulated` y nadie cobra. El agujero se abre el día que
-- entren Stripe o DLocal, si para entonces nadie se acordó de revocarla.
--
-- Y HAY UN SEGUNDO PROBLEMA, DE FONDO. La función comprueba
-- `student_id = auth.uid()`. Un webhook no tiene usuario: `auth.uid()` es null
-- y la comprobación falla siempre. Osea que la función que existe para que la
-- llame el proveedor de pago era, literalmente, imposible de llamar por el
-- proveedor de pago. No es un endpoint de servidor mal expuesto: es una función
-- de cliente disfrazada de webhook. Revocar el grant a secas no la arregla, la
-- deja inservible para todos.
--
-- CÓMO QUEDA:
--   · `confirm_payment`            → solo `service_role`. Es el webhook de
--     EP-20 (RN-34). Se le quita el check de `auth.uid()`, que era justo lo que
--     le impedía cumplir su función; la autorización pasa a ser el grant, que
--     es donde debe estar.
--   · `confirm_simulated_payment`  → `authenticated`. Es el camino que usa el
--     checkout hoy, y ahora lo dice su nombre. Exige DOS cosas: ser el dueño de
--     la reserva y que el cobro esté ruteado al proveedor simulado.
--
-- LO IMPORTANTE DEL DISEÑO: el camino del cliente **se desarma solo**. En cuanto
-- `payment_routing_rules` deje de rutear a 'simulated', el snapshot que
-- `create_booking` guarda en `payments.provider` (RN-33) dejará de serlo y esta
-- función empezará a rechazar sin que nadie toque nada. El día del lanzamiento
-- no hay que acordarse de revocar: lo impide el dato, no un punto de una lista.
--
-- OJO CON EL GOTCHA QUE YA NOS MORDIÓ EN US-605 (`20260715150000`): en Postgres
-- `EXECUTE` se concede a **PUBLIC por defecto**. Revocar solo de
-- `authenticated` no cierra nada — hay que revocar de PUBLIC primero y después
-- conceder a quien deba. Por eso el bloque de abajo revoca de los tres.
-- ============================================================================

-- ── 1) confirm_payment: la de verdad, para el webhook ───────────────────────
-- Cuerpo idéntico al de `20260724160000` (R24-19, auto-aceptar) salvo el check
-- de propiedad, que se sustituye por una comprobación de existencia: quién
-- puede llamarla ya no lo decide la fila, lo decide el grant.
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
  if not exists (select 1 from public.bookings b where b.id = p_booking_id) then
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

revoke execute on function public.confirm_payment(uuid, boolean, text) from public;
revoke execute on function public.confirm_payment(uuid, boolean, text) from anon;
revoke execute on function public.confirm_payment(uuid, boolean, text) from authenticated;

grant  execute on function public.confirm_payment(uuid, boolean, text) to service_role;

-- ── 2) confirm_simulated_payment: el camino del checkout de hoy ─────────────
-- Es SECURITY DEFINER, así que puede llamar a `confirm_payment` aunque
-- `authenticated` ya no la alcance: dentro corre como el dueño de la función.
-- Ese es exactamente el punto — el cliente entra por una puerta que comprueba
-- cosas, no por la de servicio.
create or replace function public.confirm_simulated_payment(
  p_booking_id uuid,
  p_success    boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  -- Sigue siendo tuya o no existe (mismo mensaje que antes: no se filtra si la
  -- reserva existe y es de otro).
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.student_id = (select auth.uid())
  ) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select p.provider into v_provider
    from public.payments p where p.booking_id = p_booking_id;

  -- El interruptor. Si el cobro no está ruteado al proveedor simulado, esto es
  -- dinero de verdad y solo lo confirma el webhook.
  if v_provider is distinct from 'simulated' then
    raise exception 'un cobro real solo lo confirma el proveedor de pago'
      using errcode = 'insufficient_privilege';
  end if;

  return public.confirm_payment(p_booking_id, p_success);
end;
$$;

revoke execute on function public.confirm_simulated_payment(uuid, boolean) from public;
revoke execute on function public.confirm_simulated_payment(uuid, boolean) from anon;

grant  execute on function public.confirm_simulated_payment(uuid, boolean) to authenticated;
