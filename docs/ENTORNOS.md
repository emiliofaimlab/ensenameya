# Enséñame Ya — Ambientes dev / prod (US-1603)

> **Objetivo:** dos entornos **100 % cloud e independientes** — **dev** y **prod** — cada uno con su
> proyecto Supabase y su deploy en Vercel, con migraciones aplicadas por CI.
> **No hay stack local**: se desarrolla directamente contra **dev cloud**.
> Cabe en el free tier de Supabase (2 proyectos/org).
> Este doc trae (a) la arquitectura y **qué variable va en qué entorno**, (b) el flujo sin local,
> (c) el checklist de setup, (d) los **trabajos programados** y (e) el montaje del **webhook de Stripe**.

---

## 1. Arquitectura

```
Rama git         Vercel (1 proyecto)       Supabase
─────────        ───────────────────       ────────────────────
main       ───▶  Production          ───▶  ensenameya-prod  (nrzsyysqanbrcgtslfte)
dev / PRs  ───▶  Preview             ───▶  ensenameya-dev   (lbtpnszjjsxbeileqsja)
```

- **Un proyecto Vercel** conectado al repo; separa ambientes por **env vars con scope** (Production vs Preview).
- **Dos proyectos Supabase** (dev y prod), aislamiento real de datos. Sin Docker, sin `supabase start`.
- **Migraciones = git** (fuente de verdad). CI: push a `main` → prod; push a `dev` → dev.

> ⚠️ **El estado de las ramas no se escribe en este documento.** Caducó dos veces escrito aquí, y
> mientras estaba caducado se usó para tomar decisiones. Se consulta:
> ```bash
> git rev-list --left-right --count dev...main    # <por delante de main>  <por delante de dev>
> ```

**Valores por ambiente (no secretos — URL y ref son públicos):**

| | dev | prod |
| :-- | :-- | :-- |
| Project ref | `lbtpnszjjsxbeileqsja` | `nrzsyysqanbrcgtslfte` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lbtpnszjjsxbeileqsja.supabase.co` | `https://nrzsyysqanbrcgtslfte.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable dev | publishable prod |
| `SUPABASE_SERVICE_ROLE_KEY` | secret dev | secret prod |

> Claves `secret`/`service_role`, DB passwords y connection strings **solo** como secrets de
> Vercel/GitHub o en `.env.local` (gitignored). Nunca en el repo ni en `NEXT_PUBLIC_*`. Regla de oro 3.

### 1.1 Interruptores por variable

Varias integraciones se encienden poniendo su variable, sin tocar código; ausentes, la función se
apaga sola en vez de romper.

| Variable | Enciende | Si falta |
| :-- | :-- | :-- |
| `DAILY_API_KEY` | Sala de video real (EP-08) · borrado de grabaciones (§4) | Sala simulada; la purga responde `sin-daily` y no marca nada |
| `NEXT_PUBLIC_REFERRAL_URL` | Bloque "Invita y gana" del **alumno** (US-1301) | El bloque **no se pinta** para alumnos |
| `NEXT_PUBLIC_REFERRAL_URL_TUTOR` | Bloque "Invita y gana" del **tutor** (B1.11) — campaña DISTINTA en Referral Factory | El bloque **no se pinta** para tutores. ⚠️ **No se cae a la del alumno**: eso lo daría de alta en el programa equivocado |
| `NEXT_PUBLIC_REFERRAL_EMBED_URL` · `..._TUTOR` | El widget de Referral Factory **embebido** en `/referidos`, en vez de mandar al usuario fuera. Es el subdominio `embed.` de la URL de campaña: la pública manda `frame-ancestors` y el navegador la bloquea en el iframe | `/referidos` sigue existiendo y cae al enlace externo con un aviso discreto — nunca un iframe vacío. Falla cerrado por rol igual que las dos de arriba |
| `REFERRAL_FACTORY_API_KEY` | **Nada.** No la lee ninguna línea de `src/`. Ponerla o quitarla no cambia el comportamiento; sugiere una atribución de referidos que no existe (`QA-LANZAMIENTO.md` §4.5) | Nada |
| `SENTRY_DSN` · `NEXT_PUBLIC_SENTRY_DSN` | Monitoreo de errores (US-1501) | El SDK ni se inicializa |
| `RESEND_API_KEY` | Envío real de correo (US-1201) y del formulario de contacto (DL-01) | La cola se queda en `pending` (no `failed`) y el mensaje de contacto se guarda en `contact_messages` pero no sale |
| `EMAIL_FROM` | Remitente propio | `Enséñame Ya <onboarding@resend.dev>`, que funciona sin dominio verificado |
| `NEXT_PUBLIC_SITE_URL` | Base absoluta de las URL de retorno del cobro | Se deduce por entorno: producción → `VERCEL_PROJECT_PRODUCTION_URL`, preview → `VERCEL_BRANCH_URL` (alias fijo de rama). En local, `http://localhost:3000` |

### 1.2 El stack de pagos, variable a variable

El cobro lo decide el país del **alumno** y el payout el del **tutor**
(`docs/DICTADO-PAGOS.md`), así que **las claves de los cuatro rieles importan por separado**: apagar
uno no apaga el sitio, apaga a los países que ese riel atiende.

