# Enséñame Ya — Ambientes dev / prod (US-1603)

> **Objetivo:** dos entornos **100% cloud e independientes** — **dev** y **prod** — cada uno con su
> proyecto Supabase y su deploy en Vercel, con migraciones aplicadas por CI.
> **No hay stack local**: se desarrolla directamente contra **dev cloud** (vibe coding al máximo).
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

**Valores por ambiente (no secretos — URL y ref son públicos):**

| | dev | prod |
| :-- | :-- | :-- |
| Project ref | `lbtpnszjjsxbeileqsja` | `nrzsyysqanbrcgtslfte` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lbtpnszjjsxbeileqsja.supabase.co` | `https://nrzsyysqanbrcgtslfte.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable dev | publishable prod |
| `SUPABASE_SERVICE_ROLE_KEY` | secret dev | secret prod |

> Claves `secret`/`service_role`, DB passwords y connection strings **solo** como secrets de
> Vercel/GitHub o en `.env.local` (gitignored). Nunca en el repo ni en `NEXT_PUBLIC_*`. Regla de oro 3.

**Interruptores por variable.** Varias integraciones se encienden poniendo su variable, sin tocar
código; ausentes, la función se apaga sola en vez de romper:

| Variable | Enciende | Si falta |
| :-- | :-- | :-- |
| `DAILY_API_KEY` | Sala de video real (EP-08) · borrado de grabaciones (§4) | Sala simulada; la purga responde `sin-daily` y no marca nada |
| `NEXT_PUBLIC_REFERRAL_URL` | Bloque "Invita y gana" (US-1301) | El bloque **no se pinta** |
| `SENTRY_DSN` · `NEXT_PUBLIC_SENTRY_DSN` | Monitoreo de errores (US-1501) | El SDK ni se inicializa |
| `STRIPE_API_KEY` | Cobro real con Stripe (EP-20) | No se instancia el cliente y el checkout sigue por el camino simulado |
| `RESEND_API_KEY` | Envío real de correo (US-1201) | La cola se queda en `pending` (no `failed`): al poner la clave sale todo lo acumulado |
| `EMAIL_FROM` | Remitente propio | `Enséñame Ya <onboarding@resend.dev>`, que funciona sin dominio verificado |
| `NEXT_PUBLIC_SITE_URL` | Base absoluta de `success_url`/`cancel_url` de Stripe | Se deduce de `VERCEL_URL`; en local, `http://localhost:3000` |

**Y dos que fallan CERRADO**, al revés que las de arriba, porque su ausencia dejaría un endpoint
público: sin `CRON_SECRET` los dos jobs programados responden **503** y no corren (§4), y sin
`STRIPE_WEBHOOK_SECRET` el webhook responde **503** y no procesa ningún evento (§5).

**Stripe tiene dos interruptores y hacen falta los dos:** la clave de arriba **y** la fila de
`payment_routing_rules`, que es el dato que decide qué proveedor cobra. Desde
`20260806180000_routing_rules_grant_service_role.sql` esa fila se cambia con un `UPDATE` de
`service_role` (`select` + `update` de `charge_provider`, `payout_provider`, `is_active`; sin
`insert` ni `delete`), ya **no** escribiendo una migración. En **dev** ya está en `'stripe'`.

**Dónde está puesta cada variable (7-ago).** "falta" = hay que ponerla; el resto ya está.

| Variable | `.env.local` | Vercel Preview | Vercel Production | GitHub |
| :-- | :-- | :-- | :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` · `..._ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | dev | dev | prod | — |
| `STRIPE_API_KEY` | sí (`sk_test_`) | sí | **falta** | — |
| `STRIPE_WEBHOOK_SECRET` | sí (el de `stripe listen`) | sí (el del endpoint) | **falta** | — |
| `STRIPE_PUBLISHABLE_KEY` | sí | — | — | — |
| `CRON_SECRET` | sí | **falta** | **falta** | **falta** (secret) |
| `RESEND_API_KEY` | **falta** | **falta** | **falta** | — |
| `NEXT_PUBLIC_REFERRAL_URL` | sí | **falta** | **falta** | — |
| `REFERRAL_FACTORY_API_KEY` | sí | **falta** | **falta** | — |
| `APP_BASE_URL` | — | — | — | **falta** (variable, no secret) |

- `STRIPE_PUBLISHABLE_KEY` está en local por simetría, pero hoy **no la lee nadie**: el checkout es
  el alojado de Stripe y el navegador solo recibe la URL a la que redirigir.
- `APP_BASE_URL` es solo de **GitHub**: le dice al workflow de correo a qué despliegue llamar (§4).
  `CRON_SECRET` hace falta en **los dos lados y con el mismo valor** — GitHub lo manda en la
  cabecera, Vercel lo compara.
