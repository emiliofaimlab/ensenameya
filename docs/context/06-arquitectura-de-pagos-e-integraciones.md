# DOC 6 — Arquitectura de Pagos/Payouts e Integraciones

> 🔴 **LA PARTE DE PAGOS DE ESTE DOCUMENTO NO MANDA.** Manda
> **`docs/DICTADO-PAGOS.md`** (9-sep-2026, aprobado por el cliente y desplegado en producción).
> Lo que queda aquí de cobro y payout es el **esqueleto arquitectónico** —puertos, ruteo en datos,
> dinero server-side— y remite al dictado para toda pregunta de **quién cobra, quién paga y cómo se
> ve**. Los **costes** de cada tramo y quién asume cada comisión los manda
> `docs/PAGOS-Y-PAYOUTS.md`.
>
> Lo que este documento sí sostiene por sí solo son las **integraciones no financieras**: Daily
> (§6.9), Auth (§6.10), correo (§6.11), referidos (§6.12), monitoreo (§6.13), Storage (§6.19) y
> chat/grabación (§6.18).

| Campo | Valor |
| :-- | :-- |
| **Documento** | 6 — Arquitectura de Pagos/Payouts e Integraciones |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Doc 1 (`payments`/`payouts`/`payment_routing_rules`), Doc 2 (M6/M7), Doc 3 (service role) |
| **Deroga en pagos a** | `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md` (retirado) |
| **Le deroga la parte de pagos** | `docs/DICTADO-PAGOS.md` |

---

## 6.1 Propósito y principios

Define **cómo se integran** los servicios externos del MVP y qué forma tiene la capa de pagos, sin
acoplar el núcleo del producto a un proveedor concreto. Principios que siguen vigentes en el código:

1. **Capa agnóstica (ports & adapters).** Una interfaz común (`PaymentProvider`, con dos
   especializaciones) y un resolvedor por geografía. Sustituir o añadir un riel es un adaptador
   nuevo más una fila de ruteo.
2. **Ruteo en datos, nunca hardcodeado** (RN-16): la tabla `payment_routing_rules`.
   ⚠️ **Tocar esa tabla es una migración**, no un `UPDATE` a mano (regla de oro 5 del `CLAUDE.md`).
   Un `UPDATE` solo cambia el ambiente donde se ejecuta, y así es como dev y producción acaban
   ruteando distinto sin que nada avise.
3. **Escritura financiera solo en el servidor** (S-15, RN-26): el webhook y los jobs escriben con
   `service_role` desde Route Handlers; el cliente solo lee.
4. **El split es independiente del proveedor** (RN-08): se aplica sobre el cobro según el tier
   (S-08), congelado en `bookings`/`payments`.
5. **Las dos puntas se resuelven con claves distintas.** El **cobro** lo decide el país del
   **alumno**, por fees; el **payout**, el del **tutor**. Es el punto 1 del dictado, y es lo que hace
   que el «cuello de botella es el payout» ya no describa el ruteo: hay dos decisiones, no una.

---

## 6.2 Puertos (interfaces) y resolución

El puerto vive en **`src/lib/payments/port.ts`** y tiene dos formas, porque no todos los rieles
tienen adaptador:

```typescript
// Lo común a todo riel
interface PaymentProvider { readonly key: string; }

// Riel con máquina detrás: stripe · dlocal · wise · paypal · simulated
interface PspProvider extends PaymentProvider {
  missingChargeConfig(): string | null;      // la credencial es el interruptor
  charge(input: ChargeInput): Promise<ChargeResult>;
  canRefund(): boolean;
  refund(input: RefundInput): Promise<RefundResult>;
  missingPayoutConfig(): string | null;
  payout(input: PayoutInput): Promise<PayoutResult>;
  verifyWebhook(input: WebhookInput): WebhookVerificacion;
}

// Riel que ejecuta una PERSONA: 'manual' (Venezuela) y 'banco-manual'
interface LocalProvider extends PaymentProvider { /* sin charge ni payout */ }
```

La resolución vive en **`src/lib/payments.ts`**, en dos funciones (no en una clase `PaymentRouter`),
y devuelve **listas de candidatos** en lugar de un proveedor único.

```typescript
chargeProvidersFor(payerCountry)                    // país del ALUMNO
payoutProviderFor(payeeCountry, fundingProvider, tutorId)  // país del TUTOR
```