| Variable | Riel | Enciende | Si falta |
| :-- | :-- | :-- | :-- |
| `STRIPE_API_KEY` | Stripe | El cobro por Stripe y los **reembolsos reales** (X-01, §4) | El checkout ruteado a Stripe no cae al simulado: el adaptador dice `Stripe no configurado (falta STRIPE_API_KEY)`. La cola de reembolsos **no se toca** (queda `pending`) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe | **El formulario de pago.** Se manda al navegador y `stripe-embed.tsx` la pasa a `loadStripe()`; sin ella no hay Elements que montar. `/api/pagos/metodos` responde el error con su nombre y `/pagos` no deja añadir tarjeta (`isStripeConfigured() && Boolean(publishableKey())`) | El cobro por Stripe queda **sin formulario**, aunque `STRIPE_API_KEY` esté puesta |
| `STRIPE_WEBHOOK_SECRET` | Stripe | El webhook firmado (§5) — el único sitio donde un cobro pasa a `paid` | El webhook responde **503** y no procesa ningún evento |
| `DLOCALGO_API_KEY` · `DLOCALGO_SECRET_KEY` | dLocal Go | El **checkout transparente** (el formulario de tarjeta dentro del sitio) y el payout de dLocal | `isDlocalGoConfigured()` es false: `/api/pagos/confirmar-dlocal` responde **503 «dLocal Go no configurado»** en GET y en POST, y el lote de payouts se para entero en vez de marcar órdenes como fallidas |
| `DLOCALGO_API_BASE` | dLocal Go | Apuntar a **producción** (`https://api.dlocalgo.com`) | `https://api-sbx.dlocalgo.com` — sandbox por defecto, porque **la clave no lleva prefijo que distinga el ambiente** |
| `DLOCALGO_FX_SPREAD` | dLocal Go | El factor de diferencial de cambio que se aplica al payout (fracción: `0.047` = 4,7 %) | Se usa el medido, `0.047`. Fuera de `[0, 0.25]` se ignora y se avisa |
| `DLOCALGO_SMARTFIELDS_KEY` | dLocal Go | **Nada. No la lee ninguna línea.** El tokenizador de tarjeta usa una clave **pública de plataforma** de dLocal Go, hardcodeada en su propio SDK y la misma para todos sus comercios (`clavePublicaDeSmartFields()` en `lib/dlocalgo.ts`). El checkout transparente no necesita ninguna variable nueva | Nada |
| `PAYPAL_CLIENT_ID` · `PAYPAL_SECRET` | PayPal | El riel de payout de PayPal | `missingPayoutConfig()` devuelve `falta PAYPAL_CLIENT_ID` / `falta PAYPAL_SECRET`, `puedePagar()` da false y el resolvedor **se salta el riel sin ruido** |
| `PAYPAL_API_URL` | PayPal | Apuntar a **producción** (`https://api-m.paypal.com`) | `https://api-m.sandbox.paypal.com` |
| `WISE_API_TOKEN` | Wise | El riel de payout de Wise (`lib/payments/wise-provider.ts`) | `missingPayoutConfig()` devuelve `falta WISE_API_TOKEN` y el riel se salta en silencio: la orden se paga por el siguiente candidato del país, o se queda `scheduled` |
| `WISE_PRIVATE_KEY` | Wise | **OPCIONAL.** Solo la firma **SCA** de Wise: una clave RSA cuya pública se sube en *Settings → API tokens*. Esta cuenta no está sujeta a SCA, así que `missingPayoutConfig()` no la exige | Nada, mientras Wise no pida SCA. Si lo pidiera, `wiseFetch` lo dice **con el nombre de la variable** en vez de morir con un 403 mudo |
| `WISE_API_URL` | Wise | Apuntar a otro host de Wise | `https://api.transferwise.com` — el de **producción**, contra el que se midió el riel |

**Ese silencio es a propósito**, y es la misma regla de siempre: poner la variable es el despliegue.
Un riel sin credencial no revienta el checkout ni marca órdenes como fallidas; desaparece de la lista
de candidatos y el siguiente del país se hace cargo.

🔴 **Y en producción hoy falta el stack de dLocal.** Medido: un `GET` a
`https://ensenameya.vercel.app/api/pagos/confirmar-dlocal` devuelve **503 «dLocal Go no
configurado»**. Consecuencias exactas, sin dramatizarlas:

- **Nadie se queda sin comprar.** Todas las filas de `payment_routing_rules` llevan `stripe` en
  `charge_providers` —primero o como respaldo—, así que el alumno de un país de dLocal cae a Stripe y
  paga igual.
- **Lo que no funciona en prod es el checkout transparente de dLocal**, que es el camino de cobro
  principal del dictado para los países que dLocal cubre. Hasta que se pongan las dos claves, esos
  alumnos pagan por el riel de respaldo y ese camino no se ejercita en producción.

**Stripe tiene dos interruptores y hacen falta los dos:** las claves de arriba **y** la fila de
`payment_routing_rules`. ⚠️ Esa tabla **se toca con una MIGRACIÓN, nunca con un `UPDATE`** (regla de
oro 5): los `UPDATE` a mano no existen como fichero, así que no hay nada que aplicar en el otro
ambiente y las dos bases rutean distinto sin que nadie lo vea. El ruteo entero, país por país, lo
declara `20260904190000` y lo completan las migraciones `20260910*`.

### 1.3 Dónde está puesta cada variable

"falta" = hay que ponerla; el resto ya está.