- **Production está vacío de todo esto a propósito**: en `main` no está todavía ni el código que las
  lee — ni `vercel.json`, ni `/api/pagos/checkout`, ni `/api/webhooks/stripe`, ni los dos crons.
  Poner ahí las claves antes del merge no serviría de nada.

> **Vercel no aplica una variable nueva a un despliegue que ya existe.** Las env vars se inyectan al
> construir: añadirla en Settings y recargar la misma URL de preview devuelve **exactamente el mismo
> 503** de antes. Hay que **Redeploy** (Deployments → ⋯ → Redeploy) o empujar un commit. Se lee como
> "la clave está mal puesta" y no lo es.

---

## 2. Flujo de trabajo (sin local)

- **Correr la app:** `npm run dev` — usa `.env.local`, que apunta a **dev cloud**.
- **Cambiar el esquema:** escribe la migración en `supabase/migrations/`, luego aplícala a dev:
  ```bash
  npx supabase db push --db-url "postgresql://postgres.lbtpnszjjsxbeileqsja:<db-password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
  ```
  (o haz push a la rama `dev` y deja que el CI la aplique). A prod llega al mergear a `main`.
- **Regenerar tipos:** con el CLI ya enlazado, `npm run db:types`. Sin enlace, con **access token**
  explícito (sin Docker se genera vía API):
  ```bash
  export SUPABASE_ACCESS_TOKEN=<pat>
  npx supabase gen types typescript --project-id lbtpnszjjsxbeileqsja > src/lib/database.types.ts
  ```
- **Convención de grants (auto-expose OFF):** toda tabla expuesta al cliente declara sus `grant`
  junto a sus políticas RLS (ver `20260703120000_data_api_grants.sql`). Públicas → `anon`; privadas →
  `authenticated`. RLS sigue siendo la barrera default-deny; el grant solo deja al rol llegar a la tabla.
  Las **vistas** llevan además `with (security_invoker = true)`: por defecto una vista corre con los
  privilegios de su dueño y se saltaría la RLS de las tablas que envuelve (ver la vista `tutors_public`
  del filtro de precio, `20260804120000_dd04_vista_precio_tutor.sql`).
- **`service_role` se salta la RLS pero NO los grants de tabla.** Con auto-expose OFF, un job o un
  webhook que use la clave secreta se estrella con `permission denied for table …` — en **ejecución**,
  no en el build, así que lint y typecheck pasan tan contentos. Mordió tres veces en dos días:
  `sessions` (`20260806140000`), `payments`/`profiles` (`20260806170000`) y `payment_routing_rules`
  (`20260806180000`). Todo camino nuevo con `service_role` sobre una tabla que no lo declare va a
  repetirlo. Se concede acotado (columnas concretas), no en bloque.
- **Scripts (`package.json`):** ya son cloud — `db:push` (aplica al proyecto enlazado) y
  `db:types` (`--linked`). Requieren enlazar el CLI una vez: `npx supabase link --project-ref <ref>`
  (pide access token). Los antiguos `db:start`/`db:stop`/`db:reset` (Docker) se eliminaron.

---

## 3. Checklist de setup

### A) Supabase — [x] hecho
- [x] Proyectos **`ensenameya-prod`** (`nrzsyysqanbrcgtslfte`) y **`ensenameya-dev`** (`lbtpnszjjsxbeileqsja`) creados (East US · automatic RLS on · auto-expose off).
- [x] Esquema base + grants Data API aplicados a **dev y prod**.

### B) Auth por proyecto (Supabase → Authentication) — [x] hecho, salvo Google
- [x] **Site URL / Redirect URLs:** la URL de Vercel (prod → dominio de producción; dev → dominio de preview) **y** `http://localhost:3000` para `npm run dev`.
- [ ] **Google OAuth:** Client ID/Secret en cada proyecto; en Google Cloud, redirect autorizado `https://<ref>.supabase.co/auth/v1/callback`. **Sigue pendiente**: el proveedor está apagado en dev (`/auth/v1/settings` → `google:false`, comprobado el 5-ago). El botón ya existe en el código (`src/components/auth/google-button.tsx`); solo le falta la credencial.
- [x] **Dev:** **"Confirm email"** desactivado (Authentication → Providers → Email) para probar signup sin SMTP.

