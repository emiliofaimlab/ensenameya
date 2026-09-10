# Enséñame Ya — MVP Web

Marketplace de tutorías 1:1 en vivo entre alumnos y tutores. Monorepo: frontend
(Next.js) + backend (Supabase) en un solo repo.

- **Frontend:** React + Next.js (App Router) + TypeScript + Tailwind → despliegue en **Vercel**.
- **Backend:** **Supabase** (Postgres + RLS, Auth, Storage). Todo el código server-side propio
  es de Next: **Route Handlers** en `src/app/api/` y Server Components. **No hay Edge
  Functions** — `supabase/functions` no existe y no se usa. El cliente `service_role` vive en
  `src/lib/supabase/admin.ts` (marcado `server-only`) y lo importan 26 ficheros, todos de servidor.
- **Cobro y payout:** manda [`docs/DICTADO-PAGOS.md`](docs/DICTADO-PAGOS.md); el avance de su
  estado de ejecución, [`docs/PLAN-DESARROLLO.md`](docs/PLAN-DESARROLLO.md).
- **Planificación:** [`docs/BACKLOG.md`](docs/BACKLOG.md) (sprints, espejo de Jira) · [`docs/PLAN-DESARROLLO.md`](docs/PLAN-DESARROLLO.md) (estado).
- **Ambientes y flujo:** [`docs/ENTORNOS.md`](docs/ENTORNOS.md).
- **Contexto del producto (técnico):** [`docs/context/`](docs/context/) (Docs 0–9 + adenda + revisión).
- **Visión para el cliente:** [`docs/context/APROBACION-CLIENTE-FAIMLAB.md`](docs/context/APROBACION-CLIENTE-FAIMLAB.md).

## Metodología: 100% cloud, sin stack local

No hay Postgres/Docker local. Se desarrolla contra la **BD de dev en la nube**:

| Ambiente | Supabase | Vercel | Rama |
| :-- | :-- | :-- | :-- |
| **dev** | `ensenameya-dev` | Preview | `dev` / PRs |
| **prod** | `ensenameya-prod` | Production (`ensenameya.vercel.app`) | `main` |

Vercel despliega **desde el repo** (no desde tu máquina): `main`→prod, `dev`/PRs→preview.
Las **mismas migraciones** se aplican a ambos → prod ≡ dev. Detalle en [`docs/ENTORNOS.md`](docs/ENTORNOS.md).

## Requisitos

- Node.js 20+ y npm
- (Una vez, para tocar el esquema) Supabase CLI enlazado al proyecto **dev** — ver abajo.

## Arranque rápido

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno → apuntan a dev cloud
cp .env.example .env.local   # rellena con las keys de ensenameya-dev (ver docs/ENTORNOS.md)

# 3. Frontend (corre en local contra la BD de dev cloud)
npm run dev                  # http://localhost:3000
```

Para trabajar migraciones/tipos, enlaza el CLI a **dev** una sola vez (pide un
access token de Supabase → Account → Access Tokens):

```bash
npx supabase link --project-ref lbtpnszjjsxbeileqsja   # ensenameya-dev
```

## El loop de trabajo

**Modo local (rápido, hot-reload):**
```
npm run dev  →  editas contra dev cloud con recarga instantánea
  →  git commit + push a `dev`
  →  GitHub Actions aplica migraciones a dev · Vercel buildea el Preview
  →  revisas el Preview online  →  merge `dev`→`main`  →  Production + migraciones a prod
```

**Modo remoto (desde GitHub / teléfono / agente):** cualquier commit a `dev` dispara el
mismo pipeline (Vercel buildea el Preview, ~1-2 min). No necesitas máquina local; el
feedback es el build de Vercel en vez del hot-reload.

> `main` = **prod** · `dev` = **preview**. El origen del commit da igual — Vercel deploya el repo.

## Scripts

| Script | Qué hace |
| :-- | :-- |
| `npm run dev` | Next.js en desarrollo (contra dev cloud) |
| `npm run build` / `npm run start` | Build y arranque de producción |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm run db:push` | Aplica las migraciones al proyecto enlazado (**dev**) |
| `npm run db:types` | Regenera `src/lib/database.types.ts` desde el esquema (requiere link) |
| `npm run db:seed` | Puebla dev con `supabase/seed/dev-poblar.sql` (necesita `SUPABASE_DB_URL` en `.env.local` y `psql`) |
| `npm run db:seed:imagenes` | Sube las imágenes de demo a Storage (`supabase/seed/dev-imagenes.mjs`) |

### Comprobaciones ejecutables

El repo no tiene framework de test. La convención es un fichero `*.check.ts` al lado de la
parte **pura** de la lógica que vigila; se corre con `node --experimental-strip-types` y falla
con exit code. Son diez, y existen porque todas vigilan reglas que **no fallan ruidosamente**
cuando se rompen:

| Script | Vigila |
| :-- | :-- |
| `npm run check:email` | Renderizado de las plantillas de correo (`src/lib/email-templates.check.ts`) |
| `npm run check:terms` | Que el contrato publicado y `lib/policy.ts` digan lo mismo (RN-37) |
| `npm run check:ics` | Reglas de escritura del `.ics` (`src/lib/calendar/ics-format.check.ts`) |
| `npm run check:chat` | Contador de la consulta previa, copia en TS de un `count(*)` de la BD |
| `npm run check:cadena` | Cadena de respaldo del cobro: quién cobra (`src/app/api/pagos/checkout/cadena.check.ts`) |
| `npm run check:paypal` | Mapeo de PayPal (lotes, desenlaces, antidoble) |
| `npm run check:wise` | Mapeo de Wise (cuenta por país, idempotencia por UUID, SCA) |
| `npm run check:stripe-payout` | Mapeo del payout por Stripe (cuenta, transferencia, aceptación) |
| `npm run check:metodo` | Métodos por país y preferencia del tutor (`metodo-preferido.check.ts`) |
| `npm run check:riel` | Si un riel **puede** pagarle a un tutor (`riel-viable.check.ts`) |

