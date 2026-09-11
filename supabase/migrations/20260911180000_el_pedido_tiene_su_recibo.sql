-- ============================================================================
-- Enséñame Ya — Doc 33 · EL PEDIDO TIENE SU RECIBO, y el hueco entre pagar y
-- que el tutor acepte deja de ser silencio (NTF-04b · NTF-17b)
--
-- ── QUÉ SE ARREGLA ──────────────────────────────────────────────────────────
--
-- 1. Un carrito de tres clases disparaba TRES `payment_receipt` sueltos y
--    ningún total. `confirm_order_payment` pasa línea por línea por
--    `confirm_payment`, cada línea mueve su `payments.status` a 'paid' y el
--    trigger `notify_payment` encola un recibo por cada una. El alumno pagó UN
--    cargo y recibe tres correos que no suman: ninguno dice cuánto pagó.
--    Ahora el pedido encola UN `order_receipt` (NTF-04b) con el total, y el
--    recibo por línea se calla cuando la reserva pertenece a un pedido.
--
-- 2. Entre «pagué» y «el tutor aceptó» no llegaba nada al alumno. El tutor sí
--    recibía su NTF-07 desde 20260806160000, pero al alumno le quedaba una
--    reserva en `pending_acceptance` sin explicación, con 24 h corriendo y un
--    reembolso automático del 100 % (RN-38) del que no se le había avisado.
--    Ahora recibe NTF-17b diciendo exactamente eso.
--
-- ── ⚠️ ORDEN DE DESPLIEGUE: VERCEL PRIMERO, LA MIGRACIÓN DESPUÉS ────────────
--
-- Esta migración empieza a encolar avisos con las plantillas `order_receipt` y
-- `booking_pending_student`. Si la base las encola y el despliegue todavía no
-- tiene esas claves en el mapa `PLANTILLAS` de `src/lib/email-templates.ts`,
-- `renderEmail` devuelve null y el job las marca **`failed` PERMANENTE**
-- (`src/app/api/cron/notifications-send/route.ts`: sin plantilla no hay
-- reintento que valga). No es un retraso: el correo se pierde para siempre y
-- la `idempotency_key` ya gastada impide volver a encolarlo.
--
-- Las dos plantillas ya están escritas en `src/lib/email-templates.ts`, así que
-- basta con respetar el orden: **desplegar Vercel y solo entonces `db:push`**.
-- Al revés no rompe el build ni devuelve un 500: se ve semanas después, en
-- forma de recibos que nadie recibió.
--
-- ── ⚠️ REGLA DE ORO 11 ──────────────────────────────────────────────────────
--
-- Las tres funciones van por `create or replace` a propósito: ninguna cambia de
-- firma (`confirm_order_payment` conserva `(uuid, boolean, text)` y sus grants;
-- los dos triggers no tienen argumentos y conservan `notifications_on_payment`
-- y el suyo de `bookings`). Pero `create or replace` **valida la sintaxis, no
-- ejecuta el cuerpo**: esto se comprueba pagando un pedido de dos líneas en dev
-- y mirando la cola, no leyendo el diff.
-- ============================================================================


-- ============================================================================
-- 1) NTF-04b — el recibo DEL PEDIDO
--
-- Cuerpo copiado letra por letra de 20260827160000 salvo dos puntos: el
-- `select` de la cabecera trae también `student_id`, y entre el cierre del
-- pedido y el `return` se encola el recibo.
--
-- ⚠️ ESTO CORRE DENTRO DE LA TRANSACCIÓN DEL WEBHOOK. Si el enqueue reventara,
-- se iría al suelo la acreditación del pedido ENTERO —las N reservas pagadas
-- volviendo a `pending_payment` con el dinero ya cobrado—, que es justo el
-- estado medio pagado que `confirm_order_payment` existe para impedir. Se
-- acepta porque `enqueue_notification` no hace más que un `insert … on conflict
-- (idempotency_key) do nothing` sobre una tabla sin triggers ni FK hacia nada
-- que pueda faltar: no valida plantillas, no llama a nadie y no puede fallar
-- por un correo mal formado. Quien renderiza es el job, horas después y fuera
-- de esta transacción. Cualquier cosa más lista que un insert aquí dentro
-- convertiría un fallo de correo en un fallo de cobro.
--
-- El payload lleva SOLO `order_id`. Las líneas, el total y cuántas esperan al
-- tutor los resuelve la vista `pending_email_notifications` al renderizar: un
-- total congelado aquí quedaría desfasado en cuanto una línea se reembolse, y
-- el importe no se copia a mano nunca (regla de oro 2).
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
  -- `student_id` se trae aquí y no en un segundo `select`: es la misma fila y
  -- es quien recibe el recibo del final.
  select o.id, o.status, o.student_id into v_order
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

  -- NTF-04b: UN recibo por pedido, con el total que el alumno pagó de verdad.
  -- Solo en el camino feliz: un pedido cancelado no tiene recibo, y de las
  -- líneas caídas ya avisa NTF-15 una por una (ver el bloque 2).
  --
  -- Va DESPUÉS del `update` a propósito, aunque la clave lo haga idempotente:
  -- así el pedido ya está en 'paid' cuando el job lo renderice, y la vista no
  -- se encuentra un recibo de un pedido que todavía dice 'pending_payment'.
  -- La clave es por pedido, no por evento: la reentrega del mismo webhook y el
  -- reintento de Stripe encolan una sola vez.
  if p_success then
    perform public.enqueue_notification(v_order.student_id, 'NTF-04b', 'email', 'order_receipt',
      jsonb_build_object('order_id', p_order_id), 'NTF-04b:order:' || p_order_id);
  end if;

  return jsonb_build_object(
    'order',  p_order_id,
    'lineas', v_n,
    'estado', (select o.status from public.orders o where o.id = p_order_id),
    'por_linea', v_estados
  );
