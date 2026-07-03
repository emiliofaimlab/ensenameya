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

---

## 2. Flujo de trabajo (sin local)

- **Correr la app:** `npm run dev` — usa `.env.local`, que apunta a **dev cloud**.
- **Cambiar el esquema:** escribe la migración en `supabase/migrations/`, luego aplícala a dev:
  ```bash
  npx supabase db push --db-url "postgresql://postgres.lbtpnszjjsxbeileqsja:<db-password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
  ```
  (o haz push a la rama `dev` y deja que el CI la aplique). A prod llega al mergear a `main`.
- **Regenerar tipos:** requiere **access token** (sin Docker se genera vía API):
  ```bash
  export SUPABASE_ACCESS_TOKEN=<pat>
  npx supabase gen types typescript --project-id lbtpnszjjsxbeileqsja > src/lib/database.types.ts
  ```
- **Convención de grants (auto-expose OFF):** toda tabla expuesta al cliente declara sus `grant`
  junto a sus políticas RLS (ver `20260703120000_data_api_grants.sql`). Públicas → `anon`; privadas →
  `authenticated`. RLS sigue siendo la barrera default-deny; el grant solo deja al rol llegar a la tabla.
- ⚠️ Los scripts `db:start` / `db:stop` / `db:reset` / `db:types --local` de `package.json` eran para el
  stack local (Docker) y **ya no aplican**. Se refactorizarán al flujo cloud.

---

## 3. Checklist de setup

### A) Supabase — [x] hecho
- [x] Proyectos **`ensenameya-prod`** (`nrzsyysqanbrcgtslfte`) y **`ensenameya-dev`** (`lbtpnszjjsxbeileqsja`) creados (East US · automatic RLS on · auto-expose off).
- [x] Esquema base + grants Data API aplicados a **dev y prod**.

### B) Auth por proyecto (Supabase → Authentication) — pendiente
- [ ] **Site URL / Redirect URLs:** añadir la URL de Vercel (prod → dominio de producción; dev → dominio de preview) **y** `http://localhost:3000` para `npm run dev`.
- [ ] **Google OAuth:** Client ID/Secret en cada proyecto; en Google Cloud, redirect autorizado `https://<ref>.supabase.co/auth/v1/callback`.
- [ ] **Dev:** desactivar **"Confirm email"** (Authentication → Providers → Email) para probar signup sin SMTP.

### C) Vercel (1 proyecto) — https://vercel.com — pendiente
- [ ] **Import Project** desde `github.com/emiliofaimlab/ensenameya` (Next.js autodetecta). Production Branch = **`main`**.
- [ ] Env vars (Settings → Environment Variables), dos juegos con las claves
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`:
  - Scope **Production** → valores de **prod**.
  - Scope **Preview** → valores de **dev**.

### D) GitHub — Environments (CI de migraciones) — pendiente
- [ ] Repo → Settings → **Environments** → crear **`production`** y **`development`**; en cada uno el
  *Environment secret* `SUPABASE_DB_URL` = connection string del **session pooler** (percent-encoded):
  `postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
- [ ] Crear la rama **`dev`** desde `main` (`git switch -c dev && git push -u origin dev`).
- [ ] (Recomendado) Branch protection en `main`: PR + checks verdes.

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
- [ ] Google OAuth por proyecto (Client ID/Secret) — pendiente (email/password ya funciona).
- [ ] Access token (PAT) para `gen types` sin Docker.
- [ ] Rotar secret keys antes del primer usuario real.

*Última edición: 2026-07-03.*