## Flujo de cambios en la base de datos

Fuente de verdad = migraciones en `supabase/migrations/`. Usa la skill `/nueva-migracion`:

```bash
# 1. escribe la migración a mano en supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql
#    RLS default-deny + grants a los roles de la API (auto-expose está OFF, ver ENTORNOS)
npm run db:push        # la aplica a dev cloud
npm run db:types       # regenera los tipos
git add supabase/ src/lib/database.types.ts && git commit
git push origin dev    # el CI la aplica a dev; a prod llega al mergear a main
```

## Jobs programados

Están en **tres sitios**, y ninguno se ve desde los otros dos.

**1) Endpoints HTTP** — cinco, todos exigen `CRON_SECRET` y fallan cerrado (503) sin ella:

| Reloj | Qué dispara | Cadencia |
| :-- | :-- | :-- |
| `vercel.json` | `/api/cron/recordings-purge` | `0 4 * * *` |
| `.github/workflows/notifications-cron.yml` | `/api/cron/notifications-send` | `*/5 * * * *` |
| `.github/workflows/refunds-cron.yml` | `/api/cron/refunds-process` | `7,22,37,52 * * * *` |
| `.github/workflows/payouts-cron.yml` | `/api/cron/payouts-process` — **mueve dinero** | `13 * * * *` |
| `.github/workflows/barrido-bajas-cron.yml` | `/api/cuenta/eliminar/barrido` (⚠️ **no** cuelga de `/api/cron/`) | `37 5 * * *` |

El plan Hobby de Vercel admite **un** cron al día, y ese hueco lo gasta la purga de
grabaciones: por eso los otros cuatro relojes son GitHub Actions. GitHub no garantiza el
minuto de la cadencia pedida, así que no se puede planificar al minuto.

**2) `pg_cron`, dentro de Postgres** — nueve jobs declarados en las migraciones
(`grep -rn "cron.schedule" supabase/migrations/`): `close-expired-sessions`,
`expire-stale-bookings`, `process-notifications`, `process-payouts`, `run-payout-batch`,
`purge-expired-messages`, `purge-contact-messages`, `purge-tutor-views` y
`complete-pending-account-deletions`. Un `pg_cron` que falla **no avisa a nadie**: no hay build
en rojo ni 500 en Vercel, el error se queda en `cron.job_run_details`.

**3) Hueco conocido en `payouts-process`:** cuando el proveedor **rechaza** la orden, la marca
`failed` y corta (`src/app/api/cron/payouts-process/route.ts:734`) — **no prueba el siguiente
riel candidato**. El descenso que sí existe es el previo, al elegir riel:
`rielSirveParaEsteTutor` (`src/lib/payments/riel-viable.ts`) descarta los rieles sin datos antes
de intentar nada.

## Estructura

```
.
├─ src/
│  ├─ app/
│  │  ├─ (app) (auth) (checkout) (public) (recovery) (room)
│  │  │                      # los 6 grupos de rutas; toda pantalla vive en uno, con su layout
│  │  └─ api/                # TODO el server-side propio (Route Handlers): pagos, webhooks, cron…
│  ├─ proxy.ts               # refresco de sesión de Supabase (convención Next 16)
│  └─ lib/
│     ├─ auth/server.ts      # guardas de sesión y rol (getSessionContext, requireUser, requireRole)
│     ├─ database.types.ts   # tipos generados (npm run db:types)
│     ├─ payments/           # un adaptador por riel: stripe · dlocal · paypal · wise · simulated
│     └─ supabase/
│        ├─ client.ts        # cliente para el navegador (ANON + RLS)
│        ├─ server.ts        # cliente para Server Components (ANON + RLS)
│        ├─ admin.ts         # cliente service_role, `server-only` — jamás en el navegador
│        └─ middleware.ts    # helper de sesión
├─ supabase/
│  ├─ config.toml            # config del CLI de Supabase (link, migraciones)
│  ├─ migrations/            # esquema versionado (fuente de verdad) — 177 hoy
│  └─ seed/                  # datos de dev (npm run db:seed · db:seed:imagenes)
├─ vercel.json               # Vercel Cron (purga de grabaciones)
├─ .github/workflows/        # CI (lint/typecheck) + migraciones (dev/prod) + 4 crons
└─ docs/
   ├─ BACKLOG.md · PLAN-DESARROLLO.md · ENTORNOS.md · DICTADO-PAGOS.md
   └─ context/               # Docs 0–9 + adenda + revisión + aprobación cliente
```

## Seguridad (recordatorios clave)

- La `ANON key` (publishable) es **pública** y va al navegador; la protección real es **RLS**
  (Doc 3). Toda tabla nueva nace con RLS activado (default-deny) **y** sus grants explícitos.
- La `SERVICE_ROLE key` (secret) **se salta RLS**: solo en servidor (Route Handlers, Server
  Components, jobs) y CI, siempre vía `src/lib/supabase/admin.ts`. Nunca en el navegador ni en
  una variable `NEXT_PUBLIC_*` (S-15 / RN-26).
- `service_role` se salta la RLS, pero **no** los `grant` de tabla: con "auto-expose new tables"
  OFF, un job se come `permission denied` en tiempo de ejecución hasta que su migración declare
  `grant … to service_role` (regla de oro 9).
