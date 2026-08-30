# Enséñame Ya — MVP Web

Marketplace de tutorías 1:1 en vivo entre alumnos y tutores. Monorepo: frontend
(Next.js) + backend (Supabase) en un solo repo.

- **Frontend:** React + Next.js (App Router) + TypeScript + Tailwind → despliegue en **Vercel**.
- **Backend:** **Supabase** (Postgres + RLS, Auth, Storage, Edge Functions).
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

## Estructura

```
.
├─ src/
│  ├─ app/                  # rutas y páginas (App Router)
│  ├─ proxy.ts              # refresco de sesión de Supabase (convención Next 16)
│  └─ lib/
│     ├─ database.types.ts  # tipos generados (npm run db:types)
│     └─ supabase/
│        ├─ client.ts       # cliente para el navegador (ANON + RLS)
│        ├─ server.ts       # cliente para Server Components (ANON + RLS)
│        └─ middleware.ts   # helper de sesión
├─ supabase/
│  ├─ config.toml           # config del CLI de Supabase (link, migraciones)
│  └─ migrations/           # esquema versionado (fuente de verdad)
├─ .github/workflows/       # CI: migraciones (dev/prod) + lint/typecheck + 2 crons
└─ docs/
   ├─ BACKLOG.md · PLAN-DESARROLLO.md · ENTORNOS.md
   └─ context/              # Docs 0–9 + adenda + revisión + aprobación cliente
```

## Seguridad (recordatorios clave)

- La `ANON key` (publishable) es **pública** y va al navegador; la protección real es **RLS**
  (Doc 3). Toda tabla nueva nace con RLS activado (default-deny) **y** sus grants explícitos.
- La `SERVICE_ROLE key` (secret) **se salta RLS**: solo en servidor / Edge Functions / CI,
  nunca en el cliente ni en `NEXT_PUBLIC_*` (S-15 / RN-26).