- `ChargeResult` tiene **cuatro** formas —`ChargeEmbebido`, `ChargeTransparente`,
  `ChargeRedirigido` y `ChargeFallido`—, porque el punto 2 del dictado exige que el formulario viva
  dentro del sitio: Stripe monta el suyo con `ui_mode: 'form'` + `client_secret` y dLocal con
  `allow_transparent`. `ChargeRedirigido` sobrevive como respaldo, no como camino normal.
- `payoutProviderFor` puede devolver **`null`**, que significa «hoy ningún candidato puede pagar
  esta orden». No es un fallo: la fila se queda esperando.
- El registro de rieles (`RIELES`, mismo fichero) dice de cada uno qué **dato** de cobro pide
  (`banco` o `identificador`), **quién ejecuta** (`proveedor` o `persona`), si está **atado a un
  balance** y si **puede pagar hoy**.

> El core nunca llama al SDK de un proveedor: siempre al adaptador. La **parte pura** de cada
> adaptador vive aparte (`*-mapeo.ts`) con su comprobación ejecutable al lado (`*-mapeo.check.ts`),
> para poder probarla sin red ni credenciales.

---

## 6.3 Tabla de enrutamiento y algoritmo de resolución

`payment_routing_rules` responde a **dos preguntas con dos claves distintas**, y la función que la
lee es `ruta_de_pago(pais)`:

```text
cobro  = ruta_de_pago(payments.payer_country).charge_providers   -- país del ALUMNO
payout = ruta_de_pago(payee_country).payout_providers            -- país del TUTOR
```

- **Las dos columnas son listas ordenadas por fee.** La primera que pueda es la que ejecuta.
- La clave de búsqueda es `payee_country` **en las dos preguntas**; lo que cambia es qué país se le
  pasa. ⚠️ La columna `payer_country` **de esta tabla** no interviene: `ruta_de_pago()` filtra
  `payer_country is null`, así que una fila con ese campo puesto no la ve nadie.
- La fila con país `null` es el **comodín**: `{stripe}` para cobrar, y con eso cualquier país del
  mundo puede comprar. **No hay corredor sin regla**, así que RN-33 ya no bloquea reservas.
- **El país del alumno sale de su zona horaria** (`timezone_countries`,
  `pais_de_cobro_por_zona()`) y **se congela al crear la reserva** en `bookings.payer_country` y
  `payments.payer_country`. No se recalcula al pagar.

Quién cobra y quién paga, país por país: **`docs/DICTADO-PAGOS.md` §2 y §3**.

---

## 6.4 Catálogo de adaptadores

Los rieles que existen hoy en `src/lib/payments.ts`. Cuatro con `ejecuta: 'proveedor'`, dos con
`ejecuta: 'persona'`.

| Riel (`key`) | Cobra | Paga | Dato que pide | Notas |
| :-- | :-- | :-- | :-- | :-- |
| `stripe` | Sí | Sí | banco | Cobra donde el país del alumno lo rutea. Paga como **tercer riel de Banco, detrás de Wise** (D-1 aprobada): la cuenta la crea la plataforma con lo que el tutor teclea en nuestro formulario, y él no ve el nombre de Stripe. No puede crear cuentas en US ni BR. |
| `dlocal` | Sí | Sí | banco | Cobro **transparente** dentro del sitio. Atado a balance: paga con lo que él mismo cobró. |
| `wise` | No | Sí | banco | Se fondea desde nuestro banco (`ataduraDeBalance: false`). Cobertura por **formato de cuenta**, no país a país. |
| `paypal` | No | Sí | identificador | Se paga al identificador de la cuenta **conectada**, no al correo. |
| `manual` | No | Persona | identificador | Zinli · Zelle · Binance. **Solo Venezuela.** Lo cierra el admin con `manage_payout`. |
| `banco-manual` | No | Persona | banco | Transferencia a mano; último recurso para que ninguna orden se quede sin vía. |
| `simulated` | Sí | — | — | Adaptador de pruebas. `confirm_simulated_payment` exige ser dueño **y** `provider = 'simulated'`. |

**La lista de arriba es completa.** No hay adaptador de MercadoPago, de Bamboo ni de cripto, y
Venezuela no paga en USDT: paga por el riel `manual`, porque ninguno de los tres rieles automáticos
la alcanza (dictado §3).