| Variable | `.env.local` | Vercel Preview | Vercel Production | GitHub |
| :-- | :-- | :-- | :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` · `..._ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | dev | dev | prod | — |
| `DAILY_API_KEY` | sí | sí | sí | — |
| `STRIPE_API_KEY` | sí (`sk_test_`) | sí | sí | — |
| `STRIPE_WEBHOOK_SECRET` | sí (el de `stripe listen`) | sí (el del endpoint) | sí | — |
| `STRIPE_PUBLISHABLE_KEY` | sí | **por comprobar** | **por comprobar** | — · ⚠️ sin ella no se pinta el formulario de pago (§1.2) |
| `DLOCALGO_API_KEY` · `DLOCALGO_SECRET_KEY` | sí (sandbox) | sí (sandbox) | **falta** (503 medido) | — |
| `DLOCALGO_API_BASE` | — | — | **falta** — hace falta para apuntar a `api.dlocalgo.com` | — |
| `DLOCALGO_FX_SPREAD` | opcional | opcional | opcional | — |
| `PAYPAL_CLIENT_ID` · `PAYPAL_SECRET` | sí (sandbox) | **por comprobar** | **por comprobar** | — |
| `PAYPAL_API_URL` | — | — | **falta** — hace falta para salir de sandbox | — |
| `WISE_API_TOKEN` | sí | **falta** | **falta** | — |
| `WISE_PRIVATE_KEY` · `WISE_API_URL` | — | — | — | — · opcionales (§1.2) |
| `CRON_SECRET` | sí | ? sin comprobar | sí | sí (secret) |
| `RESEND_API_KEY` | sí | sí | sí | — |
| `NEXT_PUBLIC_REFERRAL_URL` | sí | **falta** | **falta** | — |
| `NEXT_PUBLIC_REFERRAL_URL_TUTOR` | **falta** | **falta** | **falta** | — |
| `NEXT_PUBLIC_REFERRAL_EMBED_URL` · `..._TUTOR` | **falta** | **falta** | **falta** | — |
| `REFERRAL_FACTORY_API_KEY` | sí | — | — | — · no la lee nadie: subirla no habilita nada |
| `APP_BASE_URL` | — | — | — | sí: `https://ensenameya.vercel.app` (variable, no secret) |
| `VERCEL_PROTECTION_BYPASS` | — | — | — | opcional (secret) — solo si `APP_BASE_URL` apunta a una preview |

- **Producción cobra en *test mode*.** Las claves de Stripe de prod son `sk_test_`: acepta la tarjeta
  4242 y no cobra ninguna real. Se asumió a sabiendas —el sitio no está lanzado— y el interruptor de
  cobrar de verdad son las claves de Vercel, no la tabla de ruteo. Antes de abrir a usuarios: o pasan
  a `sk_live_`, o el ruteo de prod se saca de `stripe` con una migración.
- `APP_BASE_URL` es solo de **GitHub**: le dice a los cuatro workflows a qué despliegue llamar (§4).
  `CRON_SECRET` hace falta en **los dos lados y con el mismo valor** — GitHub lo manda en la
  cabecera, Vercel lo compara.
- `VERCEL_PROTECTION_BYPASS` no hace falta apuntando a producción, que no está protegida. Solo si se
  apunta un workflow a una **preview**: ahí Deployment Protection devuelve **302 antes de que corra
  una línea nuestra** y el job no falla, simplemente no hace nada. Es la misma trampa que el webhook
  de Stripe (§5); el workflow de reembolsos la detecta y lo dice, el de correo todavía no.

> **Vercel no aplica una variable nueva a un despliegue que ya existe.** Las env vars se inyectan al
> construir: añadirla en Settings y recargar la misma URL devuelve **exactamente el mismo 503** de
> antes. Hay que **Redeploy** (Deployments → ⋯ → Redeploy) o empujar un commit. Se lee como "la clave
> está mal puesta" y no lo es.

---

## 2. Flujo de trabajo (sin local)

- **Correr la app:** `npm run dev` — usa `.env.local`, que apunta a **dev cloud**.
- **Cambiar el esquema:** escribe la migración en `supabase/migrations/`, luego aplícala a dev con
  `npm run db:push` (o empuja a `dev` y deja que el CI la aplique). A prod llega al mergear a `main`.
  Salida de emergencia, sin enlace:
  ```bash
  npx supabase db push --db-url "postgresql://postgres.lbtpnszjjsxbeileqsja:<db-password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
  ```
- **Consultar dev:** `npx supabase db query --linked`. El REST con `service_role` choca con los
  grants (regla de oro 9), así que para leer una tabla que no se los haya concedido, esta es la vía.
- **Regenerar tipos:** con el CLI enlazado, `npm run db:types`. Sin enlace, con **access token**
  explícito (sin Docker se genera vía API):
  ```bash
  export SUPABASE_ACCESS_TOKEN=<pat>
  npx supabase gen types typescript --project-id lbtpnszjjsxbeileqsja > src/lib/database.types.ts.tmp
  ```
- ⚠️ **La trampa de `db:types`: una redirección con `>` VACÍA el destino antes de que el comando
  arranque.** Si el CLI falla —403 del Management API, token caducado, la red—, `database.types.ts`
  se queda en 0 líneas y el error se lee como "de repente no compila nada". Pasó: 1704 líneas a 1.
  El script escribe a `src/lib/database.types.ts.tmp`, comprueba que contiene `export type Database`
  y solo entonces lo mueve encima; si no, borra el temporal y **deja el bueno intacto**. Regenerándolo
  a mano, usar `.tmp` igual, o mirar `git diff --stat` justo después. Y `database.types.ts` **no se
  edita a mano**.