### C) Vercel (1 proyecto) — https://vercel.com — [x] hecho, salvo las variables nuevas
- [x] **Import Project** desde `github.com/emiliofaimlab/ensenameya` (Next.js autodetecta). Production Branch = **`main`**.
- [x] Env vars (Settings → Environment Variables), dos juegos con las claves
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`:
  - Scope **Production** → valores de **prod**.
  - Scope **Preview** → valores de **dev**.
- [x] Scope **Preview**: `STRIPE_API_KEY` y `STRIPE_WEBHOOK_SECRET` (test mode), 6-ago.
- [x] **Protection Bypass for Automation** (Settings → Deployment Protection) activado, para que
  Stripe pueda entregar el webhook a la preview (§5).
- [ ] Scope **Preview**: faltan `CRON_SECRET`, `RESEND_API_KEY`, `NEXT_PUBLIC_REFERRAL_URL` y
  `REFERRAL_FACTORY_API_KEY` (ver la matriz de §1). Sin `CRON_SECRET`, el cron de grabaciones
  responde **503**.
- [ ] Scope **Production**: ninguna de las nuevas. Va después del merge a `main`, con las
  credenciales de producción (no las de test).
- [ ] Tras dar de alta cualquiera: **Redeploy**. Vercel no las aplica al despliegue ya construido (§1).

### D) GitHub — Environments (CI de migraciones) — [x] hecho, salvo branch protection y el cron de correo
- [x] Repo → Settings → **Environments** → **`production`** y **`development`** creados; en cada uno el
  *Environment secret* `SUPABASE_DB_URL` = connection string del **session pooler** (percent-encoded):
  `postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
- [x] Rama **`dev`** creada desde `main`.
- [ ] (Recomendado) Branch protection en `main`: PR + checks verdes. **Sin configurar** (la API de
  protección devuelve 404 el 5-ago): hoy nada impide un push directo a `main` → prod.
- [ ] **Cron de correo** (Settings → Secrets and variables → Actions): *variable* `APP_BASE_URL` y
  *secret* `CRON_SECRET`. **Faltan las dos.** El workflow está escrito para **fallar en rojo** si
  alguna no está —en vez de fingir que la pasada fue bien—, así que en cuanto `main` lo tenga saldrá
  un fallo cada 5 minutos hasta que se configuren (§4).

### E) Jira — [x] conectado (proyecto `EY`, `faimlab.atlassian.net`).

