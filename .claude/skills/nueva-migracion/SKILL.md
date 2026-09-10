---
name: nueva-migracion
description: Crea una migración de Supabase para Enséñame Ya siguiendo el patrón del proyecto (RLS default-deny, grants a los roles de la API y a service_role, vistas con security_invoker, auditoría updated_at, políticas con (select auth.uid()), dinero solo service_role, RPC con drop+create). Úsalo al añadir o cambiar tablas, políticas, vistas o funciones en la base de datos.
---

# Nueva migración (Enséñame Ya)

Cuando se pida crear o modificar el esquema de la base de datos:

1. **Crea el archivo** en `supabase/migrations/` con nombre
   `YYYYMMDDHHMMSS_<slug>.sql` (timestamp creciente; usa la fecha/hora actual).
   El slug es una frase en español que dice qué hace (`el_cobro_lo_decide_el_alumno`).
   ⚠️ **No escribas nada que dependa de ser la última.** El CI aplica con
   `supabase db push --yes --include-all`, así que una migración con timestamp **menor** puede
   ejecutarse **después** de otra con timestamp mayor (basta que se mergee más tarde). Declara lo
   que necesitas (`if not exists`, `create or replace`, un `where` que no asuma datos) en vez de
   confiar en el orden.

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
   - **`payment_routing_rules` se toca con una MIGRACIÓN, jamás con un `UPDATE` a mano.** El
     ruteo de cobro y payout es esquema versionado como todo lo demás; tocarlo por fuera es cómo
     dev y producción acabaron ruteando distinto durante semanas.

3. **Grants — auto-expose está OFF, y hacen falta para los dos lados:**
   - Cliente: `grant select, insert, … on public.<tabla> to authenticated;` (o `anon` si es
     catálogo público). Sin grant recibe *permission denied* aunque la RLS permita.
   - **`service_role` también** (regla de oro 9). Se salta la RLS, pero **no** los grants de
     tabla: un job con `service_role` se come `permission denied` **en tiempo de ejecución** —no
     en el build, no en el typecheck— hasta que su migración declare
     `grant select, insert, update on public.<tabla> to service_role;`. Es el fallo más caro del
     repo (mordió tres veces el 6-ago) y hoy lo declaran 61 de las 178 migraciones. **Tabla que
     toque un job = grant explícito, en la misma migración.**
   - Funciones: `grant execute on function public.<fn>(args) to authenticated;` / `to
     service_role;` según quién la llame.

4. **Vistas: `with (security_invoker = true)` SIEMPRE**, y **columnas explícitas**, nunca
   `tabla.*`. Sin el invoker la vista corre con los privilegios de su dueño y se salta la RLS de
   las tablas que envuelve, publicando lo que esas políticas tapaban. Con columnas explícitas, lo
   que se añada mañana a la tabla no se cuela solo en una superficie pública. Precedente:
   `20260804120000` (`tutors_public`).

5. **Tabla puente nueva → embeds ambiguos.** Si la tabla nueva une dos tablas que ya tenían FK
   directa, PostgREST deja de poder resolver `.select("…, profiles(full_name)")` y devuelve
   `PGRST201`: la consulta entera **se cae**, no se degrada. Hay que nombrar la FK en el código
   que consulta — `profiles!tutor_profiles_profile_id_fkey(full_name)` — y avisarlo en la
   cabecera de la migración: quien crea la tabla puente no es quien ve caerse la consulta.

6. **Cambiar la firma de una RPC es `drop function` + `create`, JAMÁS `create or replace`.**
   Al cambiar la lista de argumentos, PostgreSQL **no reemplaza: crea una SOBRECARGA**. Quedan
   dos funciones con el mismo nombre, PostgREST no puede elegir y responde `PGRST203`. Y como
   `supabase-js` no serializa las claves `undefined`, el formulario resuelve o no según los
   campos que el usuario rellene: falla en unos casos y no en otros. Pasó con
   `20260910190000` (rompió el formulario bancario del tutor) y lo arregla `20260910220000`.
   ⚠️ Y el `drop` **se lleva los `grant execute` por delante**: hay que reponerlos en la misma
   migración, sobre la función que sobrevive.

