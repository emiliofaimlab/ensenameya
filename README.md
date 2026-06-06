# Enséñame Ya — MVP Web

Marketplace de tutorías 1:1 en vivo entre alumnos y tutores. Monorepo: frontend
(Next.js) + backend (Supabase) en un solo repo.

- **Frontend:** React + Next.js (App Router) + TypeScript + Tailwind → despliegue en Vercel.
- **Backend:** Supabase (Postgres + RLS, Auth, Storage, Edge Functions).
- **Arquitectura completa:** ver [`docs/context/REVISION-docs-1-3.md`](docs/context/REVISION-docs-1-3.md) → **Anexo A**.
- **Contexto del producto:** ver [`docs/context/`](docs/context/) (Docs 0–9).

## Requisitos

- Node.js 20+ y npm
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (solo para el stack local de Supabase)

## Arranque rápido

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno (los defaults locales ya vienen listos)
cp .env.example .env.local   # opcional: .env.local ya está generado para local

# 3. Backend local (requiere Docker corriendo) — levanta Postgres, Auth, Studio…
npm run db:start             # imprime las URLs y las keys locales

# 4. Genera los tipos TypeScript desde el esquema
npm run db:types

# 5. Frontend
npm run dev                  # http://localhost:3000
```

Servicios locales tras `npm run db:start`:

| Servicio | URL |
| :-- | :-- |
| API (SUPABASE_URL) | http://127.0.0.1:54321 |
| Studio (panel) | http://127.0.0.1:54323 |
| Inbucket (emails de prueba) | http://127.0.0.1:54324 |
| Postgres | postgresql://postgres:postgres@127.0.0.1:54322/postgres |

## Scripts

| Script | Qué hace |
| :-- | :-- |
| `npm run dev` | Next.js en modo desarrollo |
| `npm run build` / `npm run start` | Build y arranque de producción |
| `npm run lint` | ESLint |
| `npm run db:start` / `db:stop` | Levanta / detiene el stack local de Supabase |
| `npm run db:reset` | Re-aplica todas las migraciones + `seed.sql` en local |
| `npm run db:diff` | Genera SQL de migración a partir de cambios locales |
| `npm run db:push` | Aplica migraciones al proyecto cloud enlazado |
| `npm run db:types` | Regenera `src/lib/database.types.ts` desde el esquema |
| `npm run functions:serve` | Sirve las Edge Functions localmente |

## Flujo de cambios en la base de datos

La fuente de verdad del esquema son las migraciones en `supabase/migrations/`
(no la nube). El ciclo es:

```bash
npx supabase migration new <nombre>   # crea un .sql vacío en supabase/migrations/
# …escribes el SQL (tablas, RLS, funciones)…
npm run db:reset                       # lo aplicas y validas en local
git add supabase/ && git commit        # se versiona como cualquier código
```

Para llevarlo a un ambiente cloud (staging/producción):

```bash
npx supabase link --project-ref <ref-del-proyecto>
npm run db:push
```

## Ambientes

| Ambiente | Dónde | Keys |
| :-- | :-- | :-- |
| dev | Docker local (`npm run db:start`) | en `.env.local` (defaults locales) |
| staging | Proyecto Supabase en la nube | en Vercel (env del proyecto) |
| producción | Otro proyecto Supabase en la nube | en Vercel (env del proyecto) |

Las **mismas migraciones** se aplican a los tres ambientes, garantizando que
prod ≡ staging ≡ local.

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
│  ├─ config.toml           # config del stack local
│  ├─ migrations/           # esquema versionado (fuente de verdad)
│  └─ seed.sql              # datos de prueba locales
└─ docs/context/            # documentación del producto (Docs 0–9 + revisión)
```

## Seguridad (recordatorios clave)

- La `ANON key` es **pública** y va al navegador; la protección real es **RLS**
  (Doc 3). Toda tabla nueva debe nacer con RLS activado (default-deny).
- La `SERVICE_ROLE key` **se salta RLS**: solo en servidor / Edge Functions,
  nunca en el cliente (S-15 / RN-26).