⚠️ **Que un riel «pueda pagar» no significa que pueda pagarle a cualquiera.** `puedePagar()` mira
solo la credencial. El segundo filtro es `rielSirveParaEsteTutor` (`src/lib/payments/riel-viable.ts`),
que descarta a los candidatos para los que este tutor no tiene datos **antes** de elegir. Sin ese
filtro un tutor venezolano con Zinli no cobraba nunca: se elegía PayPal, el adaptador devolvía
`sin-datos` y la orden se quedaba en `scheduled` para siempre.

---

## 6.5 Matriz de decisión por corredor

**Vive en `docs/DICTADO-PAGOS.md` §3** («Dónde llega cada riel», medido contra las APIs de los tres
proveedores). No se duplica aquí para que no haya dos listas que mantener y se desincronicen.

Dos cosas que conviene traerse de allí porque cambian cómo se lee este documento:

- **Venezuela es el único país que ninguno de los tres rieles automáticos alcanza**, y de ahí sale el
  pago manual. No es una política de producto: es cobertura medida.
- **Llegar al país no basta: hace falta fila en `payout_country_rules`**, que es la que dibuja el
  formulario donde el tutor teclea su cuenta. Sin fila no hay tarjeta de banco aunque el riel llegue.
  Hoy la tabla cubre 55 países; los que quedan fuera necesitan un catálogo de códigos de banco, no
  un proveedor nuevo.

---

## 6.6 Flujo de cobro (charge)

Secuencia server-side; el cliente nunca escribe `payments` (S-15):

| # | Paso | Resultado |
| :-- | :-- | :-- |
| 1 | Alumno confirma slots | `booking: pending_payment`; snapshot de `tier_split_pct`, `payer_country`, `payee_country` y montos |
| 2 | `create_booking_line` crea el `payment` (`pending`) y **congela `payments.provider`** | Fila `payments` (service role) |
| 3 | `chargeProvidersFor(payer_country)` | Lista de candidatos de cobro, ordenada por fee |
| 4 | `provider.charge(...)` → formulario **dentro del sitio** | `ChargeEmbebido` (Stripe) o `ChargeTransparente` (dLocal). La tarjeta vive en iframes del proveedor: mismo perfil PCI que un checkout alojado |
| 5 | El proveedor confirma vía **webhook firmado** | `payment: paid` (M6) |
| 6 | Efectos del `paid` | `booking: pending_acceptance` (RN-38, no `confirmed`); al aceptar el tutor se crean `sessions` + salas Daily y se devenga el `payout_item` (RN-30) |
| 7 | Fallo/expiración | `payment: failed`, o ventana vencida → `booking: cancelled` (RN-27) |

⚠️ **El snapshot gana sobre el ruteo.** Cambiar el código de resolución no cambia quién cobra una
reserva ya creada: `payments.provider` está congelado desde el paso 2.

⚠️ **Dos excepciones inevitables al «siempre dentro»**, ninguna evitable por código: el **3DS** del
banco emisor saca al alumno de la página (la vuelta aterriza en nuestra confirmación), y los
**medios locales** de dLocal (PIX, boleto, OXXO, efectivo) solo existen en su formulario alojado —el
transparente hace solo tarjeta. Es la decisión abierta D-3 del dictado.

**Cálculo del split** (al crear el pago, congelado):

```text
gross_amount        = total cobrado al alumno (minor units)
tutor_net_amount    = round(gross_amount * tier_split_pct / 100)
platform_fee_amount = gross_amount - tutor_net_amount
# tier_split_pct es snapshot del tier al momento de la reserva (S-08, RN-08)
# independiente del proveedor; las comisiones del PSP se contabilizan aparte
```

---

## 6.7 Flujo de payout

| # | Paso | Resultado |
| :-- | :-- | :-- |
| 1 | `payment: paid` | Se crea `payout_item` con `tutor_net_amount` (M7 `pending`) |
| 2 | `run-payout-batch` (pg_cron, **lunes 03:00**) | Agrupa items con retención **de 7 días** ya vencida → `payout: scheduled` |
| 3 | `payoutProviderFor(...)` elige entre los candidatos que **sirven para este tutor** | `provider.payout(...)` → `processing` |
| 4 | Desenlace del proveedor | `paid` (+ `provider_payout_id`) → **NTF-12**; `failed` → **NTF-16**; o **«en duda»**, que deja la fila en `processing` y la barre la pasada siguiente |
| 5 | Incidencia | El admin puede `on_hold`/reintentar, y cerrar a mano un riel manual |