- ⚠️ **Un `403 "your account does not have the necessary privileges"` en `db:push` o `db:types` no es
  el proyecto: es la cuenta.** Es un permiso sobre el **Management API** de Supabase, no sobre la base
  de datos, y no se arregla reenlazando ni regenerando el token. Salida: aplicar por `--db-url` o por
  el CI empujando a `dev`.
- **Convención de grants (auto-expose OFF):** toda tabla expuesta al cliente declara sus `grant`
  junto a sus políticas RLS (ver `20260703120000_data_api_grants.sql`). Públicas → `anon`; privadas →
  `authenticated`. RLS sigue siendo la barrera default-deny; el grant solo deja al rol llegar a la
  tabla. Las **vistas** llevan además `with (security_invoker = true)`: por defecto una vista corre con
  los privilegios de su dueño y se saltaría la RLS de las tablas que envuelve (precedente:
  `tutors_public`, `20260804120000`).
- **`service_role` se salta la RLS pero NO los grants de tabla.** Con auto-expose OFF, un job o un
  webhook con la clave secreta se estrella con `permission denied for table …` — en **ejecución**, no
  en el build, así que lint y typecheck pasan tan contentos. De las 177 migraciones, **61 declaran
  grants a `service_role`**: todo camino nuevo que use esa clave necesita el suyo, en su propia
  migración y acotado por columnas.
- **Autenticar una pantalla:** `getSessionContext` / `requireUser` / `requireRole` de
  `src/lib/auth/server.ts`. ⚠️ **`auth.getUser()` directo en una pantalla es el patrón que se
  borró**: revalidaba la sesión contra el servidor de Auth en cada render, varias veces por página.
- **No hay Edge Functions.** Todo el código server-side son **Route Handlers** (`src/app/api/`) y
  Server Components. Se decidió en `20260717120000` y todo lo nuevo lo sigue.

---

## 3. Checklist de setup

### A) Supabase — [x] hecho
- [x] Proyectos **`ensenameya-prod`** (`nrzsyysqanbrcgtslfte`) y **`ensenameya-dev`** (`lbtpnszjjsxbeileqsja`) creados (East US · automatic RLS on · auto-expose off).
- [x] Esquema base + grants Data API aplicados a **dev y prod**.

### B) Auth por proyecto (Supabase → Authentication) — [x] hecho en dev; prod por confirmar
- [x] **Site URL / Redirect URLs:** la URL de Vercel (prod → dominio de producción; dev → dominio de preview) **y** `http://localhost:3000` para `npm run dev`.
- [x] **Google OAuth en dev.** No era un bug: el proveedor estaba apagado y Supabase devolvía
      `"Unsupported provider: provider is not enabled"` antes de tocar una línea nuestra. Client
      ID/Secret puestos y redirect `https://lbtpnszjjsxbeileqsja.supabase.co/auth/v1/callback`
      autorizado en Google Cloud. Login verificado de punta a punta.
- [ ] **Google OAuth en prod:** el proyecto `nrzsyysqanbrcgtslfte` necesita **su propio** Client
      ID/Secret y su propio redirect (`https://nrzsyysqanbrcgtslfte.supabase.co/auth/v1/callback`).
      Los de dev **no valen**: son credenciales por proyecto.
- [x] **Dev:** **"Confirm email"** desactivado (Authentication → Providers → Email) para probar signup
      sin SMTP. ⚠️ **En prod está activado**, y esa asimetría esconde bugs de auth en dev.
- [ ] **Mínimo de contraseña a 8 en el panel de Auth** (Authentication → Policies), dev y prod.
      RV-12 lo subió en el formulario, pero **el mínimo de verdad lo impone el servidor de Auth**:
      sin tocarlo, el navegador rechaza 6 caracteres y la API los sigue aceptando.

### C) Vercel (1 proyecto) — [x] hecho, salvo las variables nuevas
- [x] **Import Project** desde `github.com/emiliofaimlab/ensenameya` (Next.js autodetecta). Production Branch = **`main`**.
- [x] Env vars (Settings → Environment Variables), dos juegos con las claves
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`:
  Scope **Production** → valores de **prod**; scope **Preview** → valores de **dev**.
- [x] **Protection Bypass for Automation** (Settings → Deployment Protection) activado, para que
  Stripe pueda entregar el webhook a la preview (§5).
- [x] `STRIPE_API_KEY` y `STRIPE_WEBHOOK_SECRET` en Preview y Production (test mode).
- [x] `RESEND_API_KEY` en local, Preview y Production. Es lo que hace que el formulario de contacto
  **entregue de verdad**, que es lo que dLocal prueba a mano (DL-01). ⚠️ El remitente sigue siendo
  `onboarding@resend.dev` mientras no haya dominio verificado.
- [x] `CRON_SECRET` en Production. La prueba no necesita el panel: sin la variable el endpoint
  responde **503** y con ella **401**.
- [ ] 🔴 **`DLOCALGO_API_KEY` y `DLOCALGO_SECRET_KEY` en Production.** Hoy faltan, medido: el GET a
  `/api/pagos/confirmar-dlocal` devuelve 503. Sin ellas el checkout transparente no existe en prod y
  los alumnos de los países de dLocal cobran por el respaldo de Stripe (§1.2).
- [ ] `WISE_API_TOKEN` en Preview y Production. Hoy solo está en `.env.local`, así que **el riel
  existe en el código y no en el despliegue**.
  ⚠️ **Subirla no basta para que el dinero salga.** El cuarto paso del riel es fondear la
  transferencia desde el saldo de la cuenta de Wise; con el saldo a cero la orden se queda viva en
  `incoming_payment_waiting` y el job reintenta el fondeo en cada pasada. Fondear es **gestión
  diaria de operaciones**, no configuración (`docs/DICTADO-PAGOS.md`).
- [ ] `PAYPAL_CLIENT_ID` y `PAYPAL_SECRET`, y `STRIPE_PUBLISHABLE_KEY`: comprobar que están en los
  dos scopes. Sin la publishable no hay formulario de pago aunque la secreta esté puesta.
- [ ] `NEXT_PUBLIC_REFERRAL_URL` y `NEXT_PUBLIC_REFERRAL_URL_TUTOR`. ⚠️ `REFERRAL_FACTORY_API_KEY`
  **sale de esta lista**: no la lee ningún fichero de `src/`.
- [ ] Tras dar de alta cualquiera: **Redeploy**. Vercel no las aplica al despliegue ya construido (§1).

### D) GitHub — Environments (CI de migraciones) — [x] hecho, salvo branch protection
- [x] Repo → Settings → **Environments** → **`production`** y **`development`** creados; en cada uno el
  *Environment secret* `SUPABASE_DB_URL` = connection string del **session pooler** (percent-encoded):
  `postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
