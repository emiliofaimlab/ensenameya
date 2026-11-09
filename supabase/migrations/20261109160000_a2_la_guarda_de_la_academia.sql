-- ============================================================================
-- Enséñame Ya — `mi_academia()`: la academia que administra el usuario actual
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- La guarda de `/academia` (`src/lib/auth/academia.ts`) filtraba
-- `academies.owner_id` por la Data API, y `owner_id` NO tiene grant de columna
-- para `authenticated` (`20261009170100`: el acuerdo es privado). Resultado:
-- `permission denied for table academies` y la pantalla de error para todo el
-- que entraba. Visto en dev el 9-nov al probar A2.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Excluye las suspendidas: `docs/REQUERIMIENTOS.md` §5 da acceso al dueño de
--   una academia «que no esté suspendida». Borrador sí entra.
-- ============================================================================

create or replace function public.mi_academia()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.academies a
   where a.owner_id = (select auth.uid()) and a.status <> 'suspended'
   order by a.created_at
   limit 1
$$;

comment on function public.mi_academia() is
  'A2/A3 · id de la academia (no suspendida) cuyo owner_id es el usuario actual, o NULL. La usa la guarda de /academia.';

revoke execute on function public.mi_academia() from public, anon;
grant  execute on function public.mi_academia() to authenticated;