- **Retiro self-service** (RN-40): el tutor dispara su propio payout con `request_withdrawal`, solo
  sobre saldo con retención vencida.
- **El payout sigue el balance de origen, no al tutor.** `payouts.funding_provider` dice de qué
  balance sale el dinero; los rieles **atados a balance** (dLocal, Stripe) solo pueden pagar lo que
  ellos mismos cobraron. Un tutor con cobros de dos corredores recibe **dos órdenes de retiro**.
  Wise y PayPal se fondean desde nuestro banco y no dependen de quién cobró.
- **El fee manda el orden; el saldo es una red de seguridad.** Operaciones fondea las cuentas a
  diario antes del ciclo (dictado §3, «la tarea diaria de operaciones»).
- **FX/moneda (DP-07):** si `settlement_currency` ≠ `currency`, se registran `settlement_currency` y
  `fx_rate` en `payments`.

🔴 **El descenso entre rieles ocurre ANTES de elegir, nunca después.** `rielSirveParaEsteTutor`
(`src/lib/payments/riel-viable.ts`) descarta a los candidatos para los que este tutor no tiene datos,
y `payoutProviderFor` se queda con el primero que sobrevive. **Una vez elegido no hay segunda
oportunidad:** en `src/app/api/cron/payouts-process/route.ts:734` el caso `rechazado` marca la orden
`failed`, escribe `failure_reason` y hace `break`. Un rechazo del proveedor **no** prueba el
siguiente candidato — hay que reintentar desde el panel de admin, y el reintento vuelve a resolver
desde cero. Que la orden «baje al siguiente candidato» tras un rechazo es trabajo por escribir, no
comportamiento actual.

---

## 6.8 Webhooks, idempotencia y conciliación

- **Dónde viven:** `src/app/api/webhooks/stripe` y `src/app/api/webhooks/dlocalgo`, **Route
  Handlers** de Next. **No hay Edge Functions** en este proyecto (decisión de `20260717120000`):
  todo el código server-side son Route Handlers y Server Components.
- **Verificación de firma** obligatoria (`verifyWebhook`), sobre el **cuerpo crudo**; sin firma
  válida se responde 400 (RN-34).
- **Idempotencia:** cada evento se procesa una sola vez; los reintentos no duplican efectos
  (RN-26). Se persisten `provider_payment_id`/`provider_payout_id` y `provider_metadata`.
- **Acreditar un cobro es exclusivo del webhook.** `confirm_payment` no es invocable por
  `authenticated`; la ruta de confirmación de dLocal **no escribe en `payments`**.
- **Reembolsos (RN-37, que cerró DP-03):** ≥24 h = 100 %, <24 h por el alumno = 50 %, cancelada por
  el tutor = 100 %. Los porcentajes viven en `src/lib/policy.ts` y de ahí los leen las páginas
  legales. El camino de cancelación **encola** la petición en `refund_requests`; quien habla con el
  PSP es el job `/api/cron/refunds-process`. Ese desfase tiene consecuencias en el aviso al alumno
  → Doc 7 §7.3, NTF-10.
- **Conciliación:** el barrido de `payouts-process` es lo que hoy cierra el círculo contra el
  proveedor para las órdenes en duda. Un job de conciliación de cobros sigue sin escribirse.

---

## 6.9 Integración de video (Daily)

- **Provisión de sala** al confirmarse la reserva: `sessions.daily_room_name` /
  `daily_room_url` por sesión. ⚠️ El nombre de sala se **lee** de esa columna; derivarlo otra vez es
  lo que hacía fallar en silencio a la descarga de grabaciones.
- **Dos ventanas distintas, y confundirlas cuesta dinero:**
  - `session_access_window()` — cuándo la **sala admite gente**: `start_at − 10 min` a
    `end_at + 10 min` (RN-18, S-45). Alimenta `access_opens_at`/`access_closes_at`.
  - `session_live_window()` — cuándo la **clase está ocurriendo**, y de ella cuelgan
    `close_expired_sessions()`, `bookings.completed_at` y con él el payout.
  Hoy dan el mismo rango; **son funciones separadas a propósito** y mover una no mueve la otra.