- [x] Rama **`dev`** creada desde `main`.
- [ ] (Recomendado) Branch protection en `main`: PR + checks verdes. **Sin configurar**: hoy nada
  impide un push directo a `main` → prod.
- [x] Variable `APP_BASE_URL` = `https://ensenameya.vercel.app` y secret `CRON_SECRET` (el mismo
  valor que en Vercel), en Settings → Secrets and variables → Actions. Los cuatro workflows de §4
  comparten las dos. ⚠️ Faltar solo ahí costó **30 corridas en rojo**: los workflows están escritos
  para fallar en rojo a propósito y funcionó; lo que no había era nadie mirando el rojo. Diagnóstico
  de diez segundos: `gh variable list` y `gh secret list`.
- [ ] *(Opcional)* **secret `VERCEL_PROTECTION_BYPASS`**, solo si `APP_BASE_URL` va a apuntar a una
  **preview** (§5).

### E) Jira — [x] conectado (proyecto `EY`, `faimlab.atlassian.net`).

### F) Pagos — el estado por riel

El reparto de responsabilidades manda `docs/DICTADO-PAGOS.md`: **el cobro lo decide el país del
alumno y el payout el del tutor**. El avance de la implementación está en
`docs/PLAN-DESARROLLO.md`; el coste de cada tramo, en `docs/PAGOS-Y-PAYOUTS.md`.

- [x] **Stripe en sandbox**, con Sessions, webhooks firmados, rechazos, expiraciones y reembolsos.
  Corrige la premisa de la épica EY-92 ("no iniciar hasta tener AMBAS cuentas"): el KYC solo bloquea
  **live mode**.
- [x] Endpoint del webhook de Stripe registrado y probado de punta a punta (§5).
- [x] **dLocal Go: cuenta aprobada, sandbox y producción.** Adaptador de cobro, webhook firmado,
  payout y **checkout transparente** escritos. ⚠️ **Las claves de producción no están puestas** (§1.2,
  §3C).
- [x] **Ruteo declarado en migraciones** (`20260904190000` y las `20260910*`), no en `UPDATE`s a mano.
- [x] **Payouts** — ejecutan por **PayPal**, **dLocal**, **Wise** y **Stripe**. El tutor ve **dos
  tarjetas**: PayPal y Banco. Detrás de Banco compiten Wise, dLocal y Stripe y él **no ve cuál
  ejecutó**: en su historial pone «Transferencia bancaria». El orden por coste pone a **Stripe siempre
  detrás de Wise**, y hay una autocomprobación en `20260910180000` que aborta la migración si alguien
  los invierte.
  ⚠️ **El onboarding de Stripe Connect ya no existe** — ni en el producto ni en el código: la cuenta
  de destinatario la creamos nosotros con lo que el tutor teclea en **nuestro** formulario.
  `src/app/api/tutor/` solo tiene `paypal-connect`.
- [x] **Venezuela es el único país con canales manuales** (Binance, Zinli, Zelle), porque es el único
  al que no llega ningún riel automático. La autocomprobación de `20260910180000` lo fija: si alguien
  le añade Stripe, la migración levanta excepción.
- [ ] `sk_live_` y el KYC de *live mode* de Stripe: sigue siendo del cliente.
- [ ] **Migración de dominio.** `ensenameya.com` es una landing de GoDaddy que no enlaza a la app,
  que vive en `ensenameya.vercel.app`. Es DNS y negocio, no un merge — y ya no bloquea a ningún PSP.
  El **cliente ya tiene el dominio** y la landing muere: era un GoDaddy Builder con un formulario
  para ir recogiendo gente, y eso lo cubre `/contacto`, que además guarda en `contact_messages`.
  **Cero cambios de código**: `siteUrl()` (`src/lib/stripe.ts`) sale de `VERCEL_PROJECT_PRODUCTION_URL`
  y de ahí cuelgan el `return_url` de Stripe y el `notification_url` de dLocal. Orden del corte:

  1. **GoDaddy DNS** → apuntar el apex (y `www`) a Vercel; **Vercel prod** → añadir el dominio.
  2. **Supabase Auth (prod)** → Site URL y Redirect URLs con `https://ensenameya.com/auth/callback`.
     Sin esto, Google OAuth y el magic link rebotan al dominio viejo.
  3. **Stripe** → re-registrar `POST /api/webhooks/stripe`. ⚠️ **Endpoint nuevo = firma nueva**:
     hay que reponer `STRIPE_WEBHOOK_SECRET` en Vercel (§5).
  4. **GitHub → Variables** → `APP_BASE_URL` = `https://ensenameya.com` (lo leen los cuatro
     workflows de cron, §4).
  5. **Redeploy.** Nada de lo anterior entra en un despliegue que ya existe (§1.3).

  **No hay que tocar** dLocal ni PayPal —sus URL de vuelta viajan en cada petición, derivadas de
  `siteUrl()`—, ni `vercel.json` en su parte de `crons` (ruta relativa), ni el UID de los `.ics`
  (`src/lib/calendar/ics.ts` ya dice `ensenameya.com`, así que los calendarios ya suscritos no se
  duplican).

