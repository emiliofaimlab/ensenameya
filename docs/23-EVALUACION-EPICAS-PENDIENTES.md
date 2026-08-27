# DOC 23 — Las nueve fichas en `To Do`, evaluadas contra el código

> **Qué es esto.** Las **nueve fichas** de EP-25 (carrito multi-tutor) y EP-26 (trabajo mayor)
> que están en `To Do`, contrastadas **una a una contra el código de `dev`**. No es un plan de
> ejecución: nadie las va a implementar esta semana. Es lo que hace falta para **hablar de ellas
> con números y riesgos delante del cliente**: qué cuesta cada una, qué la bloquea, y qué
> pregunta exacta hay que hacer antes de escribir la primera línea.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 23 — Evaluación técnica de las nueve épicas pendientes |
| **Fecha** | 2026-08-26 |
| **Autor** | Jose Mora (desarrollo) |
| **Fichas** | `EY-176` `EY-177` `EY-178` `EY-179` (EP-25) · `EY-186` `EY-187` `EY-188` `EY-189` `EY-192` (EP-26) |
| **Base** | `docs/22-LISTA-VERONICA-21AGO.md` · `docs/21-DECISION-CONSULTAS-PREVENTA.md` |
| **Verificación** | Auditoría sobre `dev` @ `20b3500`, con `npm run typecheck` en verde. Cinco agentes en paralelo, uno por módulo, más la lectura directa del núcleo de dinero. **Todo estado sale de leer el código**, no la documentación — que en cinco puntos vuelve a estar equivocada (§23.7) |
| **Convención** | «Está» = **está en `dev`**. `main` sigue sin nada de agosto; eso es otro problema y vive en el Doc 22 §22.7 |
| **Alcance** | Evaluación, **no implementación**. No se ha escrito ni una migración ni una línea de producción |

**Esfuerzo:** `XS` <1 h · `S` medio día · `M` 1-2 días · `L` 3-5 días · `XL` semana o más.

---

## 23.0 · La conclusión, en seis frases

1. **De las nueve, solo dos se pueden empezar mañana sin preguntarle nada a nadie:** `EY-188`
   (sincronización de calendario) y `EY-189` (reportar conducta) — y de la segunda **el backend
   ya está construido**, incluida la palanca de moderación que nadie ha llamado nunca.
2. **`EY-176` no es «un carrito»: es reescribir el motor de cobro**, y está costado en `XL`
   porque toca las cuatro piezas que sostienen el dinero — `create_booking`, el webhook, la cola
   de reembolsos y los payouts. Hay **un fallo concreto y verificado** que cualquier diseño de
   carrito tiene que resolver el primer día: con un solo cobro para N reservas, el webhook
   confirmaría **una** y las otras se cancelarían solas siete minutos después, cobradas y sin
   clase (§23.3.3).
3. **`EY-187` (área verificada) es la única que no se puede empezar aunque se quiera:** no hay
   contra qué validar. Las categorías del tutor son autodeclaradas por él mismo desde el
   navegador, los 6 documentos de KYC no tienen ninguna dimensión de materia, y «Tutor
   verificado» es texto fijo que significa exactamente un `approval_status = 'approved'`.
4. **`EY-192` (anonimización) está bien diagnosticada en el Doc 22 y mal resuelta en Jira:** la
   cadena de claves foráneas es real —borrar la cuenta **es** borrar las reservas—, pero los
   bloqueos son **tres, no cuatro**, y la respuesta V-10 del cliente («borrar usuario y reservas,
   reseñas anónimas») sigue siendo internamente contradictoria: `reviews.booking_id` es `cascade`.
5. **`EY-178` no tiene backend que tocar y `EY-177` contradice dos decisiones firmadas** (N-33 y
   el aislamiento del checkout): las dos dependen de que `EY-176` exista antes, y `EY-178`
   obligaría además a introducir el **primer estado de cliente compartido entre rutas** de todo
   el proyecto — hoy no hay ni un `createContext` en el repo.
6. **Coste total de las nueve, con las respuestas ya puestas: entre 25 y 49 jornadas** —o sea,
   **de cinco a diez semanas** de una persona, según cómo caigan las decisiones— y **cerca de la
   mitad se la llevan `EY-176` y `EY-187`**, que son precisamente las dos en las que menos claro
   está que el cliente quiera lo que ha pedido. Sumar los extremos altos de cada ficha es lo
   honesto: ninguna de las nueve se ha desglosado en tareas todavía.

---

## 23.1 · El cuadro de mando

🟢 `SE PUEDE EMPEZAR` · 🟠 `NECESITA RESPUESTA` · ⛔ `NO SE PUEDE EMPEZAR` · 🔵 `DEPENDE DE OTRA`

| Ficha | Qué pide | Estado | Bloqueo | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **EY-176** · B3.1 | Carrito multi-tutor: motor de cobro por línea | 🟠 | Decisión de producto (§23.6 P-1/P-2/P-3) | **XL** |
| **EY-177** · B3.2 | Checkout en 3 pasos | 🟠 | Contradice N-33 y el aislamiento del checkout | **L** |
| **EY-178** · B3.3 | «Agregar al carrito» sin salir, animación y contador | 🔵 | **Sin `EY-176` no hay nada que añadir** | **M** (solo el front) |
| **EY-179** · B3.4 | Dos selectores fijos, sin cambio de tamaño | 🟠 | ¿En qué pantalla? En una de las dos no hay dos selectores | **M–L** |
| **EY-186** · B5.3 | Carrusel Home: historial y mentores favoritos | 🟠 | ¿Qué «Home»? ¿Favorito de tutor o de mentoría? | **M–L** |
| **EY-187** · B5.4 | Validación de área verificada del tutor | ⛔ | **No hay contra qué validar** | **XL** |
| **EY-188** · B5.5 | Sincronización con Apple/Google por suscripción | 🟢 | Ninguno | **L** |
| **EY-189** · B5.6 | «Reportar conducta» en la sala + bandeja admin | 🟢 | Ninguno (la taxonomía tiene default operable) | **M** |
| **EY-192** · B5.9 | Eliminación de cuenta con anonimización | 🟠 | La respuesta V-10 se contradice a sí misma | **L** |

> ⚠️ **Estas nueve fichas no aparecen en `docs/BACKLOG.md`.** El único `EP-25` que menciona el
> backlog es un choque de numeración con `EY-110` (`BACKLOG.md:93`). O sea que el backlog del
> repo y Jira ya no son espejo. Los textos de las fichas que se citan aquí vienen del encargo, no
> del repo: **no se han podido verificar contra Jira** desde esta sesión.

---