- **Token de acceso** generado **server-side al unirse** (`mintToken`), nunca almacenado, con rol y
  `exp` alineado al fin de la sesión, y `eject_at_room_exp` detrás.
- **Chat de Daily apagado** (`enable_chat: false`): su chat se cobra aparte y no persiste. El chat
  del producto es propio (§6.18).
- **Grabación: se graba SIEMPRE.** `recording_allowed()` devuelve `true` desde `20260902100000`
  —el cliente reformuló la regla a «obligatoria y notificada»— y por eso la casilla de la sala dice
  «Entiendo» y no «Acepto». ⚠️ `enable_recording: "cloud"` solo enciende el **botón**; quien
  **arranca** la grabación es `start_cloud_recording` en el token. Daily no tiene propiedad de sala
  para esto.
- **No hay tabla `recordings` ni URL guardada, a propósito:** se consultan a Daily en el momento
  (`src/lib/daily.ts`, `src/app/api/recordings/[sessionId]`). La retención de 30 días la ejecuta
  `/api/cron/recordings-purge`.
- **Coste por uso:** el gasto es por **minuto-participante**, no por sala abierta. Una sala vacía
  con `exp` lejano no cuesta nada.

---

## 6.10 Autenticación (Supabase Auth)

- **Métodos:** email/password + **Google OAuth**. `auth.users` es canónico; `profiles` extiende 1:1
  (S-17), y el alta la hace el trigger `handle_new_user`, que inserta el rol `alumno` **a propósito**
  (activar tutor es otro paso).
- **Sesión:** JWT de Supabase; `auth.uid()` alimenta la RLS (Doc 3). El refresco vive en
  `src/proxy.ts` → `src/lib/supabase/middleware.ts`.
- ⚠️ **Las pantallas NO validan sesión con `auth.getUser()`.** Ese patrón se borró el 9-sep-2026 por
  lento —revalidaba contra Auth en cada pantalla, varias veces. Se usan
  `getSessionContext` / `requireUser` / `requireRole` de **`src/lib/auth/server.ts`**.
- **Onboarding:** exige `timezone` (RN-01) y teléfono E.164 (RN-44); marca `onboarding_complete`.
- **Verificación de email** y **reset** (NTF-01/02) vía Auth. ⚠️ La confirmación de correo está
  **encendida en producción y apagada en dev**: es una asimetría real que esconde fallos de auth.

---

## 6.11 Email transaccional — **Resend**

**DP-05 / C-11 resuelta: Resend.** Es el único de los tres candidatos que deja enviar y probar
**sin dominio verificado**. El adaptador es `src/lib/email.ts`; el remitente sale de `EMAIL_FROM` y
por defecto es `onboarding@resend.dev`, porque el dominio propio sigue bloqueado por la migración de
dominio.

```typescript
// El puerto sigue siendo el mismo: cambiar de proveedor es esta función.
send({ to, templateKey, vars, locale })   // locale: 'es' por defecto (S-38)
```

- El **catálogo de notificaciones** y sus disparadores está en el **Doc 7**.
- **Sin `RESEND_API_KEY` la cola no se toca**: las filas se quedan `pending`, nunca `failed`.
- ⚠️ **`process_notifications()` ya solo informa.** Antes marcaba la cola entera como `sent` sin
  enviar nada. El envío real es el job `/api/cron/notifications-send`.

---

## 6.12 Referidos (Referral Factory — integración frontend)

- **Sin lógica interna** (RN-21, D-03): el programa se configura en Referral Factory; la plataforma
  solo **pinta el enlace/embed** (`src/lib/referral.ts`).
- 🔴 **La atribución NO existe.** El mecanismo escrito es una cookie: el proxy guarda el `?ref=` en
  `ey-ref` (`src/lib/supabase/middleware.ts`), viaja al metadata del alta y `handle_new_user` lo
  aterriza en `profiles.referral_code`. **Y ese `?ref=` no llega nunca**: Referral Factory no manda
  al referido a la app con un código, lo lleva a una página de oferta alojada por ella. Además
  `profiles.referral_code` **no lo lee nadie**: se escribe, se anula en la baja de cuenta y no entra
  en ningún cálculo.
- **`REFERRAL_FACTORY_API_KEY` no se lee en ninguna línea de código.** El interruptor real es la
  **URL** (`NEXT_PUBLIC_REFERRAL_URL` / `_EMBED_URL`), no una clave.