7. **Función que corre por cron: mira su última corrida después de aplicarla.**
   ```sql
   select j.jobname, d.status, d.return_message
     from cron.job_run_details d join cron.job j using (jobid)
     order by d.start_time desc limit 5;
   ```
   Un `pg_cron` que falla **no se lo dice a nadie**: ni build en rojo, ni 500 en Vercel, ni fila
   en `notifications`. `close_expired_sessions()` acumuló miles de fallos seguidos por un `case`
   sin `::session_status`, y `create or replace` **valida la sintaxis, no ejecuta el cuerpo** — el
   fallo sobrevivió a una reescritura entera. Agrega por `jobname` y `status`: leer las diez
   últimas filas solo enseña los jobs frecuentes, y los diarios/semanales pueden llevar semanas
   rotos sin salir en esa ventana. Los **nueve** jobs de `pg_cron` viven en estas migraciones
   (`grep -rn "cron.schedule" supabase/migrations/`), no en `vercel.json` ni en
   `.github/workflows/`. Y «arreglado» significa arreglado **en su ambiente**: hasta que la
   migración aterriza en prod, allí sigue fallando.

8. **Cabecera: explica el POR QUÉ, con fichero y línea.** El estilo de la casa es un bloque de
   guiones al principio del fichero: qué cambia, qué se rompía o qué decisión lo obliga, y las
   referencias concretas (`src/app/api/cron/payouts-process/route.ts:734`, `20260910190000`,
   `docs/DICTADO-PAGOS.md`). **No ancles a «Doc N §X»**: esa convención está muerta —de las
   migraciones de septiembre, una cita un Doc y diez citan `docs/DICTADO-PAGOS.md`, que es lo que
   manda en cobro y payout.

9. **`comment on table` / `comment on column`** para lo que no se deduce del nombre: unidades,
   qué significa un `null`, de dónde sale el valor. Lo hacen 85 de las 178 migraciones y es lo que
   queda cuando el que la escribió no está.

10. **Aplica a dev cloud:** `npm run db:push` (requiere `supabase link` a dev una vez;
    ver `docs/ENTORNOS.md`). No hay stack local. A **prod** llega por CI al mergear a `main`.

11. **Regenera tipos:** `npm run db:types` y commitea `src/lib/database.types.ts`.

12. **Verifica** que `npm run lint` y `npm run typecheck` sigan en verde.

## Plantilla

```sql
-- ============================================================================
-- Enséñame Ya — <qué hace esta migración, en una frase>
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- <Qué se rompía, o qué decisión lo obliga. Con referencias concretas:
--  fichero:línea, la migración anterior, docs/DICTADO-PAGOS.md si es de dinero.>
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- <Lo que muerde a quien venga: un embed que hay que nombrar, un job que hay
--  que mirar, un grant que se repone.>
-- ============================================================================

create table public.<tabla> (
  id         uuid primary key default gen_random_uuid(),
  -- columnas…
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  public.<tabla>          is '<para qué existe>';
comment on column public.<tabla>.<col>    is '<unidad, qué significa null, de dónde sale>';

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

-- Grants para la Data API (auto-expose OFF). RLS es la barrera; el grant solo deja llegar al rol.
grant select on public.<tabla> to authenticated;
-- grant select on public.<tabla> to anon;   -- si es catálogo público

-- ⚠️ Regla de oro 9: si un job toca esta tabla, su grant va AQUÍ o falla en ejecución.
-- grant select, insert, update on public.<tabla> to service_role;
```

### Vista

```sql
create or replace view public.<vista>
with (security_invoker = true) as
  select t.id, t.<col>            -- columnas explícitas, nunca t.*
    from public.<tabla> t;

comment on view public.<vista> is
  '<qué expone>. security_invoker: hereda la RLS de <tablas>.';

grant select on public.<vista> to anon, authenticated;
```

### RPC a la que se le añade un argumento

```sql
-- drop + create, NUNCA create or replace: cambiar los argumentos crea una
-- SOBRECARGA y PostgREST responde PGRST203 (ver 20260910190000 → 20260910220000).
drop function if exists public.<fn>(<lista exacta de la firma vieja>);

create or replace function public.<fn>(<firma nueva>)
returns <tipo>
language plpgsql
security definer
set search_path = public
as $$ … $$;

-- El drop se llevó los privilegios: se reponen sobre la que sobrevive.
grant execute on function public.<fn>(<firma nueva>) to authenticated;
```