## 23.2 · Cómo se compra hoy — la línea base contra la que se mide EP-25

Todo lo de abajo es evidencia leída, no memoria.

| Pieza | Qué hace | Dónde |
| :-- | :-- | :-- |
| `create_booking(uuid, timestamptz[])` | **Un producto, N horarios, UNA reserva.** Congela el snapshot financiero: total, moneda, `tier_split_pct`, `payee_country`, proveedor de cobro. Crea `bookings` + `payments` + N `sessions` en una transacción | [`20260715170000_us1103_tutor_tiers.sql:104-226`](../supabase/migrations/20260715170000_us1103_tutor_tiers.sql) |
| `payments` | **1:1 con la reserva.** `booking_id not null unique … on delete cascade` | [`20260709140000_ep06_booking_core.sql:97`](../supabase/migrations/20260709140000_ep06_booking_core.sql) |
| Checkout | Recibe **un** `bookingId`. Importe de `payments.gross_amount`, jamás del navegador | [`src/app/api/pagos/checkout/route.ts:175-215`](../src/app/api/pagos/checkout/route.ts) · `:286` |
| Session de Stripe | **Un solo `line_item`**, `client_reference_id = bookingId`, `metadata.booking_id` | [`src/lib/payments/stripe-provider.ts:162`, `:202-215`](../src/lib/payments/stripe-provider.ts) |
| Webhook | Saca **un** booking del evento y llama **una vez** a `confirm_payment` | [`src/app/api/webhooks/stripe/route.ts:77`, `:92-96`](../src/app/api/webhooks/stripe/route.ts) |
| Payouts | Agrupa por `(tutor, moneda)` bajando de `payments → bookings → tutor_id`. `payout_items.payment_id` es **`unique` + `on delete restrict`** → **un pago pertenece como mucho a UN payout, y un payout es de UN tutor** | [`20260716140000_ep10_payouts.sql:48`, `:93-133`](../supabase/migrations/20260716140000_ep10_payouts.sql) |

**No existe ningún concepto de pedido, cesta o agrupación.** `grep` de `order_id`, `orders`,
`cart_id`, `group_id` sobre las 100 migraciones: **cero**. Y `grep -riE "cart|carrito|basket|cesta"`
sobre `src/` y `supabase/`: **dos falsos positivos** (la subcadena «ceSta» de `replaceState`).

> ⚠️ **Corrección al Doc 22 §22.2 B3.** Ahí se decía que «lo que casi seguro quiere el cliente ya
> existe: el panel “Tu selección” del selector de paquete». **No es cierto.** Ese panel
> ([`slot-picker.tsx:346-423`](../src/app/(app)/reservar/[productId]/slot-picker.tsx)) guarda un
> `Set<string>` de horas ISO (`:141-143`) con **cupo fijo** (`:200`: `if (next.size >= required)`)
> y **de un solo producto** (`productId` es una prop, `:108`). No lleva dentro ni el producto ni el
> tutor: **estructuralmente no puede** sostener dos mentorías. Parece un carrito y es un contador.

---

## 23.3 · EY-176 · Qué habría que rehacer, exactamente

Ésta es la parte que importa. La pregunta del encargo era literal: **¿un pago por línea, o un pago
con varios `payout_items`?** La respuesta corta es **un pago por línea**, y abajo está el porqué
con los ficheros delante.

### 23.3.1 · Diseño B — un pago, varios `payout_items`: **descartado**

Es el que parece más limpio (un cobro = un `payments`) y es el que revienta más cosas.

| Qué rompe | Evidencia |
| :-- | :-- |
| `payout_items.payment_id` es **`unique`** — un pago no puede repartirse entre dos tutores | `20260716140000:48` |
| `payments` tiene **un solo** `tier_split_pct`, `tutor_net_amount`, `platform_fee_amount`, `payee_country`. Dos tutores = dos tramos y dos tiers | `20260709140000:100-108` |
| `build_payout_for_tutor` baja `payments → bookings.tutor_id` y suma `p.tutor_net_amount`. Con dos tutores en un pago, el `join` duplica y la suma miente | `20260716140000:109-127` |
| El clawback de US-704 hace `where pi.payment_id = p_payment_id` esperando **≤ 1 fila** | `20260817170000:476-481` |
| 🔴 **Fuga de RLS.** `payments_select_tutor` autoriza vía `payments.booking_id`. Si el pago fuera la cabecera del pedido, **cada tutor vería el importe total del pedido**, incluidas las líneas de sus competidores | `20260709140000:167-175` |
| Los tipos generados cambian de forma: `payments.booking_id` `unique` hace que PostgREST devuelva **objeto**, no array. Está escrito en el código | [`src/lib/admin/queries.ts:385-386`](../src/lib/admin/queries.ts) |

La fuga de RLS por sí sola lo descarta. **No se recomienda.**

### 23.3.2 · Diseño A — un pago por línea, con una cabecera nueva: **el viable**

Un `orders` (o `carts`) nuevo, y `bookings.order_id` / `payments.order_id` nullable. Cada línea
sigue siendo lo que ya es: **una reserva, un pago, un snapshot financiero congelado**. Con eso,
`payouts`, `payout_items`, `build_payout_for_tutor`, `tutor_balance`, el clawback y las políticas
RLS **no se tocan** — que es el 60 % del ahorro.

Lo que sí hay que rehacer, con nombre y apellidos:

| # | Qué | Dónde | Por qué |
| :-- | :-- | :-- | :-- |
| 1 | **`create_booking` multi-línea.** Firma nueva que reciba N pares `(producto, horarios)` y cree N reservas en **una** transacción. La revalidación de huecos, el tier, el ruteo y el snapshot se repiten por línea | `20260715170000:104-226` | Regla de oro 7: el snapshot va por función controlada, nunca por insert del cliente |
| 2 | **Qué pasa si una línea falla.** Hoy la carrera de horario se traduce en `raise exception` y **se cae la reserva entera** (`:220-222`). Con tres líneas hay que decidir: ¿todo o nada, o se compra lo que quede? **Es una decisión de producto, no técnica** | ídem | Ver P-1 en §23.6 |
| 3 | **La Session con N `line_items`** y `client_reference_id` apuntando al **pedido**, no a la reserva | `stripe-provider.ts:202-215` | Hoy hay exactamente un `line_item` |
| 4 | 🔴 **`payment_webhook_events`** — ver §23.3.3. Es el fallo grave | `20260709210000:9-13` | |
| 5 | **La clave de idempotencia** pasa de `booking-<id>-c<caduca>-v4` a clave de pedido, y con ella el `VERSION_PARAMS` | `checkout/route.ts:315`, `:147` | Stripe da error, no la respuesta cacheada, si la misma clave llega con parámetros distintos |
| 6 | **La `returnUrl`** ya no puede ser `/reservas/<id>/confirmacion`: hace falta pantalla de pedido | `checkout/route.ts:293` | |
| 7 | ⚠️ **`late_payment_refunds.provider_payment_id` es `not null unique`.** Con un solo PaymentIntent para N líneas, un cobro tardío se anota **una vez** y —peor— el handler devuelve **el cargo entero sin importe** (`webhooks/stripe/route.ts:155-164`): reembolsaría las tres líneas por culpa de una | `20260817160000:69` | |
| 8 | **La aceptación es por mentoría, no por pedido.** `auto_accept_bookings` vive en `products`, así que un pedido de tres puede quedar con una `confirmed` y dos `pending_acceptance`, cada una con su ventana de 24 h de RN-38 y su reembolso parcial | `20260817180000:172-192` | |
| 9 | **Reembolsos parciales de pedido.** `enqueue_refund` topa contra `p_amount > gross_amount` **por pago** — con el diseño A eso funciona solo, pero contra Stripe son N reembolsos parciales del mismo PaymentIntent | `20260817170000:185-252` | |
| 10 | **Notificaciones.** `notify_booking` es un trigger por reserva con clave `NTF-07:booking:<id>` → un pedido de tres manda **tres correos** al alumno | `20260806160000:26-56` | Cosmético, pero se ve |
| 11 | Front: `checkout-form.tsx` (802 líneas), `slot-picker.tsx`, `booking-panel.tsx`, `resume-payment.tsx`, la pantalla `/reservas/<id>/pagar` | | |

### 23.3.3 · ⚠️ El fallo que hay que resolver el primer día

Éste no es un riesgo teórico. Está en el código y se puede señalar con el dedo.

`payment_webhook_events.event_id` es **la clave primaria** de la tabla:

```sql
create table public.payment_webhook_events (
  event_id     text        primary key,        -- id único del evento del proveedor
  booking_id   uuid        references public.bookings (id) on delete cascade,
  processed_at timestamptz not null default now()
);
```
— [`20260709210000_us703_webhook_idempotency.sql:9-13`](../supabase/migrations/20260709210000_us703_webhook_idempotency.sql)

Y `confirm_payment` la usa así ([`20260817180000:148-157`](../supabase/migrations/20260817180000_m02_acepta_sola_por_mentoria.sql)):

```sql
  if p_event_id is not null then
    insert into public.payment_webhook_events (event_id, booking_id)
    values (p_event_id, p_booking_id)
    on conflict (event_id) do nothing;
    if not found then
      select status into v_new from public.bookings where id = p_booking_id;
      return v_new::text;  -- evento ya procesado → no-op
    end if;
  end if;
```

**Con un pedido de tres líneas y un solo cobro, el webhook recibe UN evento.** Si llama tres veces
a `confirm_payment` con ese mismo `p_event_id`: la primera confirma la línea 1, y **la segunda y la
tercera devuelven un no-op silencioso**. Las otras dos reservas se quedan en `pending_payment` y
`expire_stale_bookings` las cancela **siete minutos después**. Resultado: el alumno paga tres
mentorías, recibe una, y las otras dos ni se reembolsan —la rama 1 del cron no encola nada porque
da por hecho que no se llegó a cobrar ([`20260826120000:95-125`](../supabase/migrations/20260826120000_b1_hold_siete_minutos.sql)).

Es exactamente el estado que la migración de **hoy** acaba de cerrar para el caso de una línea. La
solución es que la clave primaria pase a ser `(event_id, booking_id)` — o sea, **tocar la tabla de
idempotencia del camino del dinero**. Barato de escribir; caro de descubrir tarde.

> ⚠️ **Esto ya está escrito dentro del código, y a propósito.** `EY-177` se implementó el 27-ago
> (ver §23.3.6) y su módulo de carrito lleva este mismo fallo documentado en la cabecera —
> [`src/lib/cart/cookie.ts`](../src/lib/cart/cookie.ts), sección «PARA QUIEN RETOME EY-176»—
> para que quien abra el carrito buscando por dónde cobrar N líneas se lo encuentre antes de
> escribir la primera línea de SQL, y no aquí, que es un documento que hay que saber que existe.

### 23.3.4 · Lo que **no** hay que rehacer, y conviene decirlo

- **Los payouts no salen hoy de Postgres.** `process_scheduled_payouts` marca `provider =
  'simulated'` y `paid_at = now()` sin llamar a nadie
  ([`20260716140000:165-187`](../supabase/migrations/20260716140000_ep10_payouts.sql)). El puerto de
  pagos **no tiene** método `payout()` y está explicado por qué
  ([`src/lib/payments/port.ts:15-23`](../src/lib/payments/port.ts)). Así que repartir un cobro entre
  dos tutores **no es hoy un problema de Stripe Connect**: es un problema de modelo de datos. Con
  el diseño A, deja de serlo.
- Con el diseño A, **`payouts`, `payout_items`, `build_payout_for_tutor`, `tutor_balance`,
  `manage_payout`, `request_withdrawal` y el clawback de US-704 no se tocan.**

### 23.3.5 · EY-176 contra el hold de 7 minutos (ejecutado hoy)

El plazo lo aplica `expire_stale_bookings` con `p_payment_cutoff default interval '7 minutes'`
([`20260826120000:77`](../supabase/migrations/20260826120000_b1_hold_siete_minutos.sql)) y `pg_cron`
cada minuto (`:211-215`). La copia que se enseña es `HOLD_POLICY.minutes = 7`
([`src/lib/policy.ts:58-60`](../src/lib/policy.ts)).

**El dato que cambia la conversación:** desde D-2 la reserva —y con ella el hold— **ya se crea al
llegar a la pantalla de pago, no al pulsar pagar**. Está escrito en mayúsculas en el propio
fichero ([`checkout-form.tsx:100-118`](../src/components/checkout/checkout-form.tsx)) y la llamada
está en `:305-308`, dentro de un `useEffect` de montaje.

O sea que **la salida «que el reloj empiece al entrar a pagar» ya es la arquitectura de hoy**. Las
dos opciones del encargo, traducidas a lo que de verdad se decide:

| Opción | Qué significa de verdad | Coste extra sobre EY-176 | Veredicto |
| :-- | :-- | :-- | :-- |
| **A · El carrito no retiene nada; el hold nace al entrar a Pago** | Es prolongar lo que ya hace el checkout. `create_booking` multi-línea corre al llegar a la pantalla de pago y arranca **un** reloj para todo el pedido | **Cero.** Es el camino natural | 🟢 **Recomendado** |
| **B · El carrito retiene el horario al añadir** | Cada línea necesitaría su propio vencimiento. `expire_stale_bookings` corta por `bookings.created_at`, que es de la reserva entera: no sabe expresar «esta línea lleva 7 minutos y esta 2» | Columna de vencimiento por línea + rehacer las dos ramas del cron + un contador por línea en pantalla | 🔴 **Caro y frágil** |

⚠️ **El precio de la opción A, que hay que decirle al cliente:** el carrito **no garantiza el
horario**. Entre añadir y pagar, otro alumno puede llevarse el hueco, y `create_booking` lo
revalida contra `get_available_slots` en el último momento (`20260715170000:165-174`). Ese es
precisamente el caso de la decisión P-1: si al pagar falta una línea, ¿se cae el pedido o se
compra el resto?

Y un detalle que ya muerde hoy y multiplicaría con un carrito: `get_available_slots` descuenta
**toda** sesión no cancelada del tutor sin mirar de quién es, así que **un hold propio te bloquea a
ti mismo**. El checkout lo resuelve soltando lo propio antes de pedir
([`checkout-form.tsx:297-303`](../src/components/checkout/checkout-form.tsx),
[`src/lib/checkout/hold.ts:16-24`](../src/lib/checkout/hold.ts)). Con N líneas, esa limpieza hay
que hacerla N veces y entre líneas del mismo pedido.

---

### 23.3.6 · Qué dejó hecho `EY-177` (27-ago) y dónde se paró exactamente

Se implementaron **las dos primeras pantallas** del flujo de tres (selección → revisión → pago).
El motor de cobro **no se tocó**: ni `create_booking`, ni `payments`, ni la Session de Stripe, ni
el webhook, ni una migración. `EY-176` sigue entero.

| Decisión | Qué se hizo | Dónde |
| :-- | :-- | :-- |
| **Dónde vive el carrito** | Una **cookie** `ey-cart` con solo ids de mentoría e **instantes** (ms). Ni precios ni títulos. La lee el servidor con `cookies()`, así que la revisión y el contador son Server Components y **no hace falta el primer estado global** que temía §23.4 | [`src/lib/cart/cookie.ts`](../src/lib/cart/cookie.ts) |
| **El anónimo** | Funciona sin sesión y **sobrevive al registro**: la cookie es del navegador. `/carrito` cuelga de `(public)`; la sesión solo se exige al pagar, y el `?next=` del checkout devuelve al alumno con el carrito intacto | [`src/app/(public)/carrito/page.tsx`](../src/app/(public)/carrito/page.tsx) |
| **El precio** | Se **relee en servidor** contra `products` en cada visita; el de la cookie no existe. Regla de oro 2 intacta | [`src/lib/cart/resolve.ts`](../src/lib/cart/resolve.ts) |
| **El hold** | **Opción A**: el carrito no retiene nada, el hold sigue naciendo al entrar a pagar (D-2). La revisión revalida cada línea contra `get_available_slots` y distingue cuatro estados: libre, ocupado, caducado y «es tu propio hold» | ídem |
| **El paso a pago** | **Una línea** → la URL de siempre, `/reservar/<id>/checkout?slots=…`, sin un cambio. **Varias** → se dice en la interfaz que hoy se cobra una a una y cada línea lleva su botón. No se inventó ninguna semántica de pedido | ídem |

**Lo que sigue faltando y es exactamente `EY-176`:** el cobro de N líneas en uno. Las tres
preguntas de §23.6 (P-1 todo-o-nada, P-2 retención, P-3 un cobro o N) **siguen sin respuesta** y
ninguna se contestó por la vía de los hechos. El primer punto técnico a resolver es el de §23.3.3.

**Marchas atrás asumidas, las dos con el porqué escrito en el código:** el botón de la ficha ya no
va derecho al pago (N-33 pierde una pantalla de las que ganó, aunque **no** se vuelve a preguntar
la hora), y el checkout luce indicador de pasos, que contradice su aislamiento — puesto en la
**página** y no en el layout, para no arrastrar a `/reservas/[id]/pagar`.

---

## 23.4 · EP-25 · Las otras tres fichas

| Ficha | Qué existe | Qué falta | Bloqueo | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **EY-177** · Checkout en 3 pasos ✅ **hecho el 27-ago, ver §23.3.6** | El «Resumen del pedido» **ya existe** y es lo único que ve el alumno de lo que compra ([`checkout-form.tsx:603-686`](../src/components/checkout/checkout-form.tsx)); con `ui_mode:'form'` Stripe solo pinta los campos de pago. Hay precedente de asistente por pasos en `onboarding/wizard.tsx:44-60` | Partir una pantalla de 802 líneas en tres, **y decidir en cuál corre `create_booking`** | 🟠 Ver §23.6 P-4 | **L** |
| **EY-178** · «Agregar al carrito» | **Nada.** Cero coincidencias reales de carrito en todo el repo | Modelo de datos (= `EY-176`), **el primer estado de cliente compartido entre rutas del proyecto** y el contador en la cabecera | 🔵 `EY-176` | **M** solo el front |
| **EY-179** · Dos selectores fijos | Los dos selectores existen, pero **son enlaces, no controles**: `booking-panel.tsx` es un **componente de servidor** y todo el estado es la query | Altura fija con 8 fuentes de salto identificadas, o reescribir el panel como cliente | 🟠 Ver §23.6 P-5 | **M–L** |

**Detalle de EY-177 que no es de maquetación.** El checkout vive en su propio grupo de rutas con
layout desnudo —sin cabecera, sin navegación, sin chat— y la razón está escrita con la cita del
cliente dentro: [`src/app/(checkout)/layout.tsx:8-12`](../src/app/(checkout)/layout.tsx). Un
indicador de pasos visible ahí **contradice esa decisión**, igual que añadir una pantalla
contradice N-33 (se quitó una **por la queja contraria**). No es un impedimento técnico; es una
marcha atrás que hay que presentar como tal.

**Detalle de EY-178 que sube el coste.** No hay ni un `createContext` en `src/`, ni zustand, ni
redux, ni jotai en `package.json`. Todo es servidor + query params + `useState` local, y está
argumentado en el código (`booking-panel.tsx:406-410`: *«el estado es la query — se comparte, se
recarga y se vuelve atrás gratis»*). Un contador de carrito que sobreviva a la navegación es el
**primer** estado global del proyecto. Sí hay un precedente exacto de la insignia visual: la
campana de notificaciones (`notifications-bell.tsx:49`, `:79`).