- ⚠️ El subdominio `embed.*` se puede enmarcar; la URL pública **no** (`frame-ancestors`) y sale en
  blanco.
- **Reglas del programa** (monto, conversión válida, límites): externas, **DP-04**.

---

## 6.13 Monitoreo y observabilidad

- **Sentry instalado** (`@sentry/nextjs`), en `src/instrumentation.ts` y
  `src/instrumentation-client.ts`. Sin DSN el SDK arranca **apagado** y no manda nada: el
  interruptor es `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` en Vercel.
- **Logs de pago/payout:** `provider_metadata` (que lleva el rastro `c2` de cada intento de payout)
  + log estructurado de webhooks y jobs, **sin PII**: ni nombre, ni documento, ni número de cuenta.
- ⚠️ **Un job de `pg_cron` que falla no se lo dice a nadie**: no hay build en rojo ni fila en
  `notifications`, el error se queda en `cron.job_run_details`. Y **no basta con leer las últimas
  N filas**: los diarios y el semanal se caen de la ventana. Agregar por `jobname` y `status`.
- `SUPUESTO S-47`: métricas operativas mínimas (tasa de fallo de cobro, payouts en `failed`,
  latencia de webhook) en el panel admin. Sigue sin construirse.

---

## 6.14 Seguridad

- **Sin datos de tarjeta en la plataforma.** Con el checkout embebido esto **sigue siendo cierto**:
  los campos viven en iframes del proveedor. La clave del tokenizador de dLocal ni siquiera es
  nuestra — está en su SDK.
- **Secretos** en variables de entorno del servidor; nunca en el cliente ni en `NEXT_PUBLIC_*`.
- **Firmas de webhook** verificadas (RN-34); endpoints idempotentes.
- **Escritura financiera** solo `service_role` (S-15); RLS default-deny (Doc 3).
- ⚠️ **`service_role` se salta la RLS pero NO los `grant` de tabla.** Con «auto-expose new tables»
  OFF, un job con `service_role` come `permission denied` **en tiempo de ejecución** hasta que su
  migración declare `grant … to service_role`. Tabla que toque un job = grant explícito, en la
  misma migración.
- **Los tres jobs HTTP exigen `CRON_SECRET` y fallan cerrado (503) sin ella.**

---

## 6.15 Configuración / variables de entorno

Las que el código lee de verdad. **Ninguna falta rompe la app:** el camino se cae al simulado o la
cola se queda `pending`. Poner la variable es el despliegue.

| Variable | Ámbito | Uso |
| :-- | :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente | Auth + lectura sujeta a RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor | Escritura financiera y jobs (S-15) |
| `STRIPE_API_KEY` · `STRIPE_PUBLISHABLE_KEY` · `STRIPE_WEBHOOK_SECRET` | servidor / cliente | Cobro embebido y webhook firmado |
| `DLOCALGO_API_KEY` · `DLOCALGO_SECRET_KEY` (+ `DLOCALGO_API_BASE`, `DLOCALGO_FX_SPREAD`) | servidor | Cobro transparente y payout |
| `PAYPAL_CLIENT_ID` · `PAYPAL_SECRET` (+ `PAYPAL_API_URL`) | servidor | Payout a cuenta conectada |
| `WISE_API_TOKEN` (+ `WISE_API_URL`, `WISE_PRIVATE_KEY`) | servidor | Payout. `WISE_PRIVATE_KEY` es **opcional**: solo hace falta si la cuenta queda sujeta a SCA |
| `DAILY_API_KEY` | servidor | Salas y tokens |
| `RESEND_API_KEY` (+ `EMAIL_FROM`) | servidor | Correo transaccional |
| `CRON_SECRET` | servidor | Autoriza los endpoints de cron |
| `NEXT_PUBLIC_REFERRAL_URL` · `NEXT_PUBLIC_REFERRAL_EMBED_URL` (+ `_TUTOR`) | cliente | Enlace y embed de referidos |
| `SENTRY_DSN` · `NEXT_PUBLIC_SENTRY_DSN` | ambos | Monitoreo |
| `NEXT_PUBLIC_SITE_URL` | ambos | URL canónica del sitio |

---

## 6.16 Reglas y supuestos introducidos en este documento

**Reglas de negocio**