- [ ] **Quitar el bloqueo de pre-lanzamiento.** Mientras el sitio no esté vivo, `ensenameya.com`
  redirige `/` → `/contacto` (`redirects` de `vercel.json`, con `has: host` para que **no afecte a
  las previews**) y `src/app/robots.ts` sirve un `disallow: /`. Son **la misma decisión** y se
  quitan en **un solo commit**. Se hace así, y no con una redirección del apex a un Typeform, por
  dos razones: un formulario externo es un segundo almacén de leads que alguien tendría que
  reconciliar a mano, y una redirección ciega del apex se lleva por delante `/terms`, `/privacy`,
  `/cookies` y `/contacto` — que es exactamente lo que abre un revisor de dLocal (DL-01/DL-02).
  ⚠️ El `permanent: false` es a propósito: un 301 se queda cacheado en el navegador de todo el que
  entre y sobrevive al lanzamiento.

- [ ] **Subdominio de dev: decidido que NO.** La ofuscación por nombre (`algoraro.ensenameya.com`)
  no existe: el certificado que emite Vercel se publica en los **Certificate Transparency logs** y
  crt.sh lo indexa a los minutos. Y sería un cambio a peor — hoy dev vive en el alias fijo de rama
  `ensenameya-git-dev-*.vercel.app`, **detrás del login de Vercel** (Deployment Protection, §4).
  Si algún día pesa que el cliente tenga que loguearse para ver una demo, entonces `dev.` con
  nombre normal y protección explícita; no antes.

### G) Correo — Resend (C-11/DP-05) — [x] cuenta creada y clave puesta
- [x] Proveedor **decidido: Resend**, por un motivo operativo — es el único de los tres candidatos
  (SendGrid, Mailgun, Resend) que deja enviar y **probar sin dominio verificado**, y el dominio
  propio sigue bloqueado. El acoplamiento vive entero en `sendEmail()` (`src/lib/email.ts`):
  cambiar de proveedor es reescribir esa función.
- [ ] **Verificar el dominio `ensenameya.com` en Resend.** Hoy el remitente es
  `onboarding@resend.dev`, que funciona, pero un correo de contacto que no llega desde
  `@ensenameya.com` es exactamente lo que un revisor de dLocal marca. El día que se verifique, se
  pone `EMAIL_FROM` y no hay que tocar código.
- [ ] ⚠️ **Cuidar la reputación de la cuenta desde el primer envío.** Es nueva y no tiene historial:
  una primera tanda con decenas de rebotes es la forma más rápida de que Resend limite el envío.
- [ ] **Comprobar que llega un correo de verdad.** **Nadie ha visto llegar ninguno**: la clave está
  puesta, el código está entero y ni el formulario de contacto ni la cola se han ejercitado contra un
  buzón real. No dar DL-01 por cerrado hasta que se vea el mensaje.

> 🔴 **La cola de correo de dev vuelve a llenarse sola, y hay que contar con eso antes de apuntarle un
> reloj.** El seed usa direcciones `@ensenameya.dev`, **un dominio sin MX**: cada tanda de pruebas
> encola avisos que sólo pueden rebotar. La última vez fueron **187 de 336**. Mientras el seed no use
> direcciones que acepten correo (un buzón propio con subdirecciones `+algo`, o las de prueba de
> Resend), el procedimiento de `docs/QA-LANZAMIENTO.md` §4.6 —censar y cerrar la cola vieja como
> `failed`— hay que repetirlo **antes** de que cualquier reloj apunte a dev o a una preview. Hoy los
> relojes apuntan a producción, así que la mina está desarmada por accidente, no por diseño.

---

## 4. Trabajos programados

**Cinco endpoints HTTP y dos sitios donde vive su reloj.** Ninguno es una Edge Function de Supabase,
a propósito: la decisión está en `20260717120000_us801_daily_real.sql` — Postgres no puede llamar a la
API de Daily desde aquí, y una función de Deno necesitaría su propio cliente, su propia copia de la
clave y un pipeline de despliegue que no existe. Van como Route Handlers y reutilizan `lib/daily.ts`,
`lib/email.ts` y los adaptadores de pago tal cual.

| Job | Ruta | Reloj | Cadencia pedida |
| :-- | :-- | :-- | :-- |
| Purga de grabaciones (RN-42) | `/api/cron/recordings-purge` | **Vercel Cron** (`vercel.json`) | `0 4 * * *` |
| Envío de la cola de correo (US-1201) | `/api/cron/notifications-send` | **GitHub Actions** (`notifications-cron.yml`) | `*/5 * * * *` |
| Cola de reembolsos (X-01) | `/api/cron/refunds-process` | **GitHub Actions** (`refunds-cron.yml`) | `7,22,37,52 * * * *` |
| **Ejecución de payouts** | `/api/cron/payouts-process` | **GitHub Actions** (`payouts-cron.yml`) | `13 * * * *` |
| Barrido de ficheros de cuentas dadas de baja | `/api/cuenta/eliminar/barrido` | **GitHub Actions** (`barrido-bajas-cron.yml`) | `37 5 * * *` |