**Detalle de EY-179 que decide el alcance.** En `/products/[id]` **el selector de mentoría no se
renderiza nunca**: con un solo producto, `single` es verdad desde el primer render y el bloque de
elegir mentoría está tras un `{single ? null : …}` (`booking-panel.tsx:150`, `:329`). O sea que
«dos selectores fijos» solo describe la **ficha del tutor**. Las ocho fuentes de salto verificadas:
horas vs marcador de posición (`:369-444`), bloque de precio (`:451-471`), título de una a cuatro
líneas (`:230-263`), la lista de mentorías cambia con el **día** (`:188`), el número de chips varía
con los datos (`:200-204`), el calendario salta 38 px entre meses de 5 y 6 filas (`:209-215`), el
margen del CTA difiere entre ramas (`:491` vs `:497`) y el panel entero se sustituye si no hay días
(`:272-276`).

---

## 23.5 · EP-26 · Las cinco fichas de trabajo mayor

### EY-186 · Carrusel Home: historial y mentores favoritos — **M–L** 🟠

| Mitad | Veredicto |
| :-- | :-- |
| **Historial** | 🟡 **Casi hecha, y de ayer.** El bloque «Tus últimos tutores» **ya existe** en el panel del alumno ([`src/app/(app)/app/page.tsx:337-353`](../src/app/(app)/app/page.tsx), commit `4f56bb2`). ⚠️ Pero **no es una consulta de historial**: se deriva de las filas que la página ya trajo, con `.limit(3)` sobre las completadas (`:94`) y `.slice(0, 4)` (`:140`). Un alumno con 20 clases ve los tutores de sus 3 últimas. Convertirlo en historial de verdad es ampliar la consulta |
| **Favoritos** | 🔴 **No existe nada.** `grep -riE "favou?rite\|favorito\|wishlist\|bookmark"` sobre `supabase/`: **cero coincidencias en 100 migraciones**. Tabla nueva + RLS + grants + `db:types` + componente de cliente con el toggle |
| **Carrusel** | 🔴 No hay ninguno, y `package.json` no trae embla/swiper/keen. `sugerencias-card.tsx:59-63` es una **rejilla** `grid sm:grid-cols-2 xl:grid-cols-3` |

> ⚠️ **Corrección al Doc 22 §22.2 D1**, que decía «no hay carrusel en ninguna parte del repo». Hay
> uno: la marquesina CSS de testimonios ([`testimonials.tsx:60-95`](../src/components/home/testimonials.tsx)
> + `globals.css:136-168`), sin JS y sin control del usuario. **No es reutilizable** para tarjetas
> con enlaces —las copias llevan `aria-hidden`— pero existe y el cliente puede señalarla.

**Lo que hay que preguntar antes de estimar en firme:** (a) *qué* Home —la portada pública o el
panel del alumno, que el menú llama «Inicio»—, y (b) si el favorito es del **tutor** o de la
**mentoría**. La segunda cambia la tabla, la pantalla y el significado del carrusel.

### EY-187 · Validación de área verificada — **XL** ⛔ **no se puede empezar**

Verificado punto por punto, y el resultado es más rotundo que lo que decía el Doc 22:

- `tutor_categories` son **dos columnas y ningún indicador de verificación**
  ([`20260722160000:86-90`](../supabase/migrations/20260722160000_onboarding_figma_fields.sql)), y
  las escribe **el propio tutor desde el navegador** por PostgREST, sin RPC ni puerta: política
  `tutor_categories_write_own … with check ( auth.uid() = tutor_id )` (`:117-119`), y el asistente
  hace borrar-todo + insertar (`tutor-onboarding-form.tsx:249-257`).
- **Las categorías de la mentoría no se contrastan contra las del tutor.** La política de escritura
  de `product_categories` comprueba **solo la propiedad del producto**
  ([`20260709120000_ep04_product_write.sql:60-76`](../supabase/migrations/20260709120000_ep04_product_write.sql)),
  y el formulario ofrece **todas** las categorías activas, no las suyas
  (`tutor/products/new/page.tsx:16-21`). Un tutor de «Idiomas» publica en «Programación» sin
  fricción, ni en base de datos ni en pantalla.
- **El KYC no tiene dimensión de materia.** `verification_documents` es
  `(tutor_id, doc_type, storage_path, status, reviewed_by, review_notes)` — ninguna columna de área
  ([`20260706150000_kyc.sql:26-38`](../supabase/migrations/20260706150000_kyc.sql)). Un «diploma» es
  un diploma; la base no sabe si dice Filología Inglesa o Ingeniería. Y la aprobación es **global**:
  `refresh_identity_status()` lo funde todo en un `identity_verification_status` y `review_tutor`
  pone un único `approval_status = 'approved'`.
- ⚠️ **Y son 6 documentos, no 7.** El frontend dejó `social_media` fuera hace tiempo
  (`verification-form.tsx:60-67`): las redes viven en `tutor_profiles.socials`. **El `CLAUDE.md`
  sigue diciendo 7** (C-14).
- «Tutor verificado» es **texto fijo sin condición** en cuatro sitios
  (`tutors/[id]/page.tsx:144-147`, `products/[id]/page.tsx:250`, `tutor-card.tsx:52` y `:123`,
  `tutor-summary.tsx:108`). Su único significado es que la consulta filtra
  `approval_status = 'approved'` (`queries.ts:401`). Y `home-faq.tsx:73` promete públicamente que se
  validan «títulos, certificaciones y trayectoria».

**La versión barata es trabajo tirado** y conviene decirlo con estas palabras: comprobar que las
categorías de la mentoría estén entre las que el tutor se puso él mismo no valida nada —el
ingeniero que quiera dar inglés marca «Idiomas» y pasa—. La versión que vale algo es **KYC por
área**: documento ligado a categoría, revisión del admin por categoría, y un estado de aprobación
por par (tutor, categoría). Eso es esquema nuevo, panel de admin nuevo y proceso operativo nuevo.

### EY-188 · Sincronización con Apple y Google Calendar — **L** 🟢 **empezable ya**

**No existe nada:** `ics`, `ical`, `webcal`, `VEVENT` sobre `src/` y `package.json` → cero
coincidencias reales. (Las pantallas de `tutor/availability` son el calendario **propio** del tutor,
no sincronización.)

Lo bueno, y son tres cosas: el enfoque por **suscripción** que pide la ficha **evita OAuth de Google
entero**; es un `.ics` servido en una URL con token opaco que los dos clientes releen solos; y —esto
importa más de lo que parece— **no necesita cron**, porque el que consulta es el cliente. El único
hueco de Vercel Cron ya lo gasta la purga de grabaciones (`vercel.json`), así que cualquier diseño
que empujara datos hacia fuera exigiría un cuarto reloj sin sitio donde correr.

