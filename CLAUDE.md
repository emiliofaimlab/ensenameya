# Enséñame Ya — Manual del proyecto

> MVP web: marketplace de tutorías **1:1 en vivo** (alumno ↔ tutor) con reservas,
> pagos (**capa agnóstica** por geografía; proveedor pendiente — C-01/DP-01, hoy se evalúa DLocal + Stripe de respaldo), videollamada (Daily) y panel admin.
> **Monorepo:** frontend Next.js + backend Supabase en este mismo repo.

## Planificación — qué construir y en qué orden

- **`docs/BACKLOG.md`** — backlog vigente (18 épicas / 60 historias / 4 sprints), **espejo de Jira**. Manda en *qué y cuándo*.
- **`docs/PLAN-DESARROLLO.md`** — estado de ejecución (hecho / en curso / pendiente) por sprint.
- **`docs/context/ADENDA-BACKLOG-v1.md`** — deltas del backlog v1.0 sobre los Docs 00–09 (RN-37..44, NTF-17..20, EP-17/18, `pending_acceptance`).
- **`docs/ENTORNOS.md`** — ambientes dev + prod cloud (sin local) en Supabase + Vercel, flujo de trabajo y checklist (US-1603).

Sprint activo: **Sprint 3** (sala en vivo, reseñas, payouts, admin, notificaciones, chat). S1 y S2 cerrados.

## Stack

- **Frontend:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · React 19 → deploy en **Vercel**.
- **Backend:** **Supabase** — Postgres + RLS, Auth (email + Google OAuth), Storage, Edge Functions.
- **Sin stack local:** la app corre en local (`npm run dev`) contra la **BD de dev cloud**; deploy en Vercel (`main`→prod, `dev`/PR→preview). Detalle y flujo en `docs/ENTORNOS.md`.

## Comandos (rutina diaria)

```bash
npm run dev        # frontend → http://localhost:3000 (contra dev cloud)
```

| Comando | Para qué |
| :-- | :-- |
| `npm run db:push` | Aplica migraciones al proyecto **dev** enlazado |
| `npm run db:types` | Regenera `src/lib/database.types.ts` (requiere link) |
| `npm run lint` · `npm run typecheck` | Lint y typecheck |

Enlace único del CLI a dev (pide access token): `npx supabase link --project-ref lbtpnszjjsxbeileqsja`.
Tras cambiar el esquema: `npm run db:push` **y** `npm run db:types`. A **prod** llega por **CI** al mergear a `main`.

## Reglas de oro (no romper)

1. **RLS default-deny.** Toda tabla nueva nace con `enable row level security` + políticas explícitas. Sin política = nadie ve nada (a propósito). Olvidarla "falla abierto" → fuga (RISK-13).
2. **El dinero es server-side.** Escritura en `payments`/`payouts`/etc. solo con `service_role` (Edge Functions). Nunca desde el cliente. (S-15 / RN-26)
3. **`service_role` jamás en el cliente** ni en variables `NEXT_PUBLIC_*`. El navegador usa la ANON/publishable key (sujeta a RLS).
4. **Fechas en UTC** en la BD; se renderizan en la **hora local** del usuario. (RN-01 / RN-02 → RISK-12)
5. **Migraciones = fuente de verdad** del esquema (`supabase/migrations/`). No se cambia el esquema a mano en la nube; se versiona en git.
6. **Tipos generados:** tras tocar el esquema, `npm run db:types`. No editar `database.types.ts` a mano.
7. **Operaciones con snapshots financieros** (p. ej. crear `booking`) van por **función controlada / Edge Function**, no por insert directo del cliente. (cierra H-2)
8. **Nada de inventar decisiones pendientes** (DP-xx): se consumen como configuración, no como código acoplado. Ver Doc 9.

## Dónde está cada cosa

```
src/app/                      rutas y páginas (App Router)
src/proxy.ts                  refresco de sesión (convención Next 16)
src/lib/supabase/client.ts    cliente navegador (ANON + RLS)
src/lib/supabase/server.ts    cliente Server Components (ANON + RLS, async)
src/lib/supabase/middleware.ts helper de sesión usado por proxy.ts
src/lib/database.types.ts     tipos generados (no editar a mano)
supabase/migrations/          esquema versionado (fuente de verdad)
supabase/config.toml          config del CLI de Supabase (link, migraciones)
docs/BACKLOG.md               backlog vigente (sprints, espejo de Jira)
docs/PLAN-DESARROLLO.md       estado de ejecución por sprint
docs/ENTORNOS.md              ambientes dev + prod (Supabase + Vercel) + local
docs/context/                 docs técnicos (Docs 0–9 + adenda + revisión + aprobación cliente)
```

## Patrón RLS (referencia rápida)

- Propiedad: `using ( (select auth.uid()) = <owner_col> )` (el `select` ayuda al planner).
- Rol admin: helper `public.has_role('admin')` (SECURITY DEFINER, evita recursión).
- Alta de perfil + rol `alumno` automática al registrarse (trigger `handle_new_user`).
- **Grants:** los proyectos tienen "auto-expose new tables" **OFF** → cada tabla expuesta al cliente declara sus `grant` (públicas→`anon`, privadas→`authenticated`) junto a sus políticas. RLS sigue siendo la barrera default-deny.
- **Docs vs código:** los Docs 0–9 son el **objetivo** (p. ej. nombran el enum `user_role` y `has_role(uid, role)` de dos args); el **código manda** en nombres concretos (enum real `app_role`, `has_role('admin')` de un arg). Ante divergencia, gana la migración.

## Contexto profundo (lee el doc relevante, no los 12)

| Doc | Cubre |
| :-- | :-- |
| 00 | Glosario y modelo conceptual (**manda en lo conceptual**) |
| 01 / 02 / 03 | Modelo de datos / máquinas de estado / roles y RLS |
| 04 / 05 | Mapa de pantallas y flujos / spec por pantalla |
| 06 / 07 | Arquitectura de pagos e integraciones / matriz de notificaciones |
| 08 / 09 | Backlog (⚠️ superado por `docs/BACKLOG.md`; conserva la matriz de trazabilidad §8.4) / riesgos y decisiones pendientes |
| `REVISION-docs-1-3.md` → **Anexo A** | Arquitectura del proyecto |

Todos en `docs/context/`.

**Visión comercial / aprobación del cliente:** `APROBACION-CLIENTE-FAIMLAB.md`
(v1 · 2026-06-09) — resumen **completo y no técnico** para firma del cliente:
perfiles, ~49 pantallas, flujos FL-01…05, procesos de pago por geografía y
**15 decisiones a confirmar `C-01…C-15`** (bloqueantes restantes: C-01 proveedores ·
C-13 mercado/Venezuela · C-14 requisitos para aprobar tutor). **C-03 reembolsos →
RESUELTO por RN-37** (≥24h=100%, <24h alumno=50%, tutor=100%; ver adenda §6).
Los `C-xx` son la cara-cliente de las `DP-xx`/supuestos (C-01→DP-01, C-02→DP-02,
C-03→DP-03, C-04→DP-06, C-05→DP-08, C-10→DP-04, C-11→DP-05, C-15→DP-07); cuando el
cliente responda se consumen como **configuración** (regla de oro 8), no como código.
El **detalle técnico** sigue viviendo en los Docs 0–9, que **mandan en lo técnico**.

## Skills del proyecto

- `/nueva-migracion` — migración + RLS siguiendo el patrón del proyecto.
- `/nueva-pantalla` — página Next.js con las convenciones de arriba.
