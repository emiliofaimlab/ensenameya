-- ============================================================================
-- Enséñame Ya — EL PEDIDO TAMBIÉN CONCILIA
--
-- ── EL HUECO QUE CIERRA ─────────────────────────────────────────────────────
--
-- `20260912110000` le puso a `confirm_payment` un cuarto argumento
-- (`p_amount_charged`) y con él la conciliación en profundidad del cerrojo del
-- cobro abierto: antes de marcar `paid`, lo que dice el webhook que se cobró
-- tiene que ser exactamente `gross_amount - credit_amount`. Eso cerró al
-- acuñador de crédito gratis **en la reserva suelta**.
--
-- 🔴 Y LO DEJÓ ABIERTO EN EL PEDIDO, que es justo donde hay más dinero.
-- `confirm_order_payment` (`20260911180000:111`) llamaba línea por línea con
-- TRES posicionales:
--
--     public.confirm_payment(v_r.id, p_success, p_event_id)
--
-- Como el cuarto tiene `default null`, eso compila, `db:push` sale en verde y
-- la conciliación **no actúa**: llega null y la comparación se salta. O sea la
-- secuencia entera —aplicar crédito a una línea, abrir la Session del pedido
-- por la suma con descuento, quitar el crédito, pagar la Session vieja— seguía
-- dejando el pedido pagado entero y el crédito otra vez `active`. Es el fallo
-- mudo de la regla de oro 11 con un carrito detrás.
--
-- ── POR QUÉ LA CONCILIACIÓN DEL PEDIDO ES **DEL PEDIDO** ────────────────────
--
-- La tentación es pasarle a cada línea su propio importe esperado. No sirve de
-- nada, y conviene dejarlo escrito para que nadie lo "arregle" mañana: ese
-- importe saldría de `payments.gross_amount - credit_amount` de ESA MISMA FILA,
-- que es exactamente contra lo que `confirm_payment` lo compararía. Comparar un
-- número consigo mismo no concilia: da un verde que no significa nada. La misma
-- trampa que documenta el webhook de Stripe cuando dice que el importe sale DEL
-- EVENTO y nunca de nuestra base.
--
-- Un pedido es **un cargo** (P-3): una Session con N `line_items` y un solo
-- importe. Así que la pregunta que se puede responder es una sola y es del
-- pedido: *¿lo que cobró la pasarela es la SUMA de lo que deben sus N líneas?*
-- Aquí se responde **antes de tocar ninguna línea**, y si no cuadra no se
-- acredita ninguna —P-1, todo o nada, que es la misma regla con la que se
-- crearon—.
--
-- Y la profundidad por línea NO se pierde: `confirm_payment` sigue mirando el
-- marcador `payments.checkout_amount` de cada una, que lo escribió
-- `marcar_cobro_abierto` desde la BASE al abrir el cobro y que sí es una
-- segunda fuente independiente. Por eso el bucle le pasa `null` como cuarto
-- argumento, y lo pasa EXPLÍCITO: que se lea que es una decisión y no un
-- olvido, que es como se veía el de `20260911180000`.
--
-- ── LO QUE ESTA MIGRACIÓN AÑADE ADEMÁS: EL SELLO DEL PEDIDO ─────────────────
--
-- El marcador de §3 de `20260912110000` es POR LÍNEA, y eso cubre bien el
-- carrito mientras el Route Handler le pase TODAS sus líneas. Pero deja dos
-- cosas fuera, y las dos son del pedido y no de la línea:
--
--   1. **Una línea sin marcador no está protegida por nada.** Si el checkout
--      del pedido se dejara una (o la marcara antes de que existiera), esa
--      línea admite aplicar y quitar créditos con el cobro ya abierto y
--      `confirm_payment` no tiene contra qué compararla. Hoy la única red sería
--      `p_amount_charged`, o sea depender de que el PSP nos diga el importe.
--   2. **El CONJUNTO de líneas no está sellado.** Lo que la pasarela cobró es
--      la suma de las líneas que había cuando se abrió el cobro; que hoy no
--      exista ninguna RPC que añada una línea a un pedido abierto
--      (`create_order` las crea todas en la misma transacción) es cierto y es
--      frágil: es una propiedad del código de hoy, no del esquema.
--
-- Se cierra igual que se cerró el regalo en `credits` (§10.1 de la anterior):
-- con los hermanos de las mismas dos columnas en `orders`, escritos por la
-- MISMA `marcar_cobro_abierto` —que ya recibe las líneas y puede llegar al
-- pedido por `bookings.order_id`, sin cambiar su firma ni su contrato— y
-- conciliados aquí. Con eso el pedido cuadra **aunque el webhook no diga el
-- importe**, que es el caso de `confirm_simulated_order_payment` y el de
-- cualquier PSP futuro que no lo mande.
--
-- ── ⚠️ ORDEN DE DESPLIEGUE: **`db:push` PRIMERO, VERCEL DESPUÉS** ───────────
--
-- Al revés que `20260911180000` y que `20260912110000`, y por eso se dice
-- fuerte: aquí lo que cambia es una FIRMA, no una plantilla de correo. Los dos
-- webhooks ya llaman con `p_amount_charged`; contra la función vieja de tres
-- argumentos PostgREST responde **`PGRST202`** (ninguna función coincide), el
-- Route Handler lanza y el webhook devuelve 500. No es un fallo mudo —Stripe
-- reintenta tres días y se recupera solo en cuanto la migración esté— pero es
-- una ventana de cobros sin acreditar que no hace falta abrir.
--
-- (Detalle que lo disimula: `p_amount_charged: importeCobrado ?? undefined` y
-- supabase-js no serializa `undefined`, así que un evento SIN importe sí
-- resolvería contra la función vieja. O sea que fallarían justo los cobros
-- normales y no los raros. Igual que en la regla de oro 12.)
--
-- Y tras aplicar: `npm run db:types`. La firma de la RPC vive también en
-- `src/lib/database.types.ts`, y el `p_amount_charged` de los dos webhooks se
-- escribió —a propósito— para que lo vea el compilador.
--
-- ── ⚠️ REGLA DE ORO 12 ──────────────────────────────────────────────────────
--
-- `confirm_order_payment` CAMBIA su lista de argumentos → `drop function` +
-- `create`, jamás `create or replace`: con `create or replace` PostgreSQL
-- crearía una SOBRECARGA y PostgREST respondería `PGRST203` según los campos
-- que el llamador rellene. Y el `drop` se lleva los `grant execute` por
-- delante: se reponen abajo (hoy son `service_role` y nadie más — verificado
-- con `proacl` contra dev).
--
-- Las otras dos funciones que toca este fichero conservan su firma exacta y van
-- por `create or replace` a propósito, que ahí sí conserva los grants.
--
-- ── CÓMO TIENE QUE LLAMARLA CADA PUERTA (las cuatro que existen) ────────────
--
--   · `src/app/api/webhooks/stripe/route.ts` y `.../dlocalgo/route.ts`:
--     `admin.rpc("confirm_order_payment", { p_order_id, p_success, p_event_id,
--     p_amount_charged })` — POR NOMBRE, con el importe del EVENTO
--     (`amount_total` de la Session en Stripe), nunca de nuestra base. Ya lo
--     hacen las dos.
--   · `confirm_credit_order` (§4 de este fichero): pasa **0**, y es verdad —
--     por la pasarela no entró nada—. Es la simetría de `confirm_credit_booking`
--     (`20260912110000:1903`), que ya pasaba `0::bigint`.
--   · `confirm_simulated_order_payment` (`20260827160000:227`): se queda con
--     tres posicionales y NO se toca. En el camino simulado no hay pasarela que
--     haya cobrado nada, así que el único importe que se podría pasar saldría de
--     nuestra propia base: sería la comparación vacua de arriba. Lo que sí actúa
--     ahí es el sello del pedido, que no depende del llamador. (Y esa puerta
--     lleva muerta desde `20260901140000`: exige que NINGUNA regla activa cobre
--     con un proveedor real.)
--
-- ── ⚠️ REGLA DE ORO 11 ──────────────────────────────────────────────────────
--
-- `create or replace` VALIDA LA SINTAXIS, NO EJECUTA EL CUERPO. Al final hay un
-- `do $$` que paga de verdad un pedido de dos líneas —una con crédito y otra
-- sin— y comprueba que la conciliación rechaza el importe del acuñador y acepta
-- el bueno. Sale por `raise exception 'ensayo-ok'` para que no quede nada
-- escrito.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · EL MARCADOR DEL COBRO ABIERTO, TAMBIÉN PARA EL PEDIDO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Los hermanos de `payments.checkout_opened_at` / `checkout_amount` (§3 de
-- `20260912110000`) y de `credits.checkout_opened_at` / `checkout_amount`
-- (§10.1, el regalo). Mismo nombre a propósito: es el mismo cerrojo sobre el
-- tercer sujeto que puede abrir un cobro.
alter table public.orders
  add column if not exists checkout_opened_at timestamptz,
  add column if not exists checkout_amount    bigint;