end;
$$;

comment on function public.confirm_order_payment(uuid, boolean, text) is
  'EY-176: acredita (o tumba) TODAS las líneas de un pedido con el único evento de su único cargo, en una transacción. Con la clave (event_id, booking_id) ya arreglada, cada línea pasa por confirm_payment sin no-ops silenciosos. Doc 33: al acreditar encola UN recibo de pedido (NTF-04b) en vez de los N recibos por línea, que notify_payment ya se calla.';

-- `create or replace` con la MISMA firma conserva los grants de 20260827160000
-- (execute solo para service_role). No se repiten: reponerlos aquí solo tendría
-- sentido tras un `drop`, y este fichero no hace ninguno (regla de oro 12).


-- ============================================================================
-- 2) EL RECIBO POR LÍNEA SE CALLA CUANDO LA RESERVA ES DE UN PEDIDO
--
-- Copia de 20260831120000 con tres cambios: `v_pedido`, el `select` que lo
-- trae y la guarda de NTF-04.
--
-- ⚠️ POR QUÉ SOLO NTF-04 Y NO LOS OTROS DOS. NTF-10 (reembolso) y NTF-15 (pago
-- fallido) se quedan POR LÍNEA a propósito, y no es un olvido:
--
--   · Un recibo responde «¿cuánto he pagado?». Tres recibos parciales sin total
--     no responden esa pregunta: no son tres recibos, son ninguno. Por eso se
--     sustituyen por uno solo del pedido.
--   · Un reembolso o un rechazo responden «¿qué le pasó a MI CLASE del martes?»
--     Afectan a UNA mentoría concreta —el tutor que no aceptó, la tarjeta que
--     rechazó esa línea— y el alumno necesita saber cuál. Agruparlos por pedido
--     le diría que «algo» de su carrito se cayó y le obligaría a adivinar qué.
--     Tres correos ahí son tres avisos útiles, no ruido.
--
-- ⚠️ El silencio cuelga de `bookings.order_id`, que `create_order` rellena en la
-- MISMA transacción que crea las líneas (20260827150000): cuando el webhook
-- confirma, horas después, la columna lleva puesta desde el principio. Una
-- reserva suelta la tiene null y sigue recibiendo su NTF-04 de siempre.
--
-- `create or replace` conserva el trigger `notifications_on_payment`. Y como
-- recuerda la regla de oro 11, esto valida la sintaxis pero no ejecuta el
-- cuerpo: se comprueba pagando un pedido, no leyendo el diff.
-- ============================================================================
create or replace function public.notify_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_pedido  uuid;
begin
  if new.status is distinct from old.status
     or new.refunded_amount is distinct from old.refunded_amount then
    -- Alias explícito: la tabla trae ahora dos columnas del mismo `select` y
    -- sin él `student_id` a secas es ambiguo de leer, no de compilar.
    select b.student_id, b.order_id into v_student, v_pedido
      from public.bookings b where b.id = new.booking_id;

    if new.status = 'paid' and old.status <> 'paid' and v_pedido is null then
      -- Compra suelta: este ES el recibo. Si la reserva va en un pedido, el
      -- recibo lo manda confirm_order_payment con el total (NTF-04b).
      perform public.enqueue_notification(v_student, 'NTF-04', 'email', 'payment_receipt',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'amount', new.gross_amount, 'currency', new.currency),
        'NTF-04:payment:' || new.id);
    elsif new.status in ('refunded', 'partially_refunded') then
      -- Clave incluye el acumulado reembolsado → parcial y total avisan una vez cada uno.
      perform public.enqueue_notification(v_student, 'NTF-10', 'email', 'refund_processed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'refunded', new.refunded_amount, 'currency', new.currency),
        'NTF-10:payment:' || new.id || ':' || new.refunded_amount);
    elsif new.status = 'failed' then
      perform public.enqueue_notification(v_student, 'NTF-15', 'email', 'payment_failed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id),
        'NTF-15:payment:' || new.id);
    end if;
  end if;
  return new;