| ID | Regla | Estado |
| :-- | :-- | :-- |
| RN-33 | Un corredor sin regla activa en `payment_routing_rules` bloquea la reserva con mensaje de cobertura. | **Inerte**: la fila comodín (`null` → `{stripe}`) hace que ningún país quede sin regla de cobro. |
| RN-34 | Todo webhook verifica firma y se procesa de forma idempotente; lo no firmado se rechaza. | **Vigente y en código.** |

**Supuestos**

| ID | Supuesto | Estado |
| :-- | :-- | :-- |
| S-28 | Checkout **alojado** por el proveedor. | 🔴 **Derogado** por el punto 2 del dictado: el formulario vive dentro del sitio. Lo que sobrevive es la consecuencia —no guardamos datos de tarjeta— porque los campos siguen en iframes del proveedor. |
| S-45 | Ventana de sala ≈ 10 min antes / 10 min después. | **Confirmado en código** (`session_access_window`). |
| S-46 | La integración de referidos consume el artefacto de Referral Factory; la conversión se gestiona fuera. | Vigente, pero **la atribución no existe** (§6.12). |
| S-47 | Métricas operativas mínimas de pago/payout/webhook. | **Sin construir.** |

**Decisiones pendientes:** **DP-01 resuelta** (dLocal + Stripe cobran; PayPal, Wise, dLocal y Stripe
pagan), **DP-02 resuelta** (retención de 7 días, lote semanal), **DP-03 resuelta** (RN-37),
**DP-05 resuelta** (Resend). Siguen abiertas **DP-04** (reglas de referidos), **DP-06**
(agregación de payout, hoy por lote y por `funding_provider`), **DP-07** (FX/settlement) y **DP-08**
(no-show). Estado consolidado en Doc 9 §9.2. Las abiertas del propio dictado son **D-3** (medios
locales de dLocal) y **D-6** (tarjeta guardada).

---

## 6.17 Nota sobre diagramas

Los **diagramas de secuencia** (charge y payout) y el **mapa de integraciones** se agregan en la
pasada final (Mermaid). El `.md` es la fuente.

---

## 6.18 Integraciones v3 — Chat (EP-17) y Grabación (EP-18)

> Modelo de datos en Doc 01 §1.10.

**Chat (EP-17):**
- **Supabase Realtime** (`postgres_changes`) sobre la tabla `messages` — parte del stack, sin coste
  nuevo. El de Daily no se usa: es efímero y no se descarga.
- Ventana «2 días antes» por fecha UTC. **Retención de 30 días** con purga en pg_cron
  (`purge-expired-messages`), y **descarga previa** `.txt`/`.json` (decisión 22 del cliente).
- Adjuntos en Storage con prefijo `chat_`.
- RLS por participantes; UTC; no toca el módulo de pagos.

**Grabación (EP-18):**
- **Cloud recording de Daily contratado y funcionando** — no es un add-on pendiente.
- Flujo real: el token lleva `start_cloud_recording` → la grabación se **consulta a Daily** cuando
  se pide (no se guarda URL) → botón de descarga → purga a los 30 días.
- 🔴 **RN-42 está derogada.** Exigía consentimiento mutuo antes de entrar a la sala; el cliente
  reformuló la regla el 2-sep-2026 a **grabación obligatoria y notificada**, y `recording_allowed()`
  devuelve `true` siempre. La casilla de la sala es un «Entiendo». La versión de RN-42 que sigue
  viva es la de **retención**: 30 días desde `completed_at`, que es lo que prometen las páginas
  legales.

---

## 6.19 Almacenamiento (Supabase Storage)

Seis buckets, todos declarados en migraciones con sus políticas (regla de oro 1):

| Bucket | Contenido | Visibilidad |
| :-- | :-- | :-- |
| `kyc-documents` | Documentos de verificación del tutor (S-10, S-19) | **Privado** |
| `chat-attachments` | Adjuntos del chat de reserva | Privado, por participantes |
| `support-attachments` | Adjuntos de los mensajes de contacto | Privado |
| `tutor-materials` | Material que el tutor comparte | Privado |
| `avatars` | Foto de perfil | Público |
| `product-images` | Imagen de la tutoría | Público |

- El acceso a lo privado va por **Storage API** con la sesión del usuario, no por URL adivinable.
- La ruta de un documento de KYC es `<uid>/<doc_type>`, y la función de alta lo comprueba: subirlo
  a otra ruta falla.

---

*Fin del Documento 6.*