Lo que hay que construir:

| Pieza | Coste |
| :-- | :-- |
| Columna de token opaco en `profiles` + migración con sus grants. ⚠️ **Ni `referral_code` ni `session_ref` sirven de token**: el primero lo aporta el propio usuario al registrarse (`20260729130000:17-34`) y el segundo es **no único a propósito** y su comentario dice «etiqueta para hablar, NO autoriza nada» (`20260817140000:130-142`) | S |
| Ruta pública `GET` sin cookie. El patrón fail-closed ya existe en los cron (`notifications-send/route.ts:26-33`: 503 si falta la variable, 401 si no cuadra). ⚠️ Diferencia clave: `CRON_SECRET` es **un** secreto global en variable de entorno; el de webcal es **por usuario, en base de datos y viajando en la URL** — un cliente de calendario no manda cabeceras | S |
| ⚠️ **Migración obligatoria de grants:** `sessions` (`20260806140000:26`), `bookings` (`20260817140000:258`) y `profiles` (`20260806170000:40`) **ya** tienen `grant select … to service_role`, pero **`products` NO** — su único grant es a `anon, authenticated` (`20260706120000:172`), y `service_role` **no hereda de `anon`**. Como el nombre de la clase sale de `products.title`, el feed se estrella con `permission denied` **en ejecución**, no en el build: la regla de oro 9, por cuarta vez | XS, pero **imprescindible** |
| Generación del `.ics`: UTC, **N eventos por paquete** (`create_booking` mete un `insert` por hueco, `20260715170000:211-217`), `UID` = `sessions.id` —**nunca `session_ref`**, que no es único—, `STATUS:CANCELLED` para las canceladas y `URL:` apuntando a **nuestra** `/room/<id>` | M |
| Pruebas en los dos clientes | S |

⚠️ **Tres avisos para la reunión.**

1. **No existe reprogramar.** Auditados los 23 `update public.sessions` de las migraciones:
   ninguno escribe `start_at` ni `end_at`. Solo se cancela. Así que hoy el argumento de «el `.ics`
   descargado se queda mintiendo» es más flojo de lo que parece. **Pero el §14 de los Términos ya
   contempla la reprogramación** (`terms-content.ts:244-250` y `:662-668`) y la FAQ la promete en
   plano (§23.7): es función pendiente, no descartada. El día que llegue, un `.ics` descargado pasa
   a estar activamente equivocado — **la suscripción es la que sobrevive a esa función**, y por eso
   vale la pena hacerla bien ahora aunque cueste más.
2. **`daily_room_url` está vacío en producción.** Solo lo escribía la rama simulada
   (`20260716120000:87`); con Daily real solo se guarda `daily_room_name` (`20260717120000:67`). Un
   feed que meta ahí el enlace de la sala publicará campos vacíos.
3. **La cadencia con la que Google y Apple releen un calendario suscrito la deciden ellos**, no
   nosotros, y suele medirse en horas. **Esto no se ha podido verificar desde el repo**: hay que
   comprobarlo con las dos aplicaciones antes de prometer «sincronización en tiempo real».

### EY-189 · «Reportar conducta» en la sala + bandeja de admin — **M** 🟢 **empezable ya**

**La ficha está más hecha por detrás y menos por delante de lo que se creía.**

🟢 **Ya construido, sin migración:**

- La tabla, con **columnas de triaje incluidas**: `handled_at`, `handled_by`
  ([`20260817210000:951-959`](../supabase/migrations/20260817210000_conversaciones_previas.sql)).
- El **índice de la cola de pendientes**: `… (created_at desc) where handled_at is null` (`:964-966`).
- La **RLS de admin**: lee todo (`:971-973`), y actualiza (`:977-980`) con `grant update (handled_at,
  handled_by)` acotado por columnas (`:983`) — nadie puede reescribir el `reason`.
- La RPC de escritura `report_conversation` (`:986-1021`).
- 🟢 **La palanca de moderación ya existe y no la llama nadie:** `set_conversation_blocked(uuid,
  boolean, text)` (`:1035-1074`), admin-gated por dentro. En `src/` solo aparece en los tipos
  generados.

🔴 **Lo que falta:**

1. **Ninguna pantalla de admin la lee.** `grep -rn "conversation_reports" src/` → solo
   `database.types.ts`. Confirmado el claim del encargo. El sitio del enlace nuevo son **dos arrays
   escritos a mano**: `app-sidebar.tsx:84-107` y `admin-footer.tsx:4-29`; y el contador natural es
   la fila de «colas que piden acción» de `admin/page.tsx:48-70`.
2. ⚠️ **Y el botón de reportar hoy no está donde hace falta.** Está montado en un solo sitio
   (`chat-thread.tsx:651`) **y bajo una condición**: `{esConsulta && listo ? …}` (`:637`), donde
   `esConsulta = hasBooking === false || …` (`:223`). Consecuencia verificada: **solo se puede
   reportar un hilo que nunca llegó a compra.** En el chat de una reserva pagada, en el del tutor y
   **en la sala** no aparece. Es lo contrario de lo que el propio componente dice defender.
3. **La sala no tiene botón** (`live-room.tsx`, 1188 líneas, cero coincidencias de «reportar»). Sí
   tiene `bookingId` en las props, y `conversation_of_booking(uuid)` ya resuelve booking →
   conversación y ya se llama desde dentro de la sala (`chat-thread.tsx:250-264`). **Y toda reserva
   garantiza conversación**: el trigger `bookings_ensure_conversation` la crea al insertar
   (`20260817210000:197-213`). O sea: **reusar la RPC desde la sala funciona sin migración**.
4. ⚠️ **Pero reporta el hilo, no la clase.** `report_conversation` valida pertenencia a una
   **conversación** (`:1007-1013`) y la tabla no tiene `session_id` ni `booking_id`. Si «reportar
   conducta» significa «esta clase», hace falta una columna nullable + sobrecarga de la RPC: **S con
   migración**.
5. **La lista cerrada de motivos no existe:** `reason` es texto libre con `check (btrim(reason) <>
   '')`. Una taxonomía es columna nueva.
6. ⚠️ **Un reporte se puede evaporar.** `purge_expired_messages` borra conversaciones pre-compra sin
   actividad a los 30 días, y el `cascade` se lleva los reportes (el comentario de la migración lo
   dice, `:1076-1078`). Un reporte sobre una consulta que no convirtió desaparece.

### EY-192 · Eliminación de cuenta con anonimización — **L** 🟠

