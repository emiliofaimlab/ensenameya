# Enséñame Ya — Ambientes dev / prod (US-1603)

> **Objetivo:** dos entornos **100% cloud e independientes** — **dev** y **prod** — cada uno con su
> proyecto Supabase y su deploy en Vercel, con migraciones aplicadas por CI.
> **No hay stack local**: se desarrolla directamente contra **dev cloud** (vibe coding al máximo).
> Cabe en el free tier de Supabase (2 proyectos/org).
> Este doc trae (a) la arquitectura, (b) el flujo sin local y (c) el checklist de setup.

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
| `DAILY_API_KEY` | Sala de video real (EP-08) | Sala simulada |
| `NEXT_PUBLIC_REFERRAL_URL` | Bloque "Invita y gana" (US-1301) | El bloque **no se pinta** |
| `SENTRY_DSN` · `NEXT_PUBLIC_SENTRY_DSN` | Monitoreo de errores (US-1501) | El SDK ni se inicializa |

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

### C) Vercel (1 proyecto) — https://vercel.com — [x] hecho
- [x] **Import Project** desde `github.com/emiliofaimlab/ensenameya` (Next.js autodetecta). Production Branch = **`main`**.
- [x] Env vars (Settings → Environment Variables), dos juegos con las claves
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`:
  - Scope **Production** → valores de **prod**.
  - Scope **Preview** → valores de **dev**.

### D) GitHub — Environments (CI de migraciones) — [x] hecho, salvo branch protection
- [x] Repo → Settings → **Environments** → **`production`** y **`development`** creados; en cada uno el
  *Environment secret* `SUPABASE_DB_URL` = connection string del **session pooler** (percent-encoded):
  `postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
- [x] Rama **`dev`** creada desde `main`.
- [ ] (Recomendado) Branch protection en `main`: PR + checks verdes. **Sin configurar** (la API de
  protección devuelve 404 el 5-ago): hoy nada impide un push directo a `main` → prod.

### E) Jira — [x] conectado (proyecto `EY`, `faimlab.atlassian.net`).

---

## 4. Estado actual

- [x] Repo `emiliofaimlab/ensenameya` · `gh` CLI autenticado · Jira `EY` conectado.
- [x] Supabase **dev** y **prod** creados; esquema base + grants aplicados a ambos.
- [x] `.env.local` apunta la app a **dev cloud**.
- [x] CI **activo y validado**: `main`→prod aplicado por Actions (no-op OK). Tolerante si falta el secret.
- [x] GitHub Environments (production/development) + secret `SUPABASE_DB_URL` + ramas `main`/`dev`.
- [x] Vercel: proyecto importado, **prod desplegado** (`ensenameya.vercel.app`); env vars Production→prod, Preview→dev.
- [x] Auth: Site URL + Redirect URLs en prod y dev; "Confirm email" **off** en dev.
- [x] CLI enlazado a **dev** (`supabase/.temp/linked-project.json`): `db:push` y `db:types` corren
  contra el proyecto enlazado — `db:types` usa `--linked` (package.json), sin Docker ni `--project-id`.
- [ ] Google OAuth por proyecto (Client ID/Secret) — pendiente (email/password ya funciona).
- [ ] Rotar secret keys antes del primer usuario real.
- [ ] Branch protection en `main` (ver §3D).

**Ramas y despliegue al 5-ago — nada nuevo ha llegado a prod desde el 29-jul.** `main` y `origin/dev`
están en el **mismo commit** (`57edfa9`); todo lo cerrado después vive en `feat/tanda1-cierres` →
**PR #11 hacia `dev`** (25 commits, 148 ficheros, lint/typecheck y preview de Vercel en verde,
mergeable, **sin revisar**). Hacen falta **dos merges** —a `dev` y luego a `main`— para que llegue a
producción, y cada uno dispara su job de migraciones.

**Migraciones por ambiente.** **dev al día**: 66/66 aplicadas, la última
`20260804120000_dd04_vista_precio_tutor.sql` (`npx supabase migration list --linked`, 5-ago).
**prod va 12 por detrás**: le faltan las de `20260729130000` en adelante, porque el CI solo las aplica
al mergear a `main`. Ojo con el orden al desplegar: la app nueva contra el esquema viejo revienta.

*Última edición: 2026-08-05.*