comment on column public.orders.checkout_opened_at is
  'Cuándo se abrió el cobro de ESTE pedido (UTC). Marcador POSITIVO, el hermano de payments.checkout_opened_at: es lo único que dice «hay una Session viva por el total de este carrito». Lo escribe marcar_cobro_abierto al recibir las líneas, llegando al pedido por bookings.order_id.';
comment on column public.orders.checkout_amount is
  'Unidades mínimas por las que se abrió ese cobro: la SUMA de gross_amount - credit_amount de las líneas vivas del pedido, sacada de la BASE y nunca del Route Handler. confirm_order_payment la concilia antes de acreditar ninguna línea, y es lo que hace que el pedido cuadre aunque el PSP no nos diga el importe cobrado.';

-- ⚠️ NO SE AÑADEN AL `grant update` DE `service_role`, y no es un descuido.
-- `orders` tiene grant de update POR COLUMNAS desde `20260827150000:180`
-- (`status`, `provider_payment_id`) precisamente para que el webhook no pueda
-- reescribir lo que no le toca. El único escritor legítimo de estas dos es
-- `marcar_cobro_abierto`, que es SECURITY DEFINER y corre como el dueño: no
-- necesita grant. Dárselo a `service_role` significaría que cualquier Route
-- Handler con `createAdminClient()` puede mover el sello del cobro — o sea,
-- desarmar el cerrojo con un `update`. Es el mismo razonamiento por el que
-- `credits` no tiene `grant update` para nadie (S7).
--
-- El `grant select on public.orders to authenticated` de aquella migración es
-- de TABLA, así que estas dos columnas quedan visibles para el alumno dueño del
-- pedido (la política `orders_select_student` acota a quién). Es su propio
-- cobro y no dice nada que no sepa: cuánto le van a cobrar y cuándo se abrió.


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · `marcar_cobro_abierto` v2 — sella también el pedido
-- ════════════════════════════════════════════════════════════════════════════
--
-- MISMA FIRMA (`uuid[]` → `int`) y mismo contrato para quien la llama: recibe
-- los sujetos, nunca el dinero, y devuelve cuántas LÍNEAS marcó. Por eso va por
-- `create or replace` y conserva sus grants (regla de oro 12: el `drop` solo
-- hace falta cuando cambia la lista de argumentos). El Route Handler que se
-- está escribiendo ahora mismo no tiene que cambiar ni una letra.
--
-- ⚠️ ORDEN DE BLOQUEO: `orders` → `payments` → `credits`, y hay que respetarlo
-- en las tres puertas o se crea un ciclo de deadlock donde hoy no lo hay:
--   · aquí se toma el candado del PEDIDO primero y después se escriben las
--     líneas;
--   · `confirm_order_payment` hace lo mismo desde §3 (por eso gana ahí un
--     `for update` que antes no tenía);
--   · `aplicar_credito` / `quitar_credito` / `confirm_payment` van `payments` →
--     `credits` y no tocan `orders`, así que encajan debajo sin cruzarse.
-- Invertirlo aquí —marcar las líneas y luego el pedido— pondría a esta función
-- a tomar `payments` → `orders` mientras el webhook toma `orders` → `payments`,
-- que es el ciclo de manual.
create or replace function public.marcar_cobro_abierto(p_booking_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n int := 0;
begin
  if p_booking_ids is null or array_length(p_booking_ids, 1) is null then
    return 0;
  end if;

  -- 1) El candado del pedido, si estas líneas son de uno. `order by` para que
  --    dos llamadas simultáneas con varios pedidos los tomen en el mismo orden.
  perform o.id
     from public.orders o
    where o.id in (select distinct b.order_id
                     from public.bookings b
                    where b.id = any(p_booking_ids)
                      and b.order_id is not null)
    order by o.id
      for update;

  -- 2) Las líneas, exactamente como en §3 de `20260912110000`: solo sobre
  --    cobros vivos —un pago ya resuelto no tiene checkout que marcar, y
  --    reescribirle el marcador sería mentir sobre lo que se cobró— y con el
  --    importe sacado de la BASE (regla de oro 2).
  update public.payments p
     set checkout_opened_at = now(),
         checkout_amount    = p.gross_amount - coalesce(p.credit_amount, 0)
   where p.booking_id = any(p_booking_ids)
     and p.status = 'pending';
  get diagnostics v_n = row_count;

  -- 3) Y el pedido: lo que la pasarela va a cobrar por ESTE carrito.
  --
  -- ⚠️ LA SUMA ES SOBRE **TODAS** LAS LÍNEAS VIVAS DEL PEDIDO, no solo sobre
  -- las que vinieron en el array. Es a propósito y es lo que evita un falso
  -- descuadre: si el Route Handler se dejara una línea fuera del array, el
  -- cargo que abre sigue siendo por el pedido ENTERO (lo compone sumando sus
  -- líneas), así que sellar aquí solo las recibidas dejaría el pedido marcado
  -- por menos de lo que se va a cobrar y el webhook abortaría un cobro honrado.
  -- Sumando todas, la línea olvidada se queda sin marcador propio pero sigue
  -- cubierta por el del pedido: moverle el crédito cambia esta suma y el
  -- descuadre salta igual. Que es exactamente el agujero 1 de la cabecera.
  update public.orders o
     set checkout_opened_at = now(),
         checkout_amount    = (
           select coalesce(sum(p.gross_amount - coalesce(p.credit_amount, 0)), 0)
             from public.bookings b
             join public.payments p on p.booking_id = b.id
            where b.order_id = o.id
              and p.status = 'pending')
   where o.status = 'pending_payment'
     and o.id in (select distinct b.order_id
                    from public.bookings b
                   where b.id = any(p_booking_ids)
                     and b.order_id is not null);

  -- Se sigue devolviendo el número de LÍNEAS marcadas y no el de pedidos: es lo
  -- que el llamador puede comparar contra lo que pidió.
  return v_n;
