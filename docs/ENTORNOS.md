# Enséñame Ya — Ambientes dev / staging / prod (US-1603)

> **Objetivo:** tres ambientes **online e independientes** (dev, staging, prod), cada uno con su
> **proyecto Supabase** propio y su **deploy en Vercel**, con migraciones aplicadas por CI.
> Este doc trae (a) la arquitectura y (b) el **checklist de lo que debes crear/autorizar tú**
> (yo dejé el repo listo; las cuentas cloud las creas tú).

---

## 1. Arquitectura (una imagen mental)

```
Rama git         Vercel (1 proyecto)          Supabase (3 proyectos)
─────────        ───────────────────          ──────────────────────
main       ───▶  Production deployment  ───▶  ensenameya-prod
staging    ───▶  Preview (rama staging) ───▶  ensenameya-staging
dev / PRs  ───▶  Preview (default)      ───▶  ensenameya-dev
```

- **Un solo proyecto Vercel** conectado al repo de GitHub. Vercel distingue ambientes por **variables
  de entorno con scope** (Production / Preview, y Preview puede fijarse a una rama concreta).
- **Un proyecto Supabase por ambiente** (aislamiento real de datos; es lo que pide US-1603).
- **Migraciones = git.** CI las aplica: push a `staging` → Supabase staging; push a `main` → Supabase prod.
  Dev se aplica a mano (`npm run db:push` enlazado a dev) o local con `db:reset`.

**Mapa de variables (mismas claves, distinto valor por ambiente):**

| Variable | dev | staging | prod |
| :-- | :-- | :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` | url dev | url staging | url prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon dev | anon staging | anon prod |
| `SUPABASE_SERVICE_ROLE_KEY` | service dev | service staging | service prod |

> El `service_role` **solo** como env server-side en Vercel (nunca `NEXT_PUBLIC_*`). Regla de oro 3.

---

## 2. Checklist — lo que debes hacer tú

### A) Supabase (3 proyectos) — https://supabase.com
- [ ] Crear proyecto **`ensenameya-dev`**, **`ensenameya-staging`**, **`ensenameya-prod`** (misma región).
- [ ] Guardar de cada uno (Project Settings → API): **Project URL**, **anon key**, **service_role key**, **Project Ref** (el `<ref>` de la URL).
- [ ] Guardar la **DB password** de cada proyecto (Project Settings → Database).
- [ ] En Auth de cada proyecto: activar **Google OAuth** (Client ID/Secret) y añadir la URL de Vercel correspondiente a *Redirect URLs*.
- [ ] Enlazar dev en tu máquina para migraciones manuales: `npx supabase link --project-ref <ref-dev>`.

### B) Vercel (1 proyecto) — https://vercel.com
- [ ] **Import Project** desde `github.com/emiliofaimlab/ensenameya`; framework Next.js (autodetecta).
- [ ] Production Branch = **`main`**.
- [ ] Variables de entorno (Project Settings → Environment Variables), tres juegos:
  - Scope **Production** → valores de **prod**.
  - Scope **Preview**, *Branch* = **`staging`** → valores de **staging**.
  - Scope **Preview** (sin rama, default) → valores de **dev**.
  - Claves: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### C) GitHub — secretos y Environments (para el CI de migraciones)
- [ ] Repo → Settings → Secrets and variables → Actions → **secret** `SUPABASE_ACCESS_TOKEN`
      (genéralo en Supabase → Account → Access Tokens).
- [ ] Repo → Settings → **Environments** → crear **`staging`** y **`production`**. En cada uno, *Environment secrets*:
  - `SUPABASE_PROJECT_REF` (el ref del proyecto de ese ambiente)
  - `SUPABASE_DB_PASSWORD` (la DB password de ese ambiente)
- [ ] Crear las ramas **`dev`** y **`staging`** a partir de `main` (`git switch -c staging && git push -u origin staging`, ídem `dev`).
- [ ] (Recomendado) Branch protection en `main`: requiere PR + checks verdes.

### D) Jira (para el vibe-coding del paso 8)
- [ ] Autorizar el **connector de Atlassian** desde tu configuración de connectors en claude.ai
      (esta sesión no puede hacer OAuth). Sin eso, no puedo leer/mover tarjetas de Jira.
- [ ] Confirmarme el **site** y la **project key** de Jira (p. ej. `ENSENAMEYA`).

---

## 3. El flujo de trabajo resultante (paso 8)

Una vez hecho el checklist:

1. **GitHub ya está listo** — `gh` CLI autenticado (`josefaimlab`). Puedo crear ramas, PRs y push.
2. Tomo una historia (US-xxx) de Jira → rama `feat/US-xxx-...` desde `dev`.
3. Implemento (migración + pantalla), `lint`+`tsc`, abro PR → Vercel levanta un **Preview** contra Supabase dev.
4. Merge a `staging` → deploy staging + `supabase db push` a staging (CI).
5. Merge a `main` → producción + `supabase db push` a prod (CI).

**Lo que puedo conducir yo hoy:** git/PRs (gh CLI). **Lo que necesita tu autorización:** mover
tarjetas de Jira (connector Atlassian) y que las cuentas Vercel/Supabase existan con sus secretos.

---

## 4. Estado actual

- [x] Repo GitHub: `emiliofaimlab/ensenameya` · `gh` CLI autenticado.
- [x] CI de migraciones: `.github/workflows/supabase-migrations.yml` (espera los secretos de C).
- [x] `.env.example` con las claves por ambiente.
- [ ] Supabase dev/staging/prod (checklist A).
- [ ] Vercel proyecto + env vars (checklist B).
- [ ] Secretos + Environments en GitHub (checklist C).
- [ ] Jira connector autorizado (checklist D).

*Última edición: 2026-07-03.*
