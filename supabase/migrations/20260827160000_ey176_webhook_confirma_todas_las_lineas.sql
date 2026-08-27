-- ============================================================================
-- Enséñame Ya — EY-176 · B3.1 (2 de 3): EL FALLO GRAVE, Y ES EL DE VERDAD
--
-- ⚠️⚠️ LÉEME ENTERO ANTES DE TOCAR NADA. Esto no es una hipótesis de diseño:
-- era un agujero por el que se cobraban tres mentorías y se entregaba una.
--
-- ── EL FALLO ────────────────────────────────────────────────────────────────
--
-- `payment_webhook_events.event_id` era **la clave primaria** de la tabla
-- (20260709210000:10) y `confirm_payment` la usa como candado de idempotencia:
-- inserta `(event_id, booking_id)` con `on conflict (event_id) do nothing` y,
-- si no insertó, **devuelve sin hacer nada** (20260817180000:148-157).
--
-- Con un pedido de N líneas hay **un solo cargo** y por tanto **un solo evento**
-- de Stripe. Al llamar a `confirm_payment` una vez por línea con ese mismo
-- `p_event_id`:
--
--   · la línea 1 se confirma;
--   · las líneas 2..N entran por el `do nothing` y salen en no-op SILENCIOSO;
--   · se quedan en `pending_payment` y `expire_stale_bookings` las cancela a
--     los 7 minutos (20260826120000);
--   · y **no se reembolsan**, porque la rama 1 de ese cron da por hecho que
--     nunca se llegó a cobrar y no encola nada.
--
-- Resultado: el alumno paga tres mentorías, recibe una, y las otras dos ni
-- vuelven. Ni un error en los registros: el no-op es silencioso por diseño.
--
-- ── LA CORRECCIÓN ───────────────────────────────────────────────────────────
--
-- La clave primaria pasa a ser **`(event_id, booking_id)`**. Eso es todo lo que
-- hacía falta, y es lo que permite que `confirm_payment` se quede EXACTAMENTE
-- COMO ESTÁ: la misma función, sin una línea tocada, deja de ser un no-op para
-- la segunda línea del mismo evento y sigue siendo idempotente para la
-- reentrega del mismo evento sobre la misma reserva — que es lo que de verdad
-- protegía.
--
-- No se reescribe `confirm_payment` a propósito. Es la función más delicada del
-- proyecto (idempotencia por estado, la rama de fallo, la liberación del hold,
-- X-02) y tocarla para esto habría sido cambiar dos cosas a la vez.
--
-- ── LO QUE **NO** CAMBIA, Y CONVIENE DECIRLO ────────────────────────────────
--
-- `expire_stale_bookings` no se toca. Las N reservas de un pedido nacen en la
-- misma transacción, así que comparten `created_at` y el cron las vence a la
-- vez, en una sola pasada: no hace falta que sepa qué es un pedido. Reescribir
-- hoy esa función —cuyo cuerpo hay que copiar letra por letra desde X-01 para
-- no revertir los reembolsos de RN-38— habría sido el cambio más caro y menos
-- necesario de la ficha.
-- ============================================================================


-- ── 1) La clave primaria de la idempotencia de webhooks ────────────────────
--
-- ⚠️ `booking_id` era NULLABLE y una clave primaria no admite nulos. No hay
-- filas así —el único escritor es `confirm_payment`, que siempre pasa la
-- reserva—, pero un `alter … set not null` que reviente deja la migración a
-- medias, así que se barre primero. Una fila sin reserva no dedupe nada de
-- todos modos: no se sabría de qué cobro habla.
delete from public.payment_webhook_events where booking_id is null;

alter table public.payment_webhook_events
  drop constraint payment_webhook_events_pkey;

alter table public.payment_webhook_events
  alter column booking_id set not null;

alter table public.payment_webhook_events
  add constraint payment_webhook_events_pkey primary key (event_id, booking_id);

comment on table public.payment_webhook_events is
  'US-703 + EY-176: un evento del PSP se procesa una sola vez POR RESERVA. La clave es (event_id, booking_id) y no event_id a secas: un pedido de N líneas se cobra con un único evento, y con la clave vieja solo se confirmaba la primera línea.';

-- Sigue sin políticas ni grants: solo la tocan las RPC SECURITY DEFINER, que
-- corren como dueño. Se repite el `enable` por si esta migración se aplicara
-- sobre una base donde la tabla se hubiera recreado.
alter table public.payment_webhook_events enable row level security;


-- ============================================================================
-- 2) CONFIRMAR UN PEDIDO ENTERO — la única forma de acreditar N líneas
--
-- Un evento, N reservas, UNA transacción. Es el reverso de P-1: si el pedido se
-- creó todo o nada, se acredita todo o nada.
--
-- ⚠️ POR QUÉ UNA FUNCIÓN Y NO N LLAMADAS DESDE EL WEBHOOK. Con la clave
-- primaria arreglada, el webhook podría llamar N veces a `confirm_payment` y
-- funcionaría… hasta que la petición se cortara entre la línea 2 y la 3. Ahí
-- quedarían dos reservas acreditadas y una muriendo, y aunque Stripe reintenta
-- y la tercera acabaría entrando, entre medias el cron puede haberla cancelado.
-- Dentro de una función es una sola transacción: o entran las N o no entra
-- ninguna, y el reintento de Stripe encuentra el trabajo por hacer entero.
--
-- ⚠️ EL ORDEN DEL BUCLE ES POR `id` A PROPÓSITO. Dos entregas simultáneas del
-- mismo evento —o una entrega y una pasada del cron— toman los mismos candados;
-- recorrerlos siempre en el mismo orden es lo que evita el abrazo mortal. Es el
-- mismo criterio que ya aplica `expire_stale_bookings` al bloquear `payments`
-- antes que `bookings`.
-- ============================================================================
create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_success  boolean default true,
  p_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_r        record;
  v_estados  jsonb := '{}'::jsonb;
  v_n        int := 0;