end;
$fn$;

comment on function public.marcar_cobro_abierto(uuid[]) is
  'Sella en payments —y, si esas líneas son de un pedido, también en orders— que se ha abierto un cobro y por cuánto. ⚠️ /api/pagos/checkout tiene que llamarla SIEMPRE que abra un cobro (reserva o pedido), justo antes de devolver la pantalla: mientras no lo haga, el marcador es null y el cerrojo de aplicar_credito/quitar_credito vuelve a estar vacío. El sello del pedido es la SUMA de sus líneas vivas y cubre también a la línea que el llamador se dejara fuera del array. Toma el candado del pedido ANTES que el de las líneas: orders → payments → credits en toda la plataforma.';

-- `create or replace` con la misma firma conserva los grants de
-- `20260912110000` (execute solo para `service_role`). No se repiten: reponerlos
-- aquí solo tendría sentido tras un `drop`, y aquí no hay ninguno.


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · `confirm_order_payment` v3 — concilia EL PEDIDO antes de tocar una línea
-- ════════════════════════════════════════════════════════════════════════════
--
-- Copia de `20260911180000:70` con la conciliación delante, el candado del
-- pedido y el cuarto argumento; el bucle, el `update` del estado, el recibo
-- NTF-04b y el `return` son los mismos, con sus comentarios.
--
-- 🔴 LAS TRES REGLAS DE CUÁNDO CONCILIAR, que es donde está la dificultad:
--
--   a) Con `p_success = false` NO se concilia nada. No se está acreditando
--      nada: se está tumbando, y ahí lo que corre es la devolución del crédito
--      de cada línea (`confirm_payment` → `liberar_credito_de_pago`).
--
--   b) Si NO queda ninguna línea viva (`payments.status = 'pending'`) tampoco
--      se concilia. Ese es el caso de la REENTREGA —Stripe reintenta tres días—
--      y el del cobro tardío, y en los dos el trabajo ya está hecho o ya está
--      muerto: `confirm_payment` responderá su no-op por estado, línea a línea.
--      ⚠️ Y hay que saber por qué no basta con comparar igualmente: cuando un
--      pago se va a `failed`, `liberar_credito_de_pago` le pone
--      `credit_amount = 0`; o sea que la suma histórica de un pedido muerto ya
--      NO es la que se cobró. Conciliar ahí convertiría un no-op limpio en un
--      descuadre eterno: el webhook devolvería 500 para siempre por un pedido
--      que nadie va a acreditar nunca. El webhook ya distingue los dos casos
--      antes de llamar (`esperaCobro` / `yaAcreditado`), pero esto no se puede
--      dejar colgando de que el llamador acierte.
--
--   c) Con líneas vivas se concilia contra `sum(gross_amount - credit_amount)`
--      de ESAS líneas, por los dos lados que existen: lo que diga el PSP
--      (`p_amount_charged`) y el sello del pedido (`orders.checkout_amount`).
--      Cualquiera de los dos que no cuadre ABORTA, con `check_violation` — que
--      es el `23514` que los dos webhooks ya reconocen como descuadre y
--      convierten en 500 con los dos importes en el log.
--
-- Y un pedido a medias (unas líneas vivas y otras no) descuadra solo, sin regla
-- aparte: la suma de las vivas no puede ser ni lo que cobró la pasarela ni lo
-- que se selló al abrir. Es lo correcto —P-1: si el pedido ya no se puede
-- entregar completo, el dinero vuelve entero y no se acredita ninguna línea— y
-- es lo que el webhook hace por su cuenta desde `20260827170000`.
--
-- ⚠️ LO QUE CUESTA ABORTAR, que es lo mismo que documenta §7 de la anterior: se
-- revierte también el `insert` en `payment_webhook_events`, así que el evento
-- no queda procesado y el PSP reintentará con el dinero ya cobrado. Es lo
-- correcto (mejor un webhook que grita que un carrito pagado de menos que no
-- mira nadie), pero la salida es MANUAL: el admin mira `orders.checkout_amount`
-- contra la suma de las líneas, decide cuál de los dos es la verdad y o cuadra
-- el crédito de la línea que se movió o pone `orders.checkout_amount = null`
-- para que el sello deje de actuar. Va también en `docs/QA-LANZAMIENTO.md`.
drop function if exists public.confirm_order_payment(uuid, boolean, text);