⚠️ **El barrido de bajas no cuelga de `/api/cron/`.** Buscar los jobs por ese prefijo lo deja fuera.

Los cinco se autentican igual: `Authorization: Bearer $CRON_SECRET`. Sin la variable responden **503**
y no corren (falla cerrado a propósito: son endpoints que borran datos, envían correos y **mueven
dinero**, y sin secreto serían públicos); con un valor que no coincide, **401**.

**Por qué cuatro están en Actions y no en Vercel Cron.** El plan **Hobby limita los crons a uno al
día**, y ese único hueco lo gasta la purga de grabaciones. Aunque quedara sitio, la cadencia diaria no
sirve para ninguno de los otros: un aviso de "tienes 24 h para aceptar esta reserva" que llega mañana
no vale, un reembolso pedido a las 04:05 esperaría un día entero cuando el §13 de los Términos promete
devolver "al método de pago original", y un payout que espera un día es un tutor que no cobra. Actions
da granularidad de minutos, logs y reejecución manual (`workflow_dispatch`). Si el proyecto pasa a
Pro, los cuatro se mueven a `vercel.json` y los workflows se borran.

El precio son tres peajes, anotados también en los propios workflows:

- 🔴 **La cadencia que se pide NO es la que GitHub entrega.** Medido sobre corridas reales: **una cada
  2-6 horas**, no una cada 5 o 15 minutos. GitHub estrangula los `cron` de cadencia corta y no avisa.
  Sigue siendo mejor que el único cron diario de Vercel Hobby —que es el motivo de que estén aquí—,
  pero **no se puede planificar con "cada 5 minutos"**: un aviso de "te quedan 24 h" puede llegar con
  6 h de retraso. Si algún día hace falta cadencia de verdad, el arreglo no es tocar el `cron:` — es
  Vercel Pro o un reloj externo.
- GitHub **desactiva los workflows programados tras 60 días sin actividad** en el repo. Si los correos,
  los reembolsos o los payouts dejan de salir sin más, mirar eso primero.
- GitHub solo programa los workflows de la **rama por defecto** (`main`): un workflow que solo vive en
  `dev` **no tiene reloj**, por muy bien escrito que esté.

**Por qué los reembolsos van cada 15 min y el correo cada 5.** No es simetría rota: una vez pedido el
reembolso a Stripe, el dinero tarda **5-10 días hábiles** en aparecer en la tarjeta, así que adelantar
el envío diez minutos no le cambia la vida a nadie. Lo que sí importa es el **reintento**: un 429 o un
5xx de Stripe deja la fila en `pending` a propósito —marcarla `failed` sería quedarse con el dinero del
alumno por un mal minuto del PSP— y con cadencia diaria ese mal minuto costaría un día. Una pasada con
la cola vacía no llama a Stripe: son dos consultas.

⚠️ **Verde no es lo mismo que útil.** Los relojes apuntan a **producción**, donde no hay usuarios y las
colas están vacías: un 200 con `revisadas: 0` dice que el cableado funciona, no que el job haga su
trabajo. Lo que hay encolado vive en **dev**, y a dev no lo llama ningún reloj.

**Y los jobs de la base de datos son otros nueve**, que no viven en el repo sino dentro de Postgres
(`grep -rn "cron.schedule" supabase/migrations/`): `expire-stale-bookings` (`* * * * *`),
`close-expired-sessions` (`*/5`), `process-notifications` (`*/2`, que **solo informa**),
`process-payouts` (`*/10`), `run-payout-batch` (lunes 03:00), `purge-expired-messages` (04:00),
`purge-contact-messages` y `purge-tutor-views` (04:30) y `complete-pending-account-deletions` (05:00).
⚠️ **Un job de `pg_cron` que falla no se lo dice a nadie**: el error se queda en
`cron.job_run_details` y hay que ir a mirarla, agregando por `jobname` y `status` — leer las diez
últimas filas solo enseña los frecuentes y deja fuera los diarios y el semanal, que son los que mueven
dinero y sostienen la retención de los legales.

---

## 5. Webhook de Stripe (EP-20 · PAC-03)

`POST /api/webhooks/stripe` es el **único** sitio donde un cobro por Stripe pasa a `paid` (el de
dLocal es `POST /api/webhooks/dlocalgo`). Montaje en test mode:

- **Endpoint registrado en el panel de Stripe** con el nombre `ensenameya-vercel` y **4 eventos**,
  todos de `checkout.session`: `completed`, `expired`, `async_payment_succeeded`,
  `async_payment_failed`.
- Apunta a la **preview** de Vercel, con el token del bypass en la query:
  `https://<preview>.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=<token>`.
- El `whsec_` que da ese endpoint es el `STRIPE_WEBHOOK_SECRET` del scope **Preview**.

**Por qué hace falta el Protection Bypass.** Deployment Protection deja los previews detrás del SSO
de Vercel, que responde **302 hacia la pantalla de login antes de que corra una línea de nuestro
código**. Stripe ve una redirección, no un 200, y se pone a reintentar durante tres días contra algo
que nunca va a procesar el evento. **Protection Bypass for Automation** (Settings → Deployment
Protection) da un token que, puesto en la query, salta esa puerta y deja llegar la petición a la ruta.
En producción no hará falta: el dominio de producción no está protegido.