end;
$$;

comment on function public.notify_payment() is
  'EP-12/Doc 7: avisos que cuelgan de payments. NTF-04 (recibo) solo para la compra suelta — si bookings.order_id no es null el recibo lo manda confirm_order_payment con el total del pedido (NTF-04b). NTF-10 y NTF-15 siguen siendo POR LÍNEA: un reembolso o un rechazo hablan de UNA mentoría y el alumno necesita saber cuál.';


-- ============================================================================
-- 3) NTF-17b — el hueco entre pagar y que el tutor acepte
--
-- Copia de 20260806160000 con un solo añadido, en la rama `pending_acceptance`.
--
-- ⚠️ NO SE REPITE EN LA RAMA `confirmed`, y esto es al revés que NTF-07. El
-- tutor con auto-aceptar salta `pending_acceptance` entero: su reserva nace en
-- `confirmed` y ahí el alumno ya recibe NTF-05 («tu reserva está confirmada»),
-- que dice algo estrictamente mejor que «espera 24 h a que el tutor conteste».
-- Encolar también NTF-17b le mandaría dos correos que se contradicen: uno
-- diciendo que ya está y otro pidiéndole paciencia. NTF-07 sí se repite en las
-- dos ramas porque el tutor necesita enterarse en ambos casos y la clave
-- compartida lo descarta; aquí no hay clave compartida que valga, porque los
-- dos avisos son distintos a propósito.
--
-- La reserva que pasa por `pending_acceptance` y luego a `confirmed` recibe los
-- dos en orden, que es lo correcto: «espera» y después «ya está».
-- ============================================================================
create or replace function public.notify_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    -- La reserva está pagada y esperando al tutor: es AHORA cuando hay que
    -- avisarle, con las 24 h por delante y no ya gastadas.
    if new.status = 'pending_acceptance' then
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);
      -- NTF-17b: y al alumno, que hasta hoy pagaba y no recibía nada hasta que
      -- el tutor contestara. El plazo de 24 h y el reembolso del 100 % de
      -- RN-38 solo son justos si se le cuentan al empezar, no al vencer.
      perform public.enqueue_notification(new.student_id, 'NTF-17b', 'email', 'booking_pending_student',
        jsonb_build_object('booking_id', new.id), 'NTF-17b:booking:' || new.id);

    elsif new.status = 'confirmed' then
      perform public.enqueue_notification(new.student_id, 'NTF-05', 'email', 'booking_confirmed_student',
        jsonb_build_object('booking_id', new.id), 'NTF-05:booking:' || new.id);
      -- Se mantiene para el tutor con auto-aceptar, que nunca pasa por
      -- `pending_acceptance`. Si ya pasó, la clave repetida lo descarta.
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);

    elsif new.status = 'cancelled' then
      perform public.enqueue_notification(new.student_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id), 'NTF-09:booking:' || new.id || ':student');
      perform public.enqueue_notification(new.tutor_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id), 'NTF-09:booking:' || new.id || ':tutor');

    elsif new.status = 'completed' then
      -- NTF-14: al completar, invita a reseñar (RN-28).
      perform public.enqueue_notification(new.student_id, 'NTF-14', 'email', 'review_request',
        jsonb_build_object('booking_id', new.id), 'NTF-14:booking:' || new.id);
    end if;
  end if;
  return new;
end;
$$;

comment on function public.notify_booking() is
  'EP-12/Doc 7: avisos por transición de bookings. Doc 33 añade NTF-17b al alumno en pending_acceptance — el hueco entre pagar y que el tutor acepte—, y NO lo repite en confirmed: ahí NTF-05 ya dice algo mejor y los dos juntos se contradirían.';
