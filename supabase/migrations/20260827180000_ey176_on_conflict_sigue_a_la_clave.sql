-- ============================================================================
-- Enséñame Ya — EY-176: el candado de idempotencia sigue a su clave primaria
--
-- ⚠️ REGRESIÓN INTRODUCIDA POR `20260827160000`, Y ROMPÍA MÁS DE LO QUE ARREGLABA.
--
-- Esa migración cambió `payment_webhook_events` de `primary key (event_id)` a
-- `primary key (event_id, booking_id)` — correcto, y es lo que permite que un
-- pedido de N líneas se acredite entero. Pero dio por hecho que `confirm_payment`
-- no había que tocarla, y sí: su cuerpo (vivo desde `20260817180000:150-152`)
-- hace
--
--     insert into public.payment_webhook_events (event_id, booking_id)
--     values (p_event_id, p_booking_id)
--     on conflict (event_id) do nothing;
--
-- y al desaparecer el índice único sobre `event_id` a secas, Postgres contesta
--
--     there is no unique or exclusion constraint matching the ON CONFLICT
--     specification                                                  (42P10)
--
-- O sea que quedó rota **la acreditación de cualquier cobro**, no solo la del
-- pedido: `confirm_order_payment` pasa cada línea por `confirm_payment`, y la
-- compra de una sola mentoría llama a esa misma función. Medido: el webhook
-- firmado de un pedido de dos líneas devolvía 500.
--
-- ── EL ARREGLO, Y POR QUÉ ES EL BUENO ───────────────────────────────────────
-- `on conflict (event_id, booking_id)`. No es solo «que compile»: es la
-- semántica correcta y la que la tabla ya declaraba con su clave nueva —un
-- evento se procesa una vez POR RESERVA—. Con la clave vieja, la segunda línea
-- del mismo evento se descartaba en silencio; ese era el fallo original.
--
-- Se conserva la protección que de verdad importaba: la reentrega del MISMO
-- evento sobre la MISMA reserva sigue sin acreditar dos veces.
--
-- ── LA LECCIÓN, QUE ES LA TERCERA DEL DÍA ───────────────────────────────────
-- Cambiar una clave primaria obliga a revisar TODOS los `on conflict` que la
-- nombran. Aquí había cinco migraciones con `on conflict (event_id)` y solo la
-- última está viva, pero eso hay que comprobarlo, no suponerlo:
--
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'public.payment_webhook_events'::regclass;
--
-- Y como las otras dos veces de hoy: ni el typecheck ni `db:push` lo vieron,
-- porque ninguno EJECUTA la función. Salió al disparar el webhook de verdad.
--
-- El resto del cuerpo es byte a byte el de `20260817180000` — se extrajo y se
-- le cambió esa única línea, para no meter deriva en una función de dinero.
-- ============================================================================


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
    on conflict (event_id, booking_id) do nothing;
    if not found then
      select status into v_new from public.bookings where id = p_booking_id;
      return v_new::text;  -- evento ya procesado → no-op
    end if;
  end if;

  select status into v_pay_status from public.payments where booking_id = p_booking_id;

  -- Idempotencia por estado: un pago ya RESUELTO no se reprocesa. 'failed' es
  -- tan definitivo como 'paid' (X-02) — significa que el horario ya se liberó,
  -- y acreditarlo ahora cobraría por una clase que no existe.
  if v_pay_status in ('paid', 'refunded', 'partially_refunded', 'failed') then
    select status into v_new from public.bookings where id = p_booking_id;
    return v_new::text;
  end if;

  if p_success then
    update public.payments set status = 'paid', paid_at = now() where booking_id = p_booking_id;

    -- M-02 · ¿esta MENTORÍA acepta sola? (antes: ¿este tutor?)
    --
    -- Subconsulta envuelta en `coalesce` y no `select … into` a secas: si el
    -- join no devolviera fila, `into` dejaría la variable en null y el `case`
    -- de abajo se iría por la rama del else igualmente, pero por accidente.
    -- Así el respaldo es EXPLÍCITO y es el conservador: sin producto legible,
    -- la reserva espera a que un humano la acepte. En la práctica no puede
    -- pasar —`bookings.product_id` es `not null` y `on delete restrict`
    -- (20260709140000:36), así que el producto de una reserva no se borra—,
    -- pero un `false` escrito gana a un null implícito.
    select coalesce(
             (select p.auto_accept_bookings
                from public.bookings b
                join public.products p on p.id = b.product_id
               where b.id = p_booking_id),
             false)
      into v_auto;

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
