---
name: nueva-migracion
description: Crea una migración de Supabase para Enséñame Ya siguiendo el patrón del proyecto (RLS default-deny, auditoría updated_at, políticas con (select auth.uid()), dinero solo service_role). Úsalo al añadir o cambiar tablas, políticas o funciones en la base de datos.
---

# Nueva migración (Enséñame Ya)

Cuando se pida crear o modificar el esquema de la base de datos:

1. **Crea el archivo** en `supabase/migrations/` con nombre
   `YYYYMMDDHHMMSS_<slug>.sql` (timestamp creciente; usa la fecha/hora actual).
2. **Sigue las reglas de oro** (ver `CLAUDE.md`):
   - Toda tabla mutable lleva `created_at` y
     `updated_at timestamptz not null default now()` + trigger `set_updated_at`
     (la función ya existe en la migración inicial).
   - Activa **siempre** `alter table ... enable row level security;` y escribe
     políticas explícitas (default-deny). Nunca dejes una tabla sin RLS.
   - Propiedad: `using ( (select auth.uid()) = <owner_col> )`.
     Rol admin: `public.has_role('admin')`.
   - Tablas financieras (`payments`, `payouts`, …): **sin** políticas de
     escritura para el cliente; las escribe `service_role`. (S-15 / RN-26)
   - Fechas en UTC; enums nuevos en el esquema `public`.
   - Claves: `uuid primary key default gen_random_uuid()` salvo tablas puente /
     1:1, donde se usa PK compuesta.
3. **Ancla al doc relevante** en un comentario de cabecera (Doc 1 = campos,
   Doc 2 = estados, Doc 3 = permisos).
4. **Aplica y valida en local:** `npm run db:reset`.
   ⚠️ Borra los datos locales — avisa antes si hay datos que conservar.
5. **Regenera tipos:** `npm run db:types`.
6. **Verifica** que `npx tsc --noEmit` siga en verde.

## Plantilla

```sql
-- <Título de la migración> — Doc <n> §<x>
create table public.<tabla> (
  id         uuid primary key default gen_random_uuid(),
  -- columnas…
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger <tabla>_set_updated_at
  before update on public.<tabla>
  for each row execute function public.set_updated_at();

alter table public.<tabla> enable row level security;

create policy "<tabla>_select_own"
  on public.<tabla> for select
  using ( (select auth.uid()) = <owner_col> );

-- create policy "<tabla>_select_admin"
--   on public.<tabla> for select
--   using ( public.has_role('admin') );
```
