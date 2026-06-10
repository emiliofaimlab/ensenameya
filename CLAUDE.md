# Enséñame Ya — Manual del proyecto

> MVP web: marketplace de tutorías **1:1 en vivo** (alumno ↔ tutor) con reservas,
> pagos (**capa agnóstica** por geografía; proveedor pendiente — C-01/DP-01, hoy se evalúa DLocal + Stripe de respaldo), videollamada (Daily) y panel admin.
> **Monorepo:** frontend Next.js + backend Supabase en este mismo repo.

## Stack

- **Frontend:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · React 19 → deploy en **Vercel**.
- **Backend:** **Supabase** — Postgres + RLS, Auth (email + Google OAuth), Storage, Edge Functions.
- **Local:** stack de Supabase en **Docker**; Next.js nativo en Node (no en Docker).

## Comandos (rutina diaria)

```bash
npm run db:start   # backend local (requiere Docker abierto). Idempotente.
npm run dev        # frontend → http://localhost:3000
```

| Comando | Para qué |
| :-- | :-- |
| `npm run db:stop` | Apaga el stack local (los datos persisten) |
| `npm run db:reset` | ⚠️ Re-aplica migraciones + seed **borrando** los datos locales |
| `npm run db:diff` | Genera SQL de migración desde cambios locales |
| `npm run db:push` | Aplica migraciones al proyecto cloud enlazado |
| `npm run db:types` | Regenera `src/lib/database.types.ts` desde el esquema |
| `npm run functions:serve` | Sirve las Edge Functions en local (donde vive el dinero, reglas 2/7) |
| `npm run lint` · `npx tsc --noEmit` | Lint y typecheck |

Tras cambiar el esquema: `npm run db:reset` (local) **y** `npm run db:types`.

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
supabase/config.toml          config del stack local
docs/context/                 documentación del producto (Docs 0–9 + revisión + aprobación cliente)
```

## Patrón RLS (referencia rápida)

- Propiedad: `using ( (select auth.uid()) = <owner_col> )` (el `select` ayuda al planner).
- Rol admin: helper `public.has_role('admin')` (SECURITY DEFINER, evita recursión).
- Alta de perfil + rol `alumno` automática al registrarse (trigger `handle_new_user`).
- **Docs vs código:** los Docs 0–9 son el **objetivo** (p. ej. nombran el enum `user_role` y `has_role(uid, role)` de dos args); el **código manda** en nombres concretos (enum real `app_role`, `has_role('admin')` de un arg). Ante divergencia, gana la migración.

## Contexto profundo (lee el doc relevante, no los 12)

| Doc | Cubre |
| :-- | :-- |
| 00 | Glosario y modelo conceptual (**manda en lo conceptual**) |
| 01 / 02 / 03 | Modelo de datos / máquinas de estado / roles y RLS |
| 04 / 05 | Mapa de pantallas y flujos / spec por pantalla |
| 06 / 07 | Arquitectura de pagos e integraciones / matriz de notificaciones |
| 08 / 09 | Backlog y trazabilidad / riesgos y decisiones pendientes |
| `REVISION-docs-1-3.md` → **Anexo A** | Arquitectura del proyecto |

Todos en `docs/context/`.

**Visión comercial / aprobación del cliente:** `APROBACION-CLIENTE-FAIMLAB.md`
(v1 · 2026-06-09) — resumen **completo y no técnico** para firma del cliente:
perfiles, ~49 pantallas, flujos FL-01…05, procesos de pago por geografía y
**15 decisiones a confirmar `C-01…C-15`** (4 **BLOQUEANTES**: C-01 proveedores ·
C-03 reembolsos · C-13 mercado/Venezuela · C-14 requisitos para aprobar tutor).
Los `C-xx` son la cara-cliente de las `DP-xx`/supuestos (C-01→DP-01, C-02→DP-02,
C-03→DP-03, C-04→DP-06, C-05→DP-08, C-10→DP-04, C-11→DP-05, C-15→DP-07); cuando el
cliente responda se consumen como **configuración** (regla de oro 8), no como código.
El **detalle técnico** sigue viviendo en los Docs 0–9, que **mandan en lo técnico**.

## Skills del proyecto

- `/nueva-migracion` — migración + RLS siguiendo el patrón del proyecto.
- `/nueva-pantalla` — página Next.js con las convenciones de arriba.