create or replace function public.confirm_order_payment(
  p_order_id       uuid,
  p_success        boolean default true,
  p_event_id       text    default null,
  p_amount_charged bigint  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order    record;
  v_r        record;
  v_estados  jsonb := '{}'::jsonb;
  v_n        int := 0;
  v_lineas   int;
  v_pagos    int;
  v_vivas    int;
  v_debido   bigint;
begin
  -- `student_id` se trae aquí y no en un segundo `select`: es la misma fila y
  -- es quien recibe el recibo del final. `checkout_amount` es el sello de §1.
  --
  -- ⚠️ `for update` ES NUEVO. Dos cosas: (1) fija el orden de bloqueo
  -- `orders` → `payments` → `credits` en toda la plataforma (ver §2), y (2)
  -- serializa dos entregas simultáneas del mismo cargo, que es lo que hace que
  -- la suma que se lee abajo siga siendo verdad cuando se acredita.
  select o.id, o.status, o.student_id, o.checkout_amount into v_order
    from public.orders o where o.id = p_order_id
   for update;
  if v_order.id is null then
    raise exception 'pedido no encontrado' using errcode = 'no_data_found';
  end if;

  -- ── LAS CUENTAS DEL PEDIDO, ANTES DE TOCAR NINGUNA LÍNEA ─────────────────
  select count(*) into v_lineas
    from public.bookings b where b.order_id = p_order_id;

  -- El mismo error de siempre, solo que ahora salta antes del bucle en vez de
  -- después (mismo mensaje y mismo errcode: el llamador no nota la diferencia).
  if v_lineas = 0 then
    raise exception 'el pedido % no tiene líneas', p_order_id using errcode = 'no_data_found';
  end if;

  select count(*),
         count(*) filter (where p.status = 'pending'),
         coalesce(sum(p.gross_amount - coalesce(p.credit_amount, 0))
                  filter (where p.status = 'pending'), 0)
    into v_pagos, v_vivas, v_debido
    from public.bookings b
    join public.payments p on p.booking_id = b.id
   where b.order_id = p_order_id;

  -- Una línea sin cobro no es un caso raro que tolerar: es una línea que
  -- `confirm_payment` marcaría `pending_acceptance` sin que nadie haya pagado
  -- nada (su `select` no encuentra fila, el `in (...)` de la idempotencia da
  -- null y sigue adelante). `create_booking_line` crea siempre las dos filas en
  -- la misma transacción, así que esto solo puede ser corrupción — y se para.
  if v_pagos <> v_lineas then
    raise exception 'el pedido % tiene % líneas y % cobros: no se acredita nada',
      p_order_id, v_lineas, v_pagos using errcode = 'no_data_found';
  end if;

  -- 🔴 LA CONCILIACIÓN. Las tres reglas están argumentadas en la cabecera de
  -- este bloque; aquí solo se ejecutan.
  if p_success and v_vivas > 0 then
    if p_amount_charged is not null and p_amount_charged <> v_debido then
      raise exception
        'el cobro del pedido % dice % y lo debido por sus % líneas vivas es %',
        p_order_id, p_amount_charged, v_vivas, v_debido
        using errcode = 'check_violation',
              hint = 'Un pedido es UN cargo: lo cobrado tiene que ser la suma de gross_amount - credit_amount de sus líneas. Si no cuadra, alguien movió un crédito con el cobro ya abierto.';
    end if;

    if v_order.checkout_amount is not null and v_order.checkout_amount <> v_debido then
      raise exception
        'el cobro del pedido % se abrió por % y ahora lo debido es %',
        p_order_id, v_order.checkout_amount, v_debido
        using errcode = 'check_violation',
              hint = 'Marcador de marcar_cobro_abierto sobre orders: cambió el crédito de una línea, o el juego de líneas del pedido, con el cobro ya abierto.';
    end if;
  end if;

  -- Cada línea por la puerta de siempre. `confirm_payment` conserva TODAS sus
  -- garantías por reserva: el dedup por evento (ahora por (evento, reserva)),
  -- la idempotencia por estado —incluido 'failed', que es lo que hace que un
  -- cobro tardío no reviva una reserva ya liberada (X-02)—, la elección entre
  -- 'confirmed' y 'pending_acceptance' según `products.auto_accept_bookings` y,
  -- desde `20260912110000`, la comprobación del marcador DE ESA LÍNEA.
  --
  -- ⚠️ Y ESO ÚLTIMO ES POR MENTORÍA, NO POR PEDIDO (M-02). Un pedido de tres
  -- puede quedar con una 'confirmed' y dos 'pending_acceptance', cada una con
  -- su ventana de 24 h de RN-38 y su reembolso parcial. Es correcto: quien
  -- acepta es cada tutor, no el carrito.
  --
  -- 🔴 EL CUARTO ARGUMENTO VA **NULL**, Y ES UNA DECISIÓN. Ver la cabecera del
  -- fichero: el importe que se le podría pasar aquí saldría de la misma fila
  -- contra la que él lo compararía, o sea que no conciliaría nada y daría un
  -- verde vacío. Lo del pedido ya se comprobó arriba, contra el único número
  -- que viene de fuera; lo de la línea lo comprueba él con su marcador.
  for v_r in
    select b.id from public.bookings b
     where b.order_id = p_order_id
     order by b.id
  loop
    v_estados := v_estados || jsonb_build_object(
      v_r.id::text,
      public.confirm_payment(v_r.id, p_success, p_event_id, null::bigint)
    );
    v_n := v_n + 1;
  end loop;

  -- El estado del pedido habla del CARGO. Se mueve una sola vez: de
  -- 'pending_payment' a lo que diga el PSP. La guarda deja la reentrega del
  -- mismo evento en un no-op limpio y evita que un fallo posterior pise un
  -- pedido ya cobrado.
  --
  -- Y el sello se limpia al cerrar, por la misma razón por la que
  -- `liberar_credito_de_pago` solo limpia el de la línea cuando el pago ya está
  -- muerto (`20260912110000:730`): el marcador no es un apunte contable, dice
  -- «hay un checkout VIVO por ahí», y un pedido ya cobrado o ya cancelado no lo
  -- tiene. Mientras el pedido siga en 'pending_payment' no se toca — ahí el
  -- checkout sigue abierto y borrarlo reabriría lo que §1 cierra.
  update public.orders
     set status = (case when p_success then 'paid' else 'cancelled' end)::public.order_status,
         checkout_opened_at = null,
         checkout_amount    = null
   where id = p_order_id
     and status = 'pending_payment';

  -- NTF-04b: UN recibo por pedido, con el total que el alumno pagó de verdad.
  -- Solo en el camino feliz: un pedido cancelado no tiene recibo, y de las
  -- líneas caídas ya avisa NTF-15 una por una.
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
    'debido', v_debido,
    'por_linea', v_estados
  );