**La cadena del Doc 22 §22.10 es CIERTA**, verificada línea a línea, y con una corrección de
recuento. Auditadas las **56** claves foráneas del esquema: ninguna se altera nunca después de
declararse, así que el sitio donde nace cada una es su estado final.

```
auth.users ──cascade──► profiles ──cascade──► bookings ──cascade──► payments ──restrict──► payout_items
20260606121500:31        20260709140000:35/:37   20260709140000:97      20260716140000:48
```

Y `reviews.booking_id` es `not null unique … on delete cascade`
([`20260716130000:18`](../supabase/migrations/20260716130000_ep09_reviews.sql)), con
`reviews.student_id` también `cascade` (`:19`).

**Conclusión que hay que llevar a la reunión, literal:** *borrar la cuenta de acceso no es una
alternativa a borrar las reservas — es la misma cosa.* Y **«borrar la reserva pero conservar la
reseña anónima» es imposible tal cual**: la reseña cuelga de la reserva con `cascade`.

> ⚠️ **Corrección al Doc 22 §22.2 G3**, que decía «cuatro FK que frenan». **Son tres**, y no todas
> frenan a la misma persona:
>
> | # | FK | Acción | Sitio | A quién frena |
> | :-- | :-- | :-- | :-- | :-- |
> | 1 | `verification_documents.reviewed_by → profiles` | **no action** (sin cláusula) | `20260706150000:32` | **Al admin**, no al tutor. Borrar a quien revisó un KYC falla |
> | 2 | `bookings.product_id → products` | **restrict** | `20260709140000:36` | **Al tutor**: `products.tutor_id` es `cascade`, así que el borrado llega al `restrict` |
> | 3 | `payout_items.payment_id → payments` | **restrict** | `20260716140000:48` | **A los dos**, en cuanto haya un pago liquidado |
>
> La cuarta que se contó de más es `tutor_profiles.tier_id → tutor_tiers on delete restrict`
> (`20260715170000:55`): apunta al revés — protege a los *tiers*, no a los perfiles.
>
> Y `RESTRICT` se comprueba **inmediatamente**, no al final de la sentencia: no hay orden de
> borrado que lo esquive.

**No existe ni una línea de código de borrado o anonimización** en todo el repo: `delete_account`,
`anonymize`, `anonimiz`, `deleteUser`, `admin.deleteUser` → los dos únicos aciertos están en un
script de siembra de dev. La cadena nunca se ha ejercitado.

**Evaluación del diseño alternativo del §22.10.** Es el correcto y es implementable. Puntos 1-5
(no borrar contabilidad, vaciar `profiles`, conservar `auth.users` inutilizada, reseñas sin autor,
no anonimizar a un tutor con saldo o clases futuras) se sostienen contra el código. Tres cosas que
el diseño **no** contempla y hay que añadirle:

1. ⚠️ **Hay DOS avatares, no uno.** `profiles.avatar_path` (privado) y `tutor_profiles.avatar_path`
   (público) son **independientes desde `20260724170000`**. Vaciar solo el primero deja la foto
   pública del tutor en el sitio. Y el bucket `avatars` es de lectura pública
   (`20260722160000:64-67`).
2. **Hay cinco buckets** —`avatars`, `chat-attachments`, `kyc-documents`, `product-images`,
   `tutor-materials`— y el segundo y el tercero son los sensibles: los **documentos de identidad**
   son el dato personal más fuerte de la plataforma. 🟢 Hay precedente reutilizable de borrado de
   objetos desde SQL: la purga de chat hace `delete from storage.objects where bucket_id =
   'chat-attachments' and name in (…)` (`20260729180000:36-38`).
3. **Cerrar la puerta de Google.** Reescribir el correo no basta: el emparejamiento va por identidad
   de proveedor. Hay precedente de tocar el esquema `auth` desde una función `security definer`
   (`handle_new_user`, `20260606121500:107-131`; y `20260806150000:69-90` lee `auth.users`), pero
   **no se ha podido determinar** si el equipo prefiere eso o la API de administración de Auth desde
   un Route Handler con la clave de servicio. Hay que decidirlo antes de estimar la última media
   jornada.
4. 🟢 **Confirmado el hallazgo de `home_testimonials`**: es una **función** `security definer`
   (`20260729150000:112`) concedida a `anon`, y su `where` es solo
   `comment is not null and length(btrim(comment)) > 0 and rating >= 4`. **No filtra por estado de
   producto ni de tutor.** Hay que arreglarlo en la misma pasada, o la portada seguirá enseñando la
   mentoría de una cuenta anonimizada. (Es un agujero que existe **hoy**, con productos en borrador.)

---

## 23.6 · Las preguntas al cliente — un solo mensaje

Sin estas respuestas, seis de las nueve no se pueden empezar. Van con la consecuencia puesta.

| # | Pregunta | Bloquea |
| :-- | :-- | :-- |
| **P-1** | **Si al pagar una de las tres mentorías del carrito ya no tiene hueco: ¿se cae el pedido entero o se compra el resto?** Hoy la reserva se cae entera y el mensaje es «ese horario acaba de ser tomado». Con tres tutores distintos eso pasará a menudo | `EY-176` |
| **P-2** | **¿El carrito reserva el horario o no?** Recomendamos que **no** hasta llegar a Pago: retener por línea obliga a un vencimiento por línea que hoy la base no sabe expresar. El precio es que entre añadir y pagar el hueco puede irse | `EY-176` `EY-178` |
| **P-3** | **¿Un pedido = un cobro, o un cobro por mentoría?** Un cobro y varias líneas es lo que pide la ficha; hay que saber que arrastra reembolsos parciales del mismo cargo y **un correo de confirmación por mentoría** | `EY-176` |
| **P-4** | **Los 3 pasos suben el número de pantallas, que es lo contrario de la queja de N-33, y el indicador de pasos rompe el aislamiento del checkout que vosotros mismos pedisteis.** ¿Se confirma la marcha atrás? | `EY-177` |
| **P-5** | **«Dos selectores fijos»: ¿en qué pantalla?** En la ficha de la mentoría **el selector de mentoría no existe** (solo hay una). Si es la ficha del tutor, hay ocho fuentes de cambio de tamaño y quitarlas todas obliga a reservar altura fija (con recorte) o a reescribir el panel | `EY-179` |
| **P-6** | **«Carrusel Home»: ¿la portada pública o el panel del alumno?** Y **¿el favorito es del tutor o de la mentoría?** Son dos tablas distintas y dos pantallas distintas. El bloque «Tus últimos tutores» del panel **ya está** desde ayer | `EY-186` |
| **P-7** | **«Área verificada» no tiene hoy contra qué validarse: las categorías se las pone el tutor y los diplomas no dicen de qué son.** ¿Qué se quiere de verdad: (a) que el admin apruebe categoría por categoría con documento delante —proceso operativo nuevo—, o (b) quitar «Tutor verificado» de donde promete más de lo que hay? | `EY-187` |
| **P-8** | **«Reportar conducta»: ¿lista cerrada de motivos o texto libre?** Hoy es texto libre y funciona. Una lista cerrada es una columna nueva. Y: **¿el reporte es de la persona o de la clase concreta?** Lo segundo también es columna nueva | `EY-189` |
| **P-9** | **Anonimización: vuestra respuesta V-10 se contradice.** «Borrar reservas» y «conservar reseñas anónimas» no pueden ser las dos: la reseña cuelga de la reserva. Proponemos **no borrar nada de la contabilidad y borrar la identidad**. ¿Se aprueba así? | `EY-192` |

