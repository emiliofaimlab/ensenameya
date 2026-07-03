# Enséñame Ya — Ambientes dev / prod (US-1603)

> **Objetivo:** entornos **online e independientes**, cada uno con su **proyecto Supabase** propio y su
> **deploy en Vercel**, con migraciones aplicadas por CI. Modelo elegido (cabe en el free tier de
> Supabase = 2 proyectos/org): **dev + prod en cloud**, más **local (Docker)** para iterar.
> Este doc trae (a) la arquitectura y (b) el **checklist de lo que creas/autorizas tú**.

---

## 1. Arquitectura

```
Rama git         Vercel (1 proyecto)       Supabase
─────────        ───────────────────       ────────────────────
main       ───▶  Production          ───▶  ensenameya-prod (cloud)
dev / PRs  ───▶  Preview             ───▶  ensenameya-dev  (cloud)
(local: stack Docker = scratch de desarrollo antes de subir a dev)
```

- **Un proyecto Vercel** conectado al repo; distingue ambientes por **env vars con scope**
  (Production vs Preview).
- **Dos proyectos Supabase** (dev y prod) para aislamiento real de datos.
- **Migraciones = git.** CI aplica: push a `main` → prod; push a `dev` → dev cloud. En local, `db:reset`/`db:push`.

**Valores por ambiente (no secretos — URL y ref son públicos):**

| | dev | prod |
| :-- | :-- | :-- |
| Project ref | `lbtpnszjjsxbeileqsja` | `nrzsyysqanbrcgtslfte` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lbtpnszjjsxbeileqsja.supabase.co` | `https://nrzsyysqanbrcgtslfte.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable dev | publishable prod |
| `SUPABASE_SERVICE_ROLE_KEY` | secret dev | secret prod |

> Claves `secret`/`service_role` y DB passwords **solo** como secrets de Vercel/GitHub, nunca en el repo
> ni en `NEXT_PUBLIC_*`. Regla de oro 3.

---

## 2. Checklist — lo que haces tú

### A) Supabase (2 proyectos) — https://supabase.com
- [x] **`ensenameya-prod`** creado (ref `nrzsyysqanbrcgtslfte`, East US, automatic RLS on).
- [ ] Crear **`ensenameya-dev`** (mismos ajustes: East US · Enable automatic RLS ✓ · Automatically expose new tables ⬜ · sin conectar GitHub · guarda la DB password).
- [ ] De cada proyecto (Settings → API): **Project URL**, **publishable key**, **secret key**, **ref**; y la **DB password** (Settings → Database).
- [ ] Auth de cada proyecto: activar **Google OAuth** (Client ID/Secret) + añadir la URL de Vercel a *Redirect URLs*.

### B) Vercel (1 proyecto) — https://vercel.com
- [ ] **Import Project** desde `github.com/emiliofaimlab/ensenameya` (Next.js autodetecta). Production Branch = **`main`**.
- [ ] Env vars (Settings → Environment Variables), dos juegos:
  - Scope **Production** → valores de **prod**.
  - Scope **Preview** → valores de **dev**.
  - Claves: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### C) GitHub — Environments (CI de migraciones)
- [ ] Repo → Settings → **Environments** → crear **`production`** y **`development`**. En cada uno, un *Environment secret*:
  - `SUPABASE_DB_URL` = connection string del **session pooler** (percent-encoded):
    `postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
- [ ] Crear la rama **`dev`** desde `main` (`git switch -c dev && git push -u origin dev`).
- [ ] (Recomendado) Branch protection en `main`: requiere PR + checks verdes.

### D) Jira — [x] conectado (proyecto `EY`, `faimlab.atlassian.net`).

---

## 3. Flujo de trabajo (paso 8)

1. **GitHub ya listo** — `gh` CLI autenticado (`josefaimlab`): ramas, PRs, push.
2. Tomo una historia (US-xxx) de Jira → rama `feat/US-xxx-…` desde `dev`.
3. Implemento (migración + pantalla), `lint`+`tsc`, abro PR → Vercel levanta **Preview** contra Supabase dev.
4. Merge a `dev` → deploy dev + `supabase db push` a dev cloud (CI).
5. Merge a `main` → producción + `supabase db push` a prod (CI).

---

## 4. Estado actual

- [x] Repo GitHub `emiliofaimlab/ensenameya` · `gh` CLI autenticado.
- [x] Jira `EY` conectado (sync inicial hecho).
- [x] CI de migraciones `.github/workflows/supabase-migrations.yml` (ramas `main`/`dev`; usa `SUPABASE_DB_URL` por entorno).
- [x] Supabase **prod** (`nrzsyysqanbrcgtslfte`) y **dev** (`lbtpnszjjsxbeileqsja`) creados.
- [x] Esquema base + grants Data API **aplicados a dev y prod** (`db push --db-url`).
- [x] `.env.local` apunta la app a **dev cloud**.
- [ ] Vercel proyecto + env vars (§2B).
- [ ] GitHub Environments + `SUPABASE_DB_URL` (§2C).
- [ ] Rotar secret keys antes del primer usuario real.

*Última edición: 2026-07-03.*