end;
$fn$;

comment on function public.confirm_order_payment(uuid, boolean, text, bigint) is
  'EY-176: acredita (o tumba) TODAS las líneas de un pedido con el único evento de su único cargo, en una transacción. Desde los créditos CONCILIA ANTES DE TOCAR NINGUNA LÍNEA: lo que cobró la pasarela (p_amount_charged) y el sello de orders.checkout_amount tienen que ser la SUMA de gross_amount - credit_amount de sus líneas vivas. La conciliación es del PEDIDO y no por línea a propósito: por línea compararía un número consigo mismo. Sin líneas vivas no concilia —eso es una reentrega o un cobro tardío— para no convertir un no-op limpio en un descuadre eterno.';

-- ⚠️ El `drop` de arriba se llevó los privilegios. Se reponen sobre la que
-- sobrevive, y el `revoke` no es adorno: en PostgreSQL el `execute` de una
-- función nace concedido a PUBLIC. (Antes del drop eran exactamente estos:
-- `{postgres=X/postgres,service_role=X/postgres}`.)
revoke execute on function public.confirm_order_payment(uuid, boolean, text, bigint) from public;
revoke execute on function public.confirm_order_payment(uuid, boolean, text, bigint) from anon;
revoke execute on function public.confirm_order_payment(uuid, boolean, text, bigint) from authenticated;
grant  execute on function public.confirm_order_payment(uuid, boolean, text, bigint) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · `confirm_credit_order` — el canje 100 % crédito también dice su importe
-- ════════════════════════════════════════════════════════════════════════════
--
-- Copia literal de `20260912110000:1916` con UN cambio: el cuarto argumento.
-- Pasa `0` y es verdad —por la pasarela no entró nada—, exactamente como su
-- hermana de una línea (`confirm_credit_booking`, `:1903`). No es ceremonia: la
-- conciliación del pedido comprueba que la suma de lo debido por sus líneas
-- vivas es 0, o sea que TODAS siguen cubiertas al 100 % **en el momento de
-- acreditar** y no solo cuando el Route Handler miró. Entre las dos cosas cabe
-- un `quitar_credito`.
--
-- Misma firma → `create or replace` conserva su grant a `service_role`.
create or replace function public.confirm_credit_order(p_order_id uuid, p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_mal int;
  v_n   int;
begin
  if p_student is null then
    raise exception 'falta el alumno' using errcode = '28000';
  end if;

  if not exists (select 1 from public.orders o
                  where o.id = p_order_id and o.student_id = p_student) then
    raise exception 'pedido no encontrado' using errcode = 'no_data_found';
  end if;

  select count(*) filter (where coalesce(p.credit_amount, 0) is distinct from p.gross_amount),
         count(*)
    into v_mal, v_n
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.order_id = p_order_id;

  if v_n = 0 then
    raise exception 'el pedido % no tiene líneas', p_order_id using errcode = 'no_data_found';
  end if;
  if v_mal > 0 then
    raise exception '% de las % líneas del pedido no están cubiertas al 100 %% por un crédito', v_mal, v_n
      using errcode = 'check_violation';
  end if;

  -- Se delega en `confirm_order_payment` y no se repite su cuerpo: así el
  -- recibo único del pedido (NTF-04b) sigue saliendo una sola vez y con la
  -- misma clave. El 0 es el importe que cobró la pasarela: ninguno.
  return public.confirm_order_payment(p_order_id, true, 'credit:' || p_order_id, 0::bigint);
end;
$fn$;

comment on function public.confirm_credit_order(uuid, uuid) is
  'La hermana de confirm_credit_booking para un pedido multi-línea: exige que TODAS las líneas estén cubiertas al 100 % y delega en confirm_order_payment para no duplicar el recibo NTF-04b. Le pasa 0 como importe cobrado —por la pasarela no entró nada— y así la conciliación del pedido revalida la cobertura en el momento de acreditar. Nombres distintos y no una sobrecarga, por la regla de oro 12.';


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Autocomprobación — porque `create or replace` valida la sintaxis, NO
--     ejecuta el cuerpo (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- El patrón de `20260912110000` §16: se PAGA de verdad un pedido de dos líneas
-- —una con crédito y otra sin—, se comprueba que la conciliación rechaza el
-- importe del acuñador y acepta el bueno, y se sale por excepción para que nada
-- de esto quede escrito.
--
-- Se ejercita lo que ninguna comprobación estática habría cazado: que el bucle
-- llama a la `confirm_payment` de CUATRO argumentos, que el sello del pedido se
-- escribe y se lee, y que la reentrega sigue siendo un no-op limpio.
do $comprobacion$
declare
  v_prod   uuid;
  v_tut    uuid;
  v_est    uuid;
  v_cur    char(3);
  v_camp   int;
  v_ord    uuid;
  v_bk_a   uuid;   -- línea con crédito: 18000 − 4500 = 13500
  v_bk_b   uuid;   -- línea sin crédito: 10000
  v_pay_a  uuid;
  v_pay_b  uuid;
  v_cred_a uuid;   -- saldo 4500
  v_cred_b uuid;   -- saldo 1000, solo para el ensayo del sello
  v_j      jsonb;
  v_b      bigint;
  v_i      int;
  v_t      text;
begin
  begin
    select p.id, p.tutor_id, p.currency
      into v_prod, v_tut, v_cur
      from public.products p
     where p.status = 'active'
     order by p.created_at
     limit 1;

    select rf_campaign_id into v_camp
      from public.referral_campaigns order by rf_campaign_id limit 1;

    select pr.id into v_est
      from public.profiles pr
     where pr.id is distinct from v_tut
       and not exists (select 1 from public.account_deletion_requests r
                        where r.user_id = pr.id
                          and r.status = 'pending'::public.account_deletion_request_status)
     order by pr.created_at
     limit 1;

    if v_prod is null or v_camp is null or v_est is null then
      raise notice 'sin producto activo, sin campaña o sin perfiles: el ensayo del pedido se salta (producción está vacía).';
    else
      -- ── El pedido de dos líneas, con sus dos cobros ────────────────────────
      insert into public.orders (student_id, provider, currency, lines_fingerprint)
      values (v_est, 'stripe', v_cur, 'ensayo-conciliacion-del-pedido')
      returning id into v_ord;

      insert into public.bookings (
        student_id, product_id, tutor_id, status, pricing_model, num_sessions,
        session_duration_min, currency, subtotal_amount, total_amount,
        tier_split_pct, order_id
      ) values (
        v_est, v_prod, v_tut, 'pending_payment', 'per_session', 1,
        60, v_cur, 18000, 18000, 80, v_ord
      ) returning id into v_bk_a;

      insert into public.payments (
        booking_id, status, currency, gross_amount, platform_fee_amount,
        tutor_net_amount, tier_split_pct, provider
      ) values (
        v_bk_a, 'pending', v_cur, 18000, 3600, 14400, 80, 'stripe'
      ) returning id into v_pay_a;

      insert into public.bookings (
        student_id, product_id, tutor_id, status, pricing_model, num_sessions,
        session_duration_min, currency, subtotal_amount, total_amount,
        tier_split_pct, order_id
      ) values (
        v_est, v_prod, v_tut, 'pending_payment', 'per_session', 1,
        60, v_cur, 10000, 10000, 80, v_ord
      ) returning id into v_bk_b;

      insert into public.payments (
        booking_id, status, currency, gross_amount, platform_fee_amount,
        tutor_net_amount, tier_split_pct, provider
      ) values (
        v_bk_b, 'pending', v_cur, 10000, 2000, 8000, 80, 'stripe'
      ) returning id into v_pay_b;

      -- Dos recompensas con `referred_profile_id` distinto: el índice parcial
      -- `credits_recompensa_unica` es (beneficiario, campaña, referido).
      insert into public.credits (
        beneficiary_id, source, kind, destino, status, amount, currency,
        referral_campaign_id, referred_profile_id, expires_at, issued_at
      ) values (
        v_est, 'referral', 'saldo', 'cobro', 'active', 4500, v_cur,
        v_camp, v_tut, now() + interval '30 days', now()
      ) returning id into v_cred_a;

      insert into public.credits (
        beneficiary_id, source, kind, destino, status, amount, currency,
        referral_campaign_id, referred_profile_id, expires_at, issued_at
      ) values (
        v_est, 'referral', 'saldo', 'cobro', 'active', 1000, v_cur,
        v_camp, v_est, now() + interval '30 days', now()
      ) returning id into v_cred_b;

      -- `aplicar_credito` es de `authenticated` y lee `auth.uid()`: se pone la
      -- sesión con `set_config(…, true)`, local a la transacción.
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_est)::text, true);

      v_j := public.aplicar_credito(v_bk_a, v_cred_a);
      if (v_j ->> 'a_pagar')::bigint <> 13500 then
        raise exception 'la línea con crédito tenía que quedar en 13500: %', v_j;
      end if;

      -- ── 1) El marcador: por línea Y por pedido ────────────────────────────
      v_i := public.marcar_cobro_abierto(array[v_bk_a, v_bk_b]);
      if v_i <> 2 then
        raise exception 'marcar_cobro_abierto marcó % líneas de 2', v_i;
      end if;

      select p.checkout_amount into v_b from public.payments p where p.id = v_pay_a;
      if v_b is distinct from 13500 then
        raise exception 'el marcador de la línea con crédito dice % y tenía que decir 13500', coalesce(v_b, -1);
      end if;

      select o.checkout_amount into v_b from public.orders o where o.id = v_ord;
      if v_b is distinct from 23500 then
        raise exception 'el sello del PEDIDO dice % y tenía que decir 23500 (13500 + 10000)', coalesce(v_b, -1);
      end if;

      -- ── 2) El cerrojo de §3 sigue valiendo dentro de un carrito ───────────
      -- Quitar el crédito de una línea con el cobro del pedido ya abierto es la
      -- primera mitad del acuñador.
      begin
        perform public.quitar_credito(v_bk_a);
        raise exception 'el cerrojo del cobro abierto NO frenó a quitar_credito dentro de un pedido';
      exception when check_violation then
        null;   -- correcto
      end;

      -- ── 3) 🔴 LA CONCILIACIÓN DEL PEDIDO RECHAZA EL IMPORTE DEL ACUÑADOR ──
      -- 28000 es el bruto de las dos líneas, o sea lo que se cobraría si el
      -- crédito hubiera desaparecido después de abrir la Session.
      begin
        perform public.confirm_order_payment(v_ord, true, 'ensayo-pedido-1', 28000::bigint);
        raise exception 'confirm_order_payment NO concilió el importe del cargo';
      exception when check_violation then
        null;   -- correcto
      end;

      -- ── 4) 🔴 Y EL SELLO DEL PEDIDO CAZA LA LÍNEA SIN MARCADOR ────────────
      -- Se simula el agujero 1 de la cabecera: una línea que el checkout se
      -- dejó sin marcar. Sin su marcador, `aplicar_credito` la deja cambiar; el
      -- webhook no dice el importe (null), así que lo único que queda en pie es
      -- el sello del PEDIDO. Todo esto se revierte con el sub-bloque.
      begin
        update public.payments
           set checkout_opened_at = null, checkout_amount = null
         where booking_id = v_bk_b;

        -- ⚠️ El canje va en su propio bloque: `aplicar_credito` levanta
        -- `check_violation` por media docena de motivos suyos (moneda, tope,
        -- cerrojos) y el `when check_violation` de fuera se lo tragaría, dejando
        -- el ensayo VERDE sin haber probado nada. Se convierte a P0001, que
        -- atraviesa el manejador y tumba la migración como debe.
        begin
          v_j := public.aplicar_credito(v_bk_b, v_cred_b);
        exception when others then
          raise exception 'ensayo mal montado: aplicar_credito falló con «%»', sqlerrm;
        end;
        if (v_j ->> 'credit_amount')::bigint <> 1000 then
          raise exception 'ensayo mal montado: el segundo crédito cubrió % en vez de 1000',
            v_j ->> 'credit_amount';
        end if;

        perform public.confirm_order_payment(v_ord, true, 'ensayo-pedido-2', null::bigint);
        raise exception 'el sello del pedido NO frenó el cambio de crédito de una línea sin marcador';
      exception when check_violation then
        null;   -- correcto
      end;

      -- ── 5) El camino bueno: 23500 cuadra y se acreditan las DOS líneas ────
      v_j := public.confirm_order_payment(v_ord, true, 'ensayo-pedido-3', 23500::bigint);
      if (v_j ->> 'lineas')::int <> 2 or (v_j ->> 'estado') <> 'paid' then
        raise exception 'el pedido honrado no se acreditó entero: %', v_j;
      end if;

      select count(*) into v_i
        from public.payments p
       where p.id in (v_pay_a, v_pay_b) and p.status = 'paid';
      if v_i <> 2 then
        raise exception 'se acreditaron % de las 2 líneas del pedido', v_i;
      end if;

      select b.status::text into v_t from public.bookings b where b.id = v_bk_a;
      if v_t not in ('confirmed', 'pending_acceptance') then
        raise exception 'la línea con crédito quedó en %', v_t;
      end if;

      -- Y el recibo sigue siendo UNO del pedido y ninguno por línea (Doc 33).
      select count(*) into v_i from public.notifications n
       where n.idempotency_key = 'NTF-04b:order:' || v_ord;
      if v_i <> 1 then
        raise exception 'el recibo del pedido se encoló % veces', v_i;
      end if;
      select count(*) into v_i from public.notifications n
       where n.idempotency_key in ('NTF-04:payment:' || v_pay_a,
                                   'NTF-04:payment:' || v_pay_b);
      if v_i <> 0 then
        raise exception 'el recibo por línea no se calló dentro de un pedido (% encolados)', v_i;
      end if;

      -- ── 6) La reentrega sigue siendo un no-op limpio ──────────────────────
      -- Otro evento, un importe absurdo y ninguna línea viva: NO puede abortar.
      -- Si lo hiciera, el PSP reintentaría tres días un pedido ya acreditado.
      v_j := public.confirm_order_payment(v_ord, true, 'ensayo-pedido-4', 99::bigint);
      if (v_j ->> 'estado') <> 'paid' then
        raise exception 'la reentrega dejó el pedido en %', v_j ->> 'estado';
      end if;

      perform set_config('request.jwt.claims', '', true);
    end if;

    -- Sale por excepción a propósito: es lo que revierte el pedido de mentira,
    -- sus dos cobros, los créditos y los avisos que se hayan encolado.
    raise exception 'ensayo-ok';
  exception when others then
    if sqlerrm <> 'ensayo-ok' then
      raise;
    end if;
  end;

  raise notice 'Pedido: la conciliación rechaza el importe del acuñador, el sello de orders caza la línea sin marcador, el pedido honrado se acredita entero con UN recibo y la reentrega sigue siendo un no-op.';
end $comprobacion$;