**Verificado de punta a punta contra la preview**, con Stripe entregando el evento de verdad:
Session creada desde la preview → expirada desde la API de Stripe → webhook entregado a través del
bypass → reserva `cancelled`, pago `failed` y `pending_webhooks=0`.

> **Anotado por si acaso:** el endpoint quedó registrado con API version `2026-06-24.dahlia` y el
> código fija `2026-07-29.dahlia` (`src/lib/stripe.ts`, tomada del SDK instalado). Irrelevante para
> los campos que se leen —`client_reference_id`, `payment_status`, `payment_intent`—, pero conviene
> saberlo el día que uno de ellos cambie de forma.

**Probarlo en local.** No hay bypass que valga: `localhost` no está publicado, así que se usa la CLI
de Stripe como túnel.

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# imprime un whsec_… → ESE es el que va en .env.local
```

⚠️ **El `whsec_` de `stripe listen` no es el mismo que el del endpoint del panel.** Son secretos
distintos, uno por destino. Copiar el de Vercel a `.env.local` (o al revés) hace que la firma no
valide y la ruta responda **400 firma inválida** — que es justo lo que debe hacer, y que se confunde
con un bug del código. Cada entorno lleva el suyo.

Ojo también con los eventos sintéticos (`stripe trigger …`): llegan sin `client_reference_id`, así
que la ruta los da por no nuestros y responde 200 con `{"status":"ignorado"}` sin tocar nada. La
prueba de verdad es completar una Session abierta desde la app.

⚠️ **La misma trampa muerde a los crons, y ahí es más difícil de ver.** Cualquier cosa que llame por
HTTP a un despliegue de **preview** —el webhook de Stripe, los workflows de Actions, un `curl` desde
el portátil— se come el **302** de Deployment Protection antes de tocar nuestro código. Con Stripe se
nota porque el evento aparece como no entregado; con un cron no se nota nada, porque un cron que no
llega a ninguna parte se parece mucho a un cron que no tenía trabajo. `refunds-cron.yml` lo detecta y
lo dice con todas las letras; `notifications-cron.yml` **todavía no** —solo ve "no es 200"—. La
diferencia con el webhook: Stripe no puede poner cabeceras y usa el token en la query; los workflows
sí, y lo mandan como cabecera `x-vercel-protection-bypass` para que no acabe escrito en ningún log.

---

## 6. Estado actual

- [x] Repo `emiliofaimlab/ensenameya` · `gh` CLI autenticado · Jira `EY` conectado.
- [x] Supabase **dev** y **prod** creados; esquema base + grants aplicados a ambos.
- [x] `.env.local` apunta la app a **dev cloud**.
- [x] CI **activo y validado**: `main`→prod aplicado por Actions.
- [x] GitHub Environments (production/development) + secret `SUPABASE_DB_URL` + ramas `main`/`dev`.
- [x] Vercel: proyecto importado, **prod desplegado** (`ensenameya.vercel.app`); env vars
      Production→prod, Preview→dev.
- [x] CLI enlazado a **dev**: `npm run db:push` y `npm run db:types` corren contra el proyecto
      enlazado, sin Docker.
- [x] Stripe en **test mode** cableado y verificado de punta a punta contra la preview, con el
      endpoint del webhook registrado y el Protection Bypass activo (§5).
- [x] **Google OAuth en dev**, login verificado. **Falta en prod**, con sus propias credenciales (§3B).
- [x] **Resend: cuenta creada y `RESEND_API_KEY` puesta** en local, Preview y Production. Falta
      verificar el dominio y **ver llegar el primer correo** (§3G).
- [x] `CRON_SECRET` en Vercel y en GitHub, y `APP_BASE_URL` en GitHub. Los cinco endpoints de §4
      tienen reloj.
- [ ] 🔴 **Claves de dLocal en producción** — sin ellas el checkout transparente no funciona en prod
      (§1.2). Es el hueco más grande del despliegue de pagos.
- [ ] `WISE_API_TOKEN` en Vercel, y **un balance USD fondeado** en la cuenta de Wise (§3C).
- [ ] `PAYPAL_API_URL` y `DLOCALGO_API_BASE` cuando se salga de sandbox.
- [ ] Rotar secret keys antes del primer usuario real.
- [ ] Branch protection en `main` (§3D).
- [ ] **Arreglar el seed para que la cola de correo de dev no vuelva a llenarse**: usa
      `@ensenameya.dev`, dominio sin MX (§3G).
- [ ] `NEXT_PUBLIC_REFERRAL_URL` en Vercel y `NEXT_PUBLIC_REFERRAL_URL_TUTOR` en todas partes — hace
      falta la URL de la segunda campaña de Referral Factory, la de tutores.
- [ ] Mínimo de contraseña a 8 en el panel de Auth, dev y prod (§3B).
- [ ] Migración de dominio (`ensenameya.com` → la app) — DNS y negocio.

**Migraciones.** Hoy son **177** en `supabase/migrations/`, la fuente de verdad del esquema. Las
aplica el CI: push a `dev` → dev, merge a `main` → prod. Cuántas lleva cada ambiente **no se escribe
aquí**: se mira en el último run del workflow de migraciones. Y ojo con el orden de siempre — la app
nueva contra el esquema viejo revienta, así que el merge a `main` lleva su migración dentro.