---

## 23.7 · Lo que la documentación del repo dice mal (verificado)

Va aquí para que no se vuelva a citar como verdad.

1. **Doc 22 §22.2 B3 — «lo que quiere el cliente ya existe: el panel Tu selección».** No. Es un
   contador de cupo fijo de **un solo producto**; su estado es un `Set<string>` de horas sin
   producto ni tutor dentro (`slot-picker.tsx:141-143`, `:192-207`).
2. **Doc 22 §22.2 D1 — «no hay carrusel en ninguna parte del repo».** Hay uno: la marquesina CSS de
   testimonios (`testimonials.tsx:60-95` + `globals.css:136-168`). No sirve para tarjetas con
   enlace, pero existe y se ve.
3. **Doc 22 §22.2 G3 — «cuatro FK que frenan».** Son **tres**, y una de ellas
   (`verification_documents.reviewed_by`) frena borrar a un **admin**, no a un tutor. La cuarta
   apunta al revés.
4. **`CLAUDE.md` — «7 documentos de KYC» (C-14).** El frontend baja a **6** desde R29-02
   (`verification-form.tsx:60-67`): `social_media` se movió a `tutor_profiles.socials`.
5. **`docs/BACKLOG.md` ya no es espejo de Jira.** Ninguna de las nueve fichas aparece en él, y el
   único `EP-25` que menciona es un choque de numeración (`BACKLOG.md:93`).

Y un hallazgo que no venía en ninguna ficha y pesa más que varias de ellas:

> 🔴 **Se promete reprogramar y el código no sabe hacerlo.** **No existe ninguna vía que mueva
> `sessions.start_at`**: auditados los 23 `update public.sessions` de las migraciones, ninguno toca
> la hora. Solo se puede cancelar y volver a reservar — y con menos de 24 h eso **cuesta el 50 %**
> (RN-37).
>
> Hay que separar dos superficies, porque no dicen lo mismo:
>
> - **El contrato se cubre, y bien.** El §14 («Reprogramación» / «Rescheduling»,
>   `terms-content.ts:244-250` y `:662-668`) dice «generalmente podrán **solicitar**» y la sujeta
>   expresamente a «la disponibilidad del Tutor, **las funcionalidades de la Plataforma** y
>   cualquier condición aplicable». Con esa redacción, que hoy no exista **no incumple** el §14.
> - **La FAQ no se cubre.** `products/[id]/page.tsx:36-38` afirma en plano: *«Puedes reagendar con
>   al menos 24 horas de anticipación sin coste»*, y `home-faq.tsx:54-56` responde a «¿puedo
>   reprogramar?» con «Por supuesto» y a continuación describe **la política de reembolso**, no una
>   reprogramación. Eso es lo que hay que corregir: es una frase de marketing, XS de coste, y hoy es
>   la única de las dos que promete de más.

---

## 23.8 · Orden recomendado

### 🟢 Tanda 1 · Se puede empezar mañana, sin esperar a nadie

| Ficha | Qué | Esf. |
| :-- | :-- | :-- |
| **EY-189** | Bandeja de admin (el backend está entero) + sacar el botón de reportar del gate de «solo consultas» + botón en la sala reusando `conversation_of_booking` | **M** |
| **EY-188** | Feed `.ics` por suscripción con token opaco. **Incluye la migración de `grant select on products to service_role`**, o falla en ejecución sin avisar | **L** |

### 🟠 Tanda 2 · Arrancan el día que llegue su respuesta

`EY-192` (**L**, con P-9) · `EY-186` (**M–L**, con P-6, y la mitad de historial casi hecha) ·
`EY-179` (**M–L**, con P-5) · `EY-177` (**L**, con P-4 — y solo si se acepta que sube pantallas).

### 🔵 Tanda 3 · La épica de dinero

`EY-176` (**XL**) primero, y `EY-178` (**M**) detrás, nunca al revés. Con P-1, P-2 y P-3
contestadas. Y con el fallo de `payment_webhook_events` (§23.3.3) escrito en la primera migración,
no descubierto en producción.

### ⛔ Fuera de alcance hasta que haya decisión de negocio

`EY-187`. No es una cuestión de horas: **no hay dato contra el que validar**, y la versión barata
—cruzar categorías autodeclaradas contra categorías autodeclaradas— no valida nada. Recomendación:
mientras no exista KYC por área, **quitar «Tutor verificado»** de las cuatro superficies donde hoy
promete más de lo que la plataforma comprueba.

---

## 23.9 · Lo que no se pudo determinar

Honestidad sobre los huecos. Nada de esto se ha rellenado con suposiciones.

| Qué | Por qué | Qué haría falta |
| :-- | :-- | :-- |
| El texto exacto de las nueve fichas y de `EY-174` | No están en el repo; `docs/BACKLOG.md` no las recoge | Leerlas en Jira |
| Cada cuánto releen Google y Apple un calendario suscrito | Es comportamiento de terceros, no del repo | Prueba real con las dos aplicaciones antes de prometer plazos |
| Si `payments` de Stripe permite el reparto por línea con un solo cargo cuando llegue Connect | Connect está bloqueado por KYC y no hay adaptador de payouts en el repo | Cuenta de Connect operativa. **Hoy es irrelevante**: los payouts no salen de Postgres |
| Si la anonimización debe tocar el esquema `auth` desde SQL o ir por la API de administración | Hay precedente de las dos formas; el repo no ha tenido que elegir todavía | Media jornada de prueba y una decisión de equipo |
| El estado real de las nueve en Jira frente a `dev` | El propio `CLAUDE.md` avisa de que Jira va por detrás | Un repaso de Jira con el git log delante |

---

*Faim Lab · Doc 23 · Evaluación de las nueve épicas en `To Do` · 26 de agosto de 2026.*