begin
  select o.id, o.status into v_order
    from public.orders o where o.id = p_order_id;
  if v_order.id is null then
    raise exception 'pedido no encontrado' using errcode = 'no_data_found';
  end if;

  -- Cada línea por la puerta de siempre. `confirm_payment` conserva TODAS sus
  -- garantías por reserva: el dedup por evento (ahora por (evento, reserva)),
  -- la idempotencia por estado —incluido 'failed', que es lo que hace que un
  -- cobro tardío no reviva una reserva ya liberada (X-02)— y la elección entre
  -- 'confirmed' y 'pending_acceptance' según `products.auto_accept_bookings`.
  --
  -- ⚠️ Y ESO ÚLTIMO ES POR MENTORÍA, NO POR PEDIDO (M-02). Un pedido de tres
  -- puede quedar con una 'confirmed' y dos 'pending_acceptance', cada una con
  -- su ventana de 24 h de RN-38 y su reembolso parcial. Es correcto: quien
  -- acepta es cada tutor, no el carrito.
  for v_r in
    select b.id from public.bookings b
     where b.order_id = p_order_id
     order by b.id
  loop
    v_estados := v_estados || jsonb_build_object(
      v_r.id::text,
      public.confirm_payment(v_r.id, p_success, p_event_id)
    );
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'el pedido % no tiene líneas', p_order_id using errcode = 'no_data_found';
  end if;

  -- El estado del pedido habla del CARGO. Se mueve una sola vez: de
  -- 'pending_payment' a lo que diga el PSP. La guarda deja la reentrega del
  -- mismo evento en un no-op limpio y evita que un fallo posterior pise un
  -- pedido ya cobrado.
  update public.orders
     set status = (case when p_success then 'paid' else 'cancelled' end)::public.order_status
   where id = p_order_id
     and status = 'pending_payment';

  return jsonb_build_object(
    'order',  p_order_id,
    'lineas', v_n,
    'estado', (select o.status from public.orders o where o.id = p_order_id),
    'por_linea', v_estados
  );
end;
$$;

comment on function public.confirm_order_payment(uuid, boolean, text) is
  'EY-176: acredita (o tumba) TODAS las líneas de un pedido con el único evento de su único cargo, en una transacción. Con la clave (event_id, booking_id) ya arreglada, cada línea pasa por confirm_payment sin no-ops silenciosos.';

-- Del webhook y de nadie más, igual que `confirm_payment`. En Postgres el
-- `execute` nace concedido a PUBLIC, así que revocar antes de conceder no es
-- ceremonia (mismo gotcha de 20260715150000, 20260806120000, 20260817160000 y
-- 20260817180000).
revoke execute on function public.confirm_order_payment(uuid, boolean, text) from public;
revoke execute on function public.confirm_order_payment(uuid, boolean, text) from anon;
revoke execute on function public.confirm_order_payment(uuid, boolean, text) from authenticated;
grant  execute on function public.confirm_order_payment(uuid, boolean, text) to service_role;


-- ============================================================================
-- 3) EL CAMINO SIMULADO DEL PEDIDO — y no es opcional
--
-- ⚠️ HOY ESTE ES EL CAMINO ACTIVO. `payment_routing_rules` sigue diciendo
-- 'simulated' mientras no se cambie esa fila, así que en dev un pedido se
-- cobra por aquí y no por Stripe. Sin esta función, el navegador tendría que
-- confirmar línea a línea con `confirm_simulated_payment` — que es EXACTAMENTE
-- el estado medio pagado que esta migración existe para impedir, solo que sin
-- Stripe delante.
--
-- Espejo literal de `confirm_simulated_payment` (20260806120000:120-153), con
-- las mismas dos guardas y en el mismo orden:
--   1. el pedido es tuyo, o no existe (mismo mensaje: no se filtra si existe);
--   2. el interruptor — si el cobro no está ruteado al proveedor simulado,
--      esto es dinero de verdad y solo lo confirma el webhook.
-- El día que se encienda Stripe, este botón deja de funcionar solo. Que es lo
-- que debe pasar.
-- ============================================================================
create or replace function public.confirm_simulated_order_payment(
  p_order_id uuid,
  p_success  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.student_id = (select auth.uid())
  ) then
    raise exception 'pedido no encontrado' using errcode = 'no_data_found';
  end if;

  -- El snapshot del pedido, que `create_order` copió de `payments.provider`
  -- después de comprobar que todas las líneas comparten pasarela.
  select o.provider into v_provider from public.orders o where o.id = p_order_id;

  if v_provider is distinct from 'simulated' then
    raise exception 'un cobro real solo lo confirma el proveedor de pago'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sin `p_event_id`: en el camino simulado no hay evento de proveedor que
  -- deduplicar. La idempotencia la pone `confirm_payment` por estado del pago,
  -- igual que en la compra suelta.
  return public.confirm_order_payment(p_order_id, p_success, null);
end;
$$;

comment on function public.confirm_simulated_order_payment(uuid, boolean) is
  'EY-176: el equivalente de confirm_simulated_payment para un pedido. Exige ser dueño Y que orders.provider sea simulated; con una pasarela real solo confirma el webhook.';

revoke execute on function public.confirm_simulated_order_payment(uuid, boolean) from public;
revoke execute on function public.confirm_simulated_order_payment(uuid, boolean) from anon;
grant  execute on function public.confirm_simulated_order_payment(uuid, boolean) to authenticated;