### F) Stripe (test mode) — [x] cableado y verificado; live sigue bloqueado
- [x] Cuenta en **sandbox**. Corrige la premisa de la épica EY-92 ("no iniciar hasta tener AMBAS
  cuentas"): con solo registrar el email hay Sessions, webhooks **firmados**, rechazos, expiraciones
  y reembolsos. El KYC solo bloquea **live mode**.
- [x] Endpoint del webhook registrado y probado de punta a punta (§5).
- [x] `payment_routing_rules` de **dev** en `'stripe'` — hoy es un `UPDATE`, no una migración (§1).
- [ ] `sk_live_`, KYC y **payouts** (Connect exige KYC): bloqueados por el cliente.
- [ ] **DLocal**: la cuenta fue **rechazada**, sin saber qué URL presentó el cliente. El problema de
  fondo no es de configuración: `ensenameya.com` es una landing de GoDaddy que **no enlaza a la app**
  (que vive en `ensenameya.vercel.app`), o sea dos webs de la misma marca con dos juegos de términos.
  Esto **no lo arregla ningún merge**: es DNS y negocio.

### G) Correo — Resend (C-11/DP-05) — [ ] falta la cuenta
- [x] Proveedor **decidido: Resend**, por un motivo operativo — es el único de los tres candidatos
  (SendGrid, Mailgun, Resend) que deja enviar y **probar sin dominio verificado**, y el dominio
  propio sigue bloqueado. El acoplamiento vive entero en `sendEmail()` (`src/lib/email.ts`):
  cambiar de proveedor es reescribir esa función.
- [ ] Crear la cuenta y poner `RESEND_API_KEY` (local **y** Vercel). Sin ella el job responde
  `sin-proveedor` y la cola se queda en `pending`, no `failed`.
- [ ] `EMAIL_FROM` el día que haya dominio propio; hasta entonces, `onboarding@resend.dev`.

---

## 4. Trabajos programados (dos jobs, dos relojes distintos)

| Job | Ruta | Reloj | Cadencia |
| :-- | :-- | :-- | :-- |
| Purga de grabaciones (RN-42) | `/api/cron/recordings-purge` | **Vercel Cron** (`vercel.json`) | diaria, `0 4 * * *` |
| Envío de la cola de correo (US-1201) | `/api/cron/notifications-send` | **GitHub Actions** (`.github/workflows/notifications-cron.yml`) | cada 5 min |

Los dos se autentican igual: `Authorization: Bearer $CRON_SECRET`. Sin la variable configurada
responden **503** y no corren (falla cerrado a propósito: son endpoints que borran datos y envían
correos, y sin secreto serían públicos); con un valor que no coincide, **401**.

Ninguno es una Edge Function de Supabase, a propósito: el repo ya tomó esa decisión en
`20260717120000_us801_daily_real.sql` — Postgres no puede llamar a la API de Daily, y una función de
Deno necesitaría su propio cliente, su propia copia de la clave y un pipeline de despliegue que hoy
no existe. Van como Route Handlers y reutilizan `lib/daily.ts` y `lib/email.ts` tal cual.

**Por qué el correo NO va en Vercel Cron.** El plan **Hobby limita los crons a uno al día**, y un
aviso de "tienes 24 h para aceptar esta reserva" que llega mañana no sirve de nada. Actions da
granularidad de 5 minutos, logs y reejecución manual (`workflow_dispatch`). El precio son dos peajes,
anotados en el propio workflow para que nadie los descubra depurando: los programados de GitHub **se
retrasan** cuando la cola va cargada (10-15 min es normal, aceptable para un correo y no para un
cobro) y GitHub **desactiva los workflows programados tras 60 días sin actividad** en el repo — si
los correos dejan de salir sin más, mirar eso primero. Si algún día el proyecto pasa a Pro, esto se
mueve a `vercel.json` y el workflow se borra.

**Hoy no corre ninguno de los dos**, por dos motivos que se suman:

1. `vercel.json` y el workflow **solo están en `dev`**; `main` no los tiene. Los crons de Vercel se
   disparan sobre el despliegue de **producción**, y GitHub solo programa los workflows de la **rama
   por defecto** (`main`). Hasta el merge, ninguno tiene reloj.
2. Falta `CRON_SECRET` en Vercel y en GitHub, y `APP_BASE_URL` en GitHub (§1 y §3C/§3D).

Y aunque corriera, la purga no tendría nada que borrar todavía: el **add-on de grabación de Daily
sigue sin contratar** (falta el visto bueno de coste), así que sin `DAILY_API_KEY` el job devuelve
`sin-daily` y no marca ninguna sesión — mentir en `sessions.recordings_purged_at`, que es la prueba
de que la política se cumple, sería peor que no tener sello.

---

## 5. Webhook de Stripe (EP-20 · PAC-03)

`POST /api/webhooks/stripe` es el **único** sitio donde un cobro pasa a `paid`. Montaje en test mode:

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

---

## 6. Estado actual

- [x] Repo `emiliofaimlab/ensenameya` · `gh` CLI autenticado · Jira `EY` conectado.
- [x] Supabase **dev** y **prod** creados; esquema base + grants aplicados a ambos.
- [x] `.env.local` apunta la app a **dev cloud**.
- [x] CI **activo y validado**: `main`→prod aplicado por Actions (no-op OK). Tolerante si falta el secret.
- [x] GitHub Environments (production/development) + secret `SUPABASE_DB_URL` + ramas `main`/`dev`.
- [x] Vercel: proyecto importado, **prod desplegado** (`ensenameya.vercel.app`); env vars Production→prod, Preview→dev.
- [x] Auth: Site URL + Redirect URLs en prod y dev; "Confirm email" **off** en dev.
- [x] CLI enlazado a **dev** (`supabase/.temp/linked-project.json`): `db:push` y `db:types` corren
  contra el proyecto enlazado — `db:types` usa `--linked` (package.json), sin Docker ni `--project-id`.
- [x] Stripe en **test mode** cableado y verificado de punta a punta contra la preview, con el
  endpoint del webhook registrado y el Protection Bypass activo (§5).
- [ ] Google OAuth por proyecto (Client ID/Secret) — pendiente (email/password ya funciona).
- [ ] Rotar secret keys antes del primer usuario real.
- [ ] Branch protection en `main` (ver §3D).
- [ ] `CRON_SECRET` en **Vercel** y en **GitHub**, y `APP_BASE_URL` en GitHub: sin ellas los dos
  jobs programados responden 503 o ni se disparan (§4).
- [ ] `RESEND_API_KEY`: sin cuenta de Resend el correo se encola y no sale (§3G).
- [ ] `NEXT_PUBLIC_REFERRAL_URL` y `REFERRAL_FACTORY_API_KEY` en Vercel — solo están en local.

**Ramas y despliegue al 7-ago — el PR #11 ya se mergeó; queda UN merge.** El PR #11 entró en `dev`
el 5-ago (merge `1a36da2`) y encima se ha seguido trabajando: `origin/dev` está en **`3529655`**
mientras `main` sigue en **`57edfa9`**, o sea en el commit del 29-jul. **Nada nuevo ha llegado a
producción todavía**: falta el merge **`dev` → `main`**, que es el que dispara el job de migraciones
de prod y el que lleva allí `vercel.json`, el workflow de correo y las rutas nuevas
(`/api/pagos/checkout`, `/api/webhooks/stripe`, los dos crons). Ojo con el orden: la app nueva contra
el esquema viejo revienta.

**Migraciones por ambiente.** **dev al día**: 74/74 aplicadas, la última
`20260806180000_routing_rules_grant_service_role.sql`. **prod va 20 por detrás** (tiene 54): le
faltan las de `20260729130000` en adelante, porque el CI solo las aplica al mergear a `main`.

*Última edición: 2026-08-07.*
