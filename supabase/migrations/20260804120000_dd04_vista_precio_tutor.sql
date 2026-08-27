-- ============================================================================
-- DD-04 · Precio de entrada del tutor como VISTA (decisión de Jose en EY-114)
--
-- Rehace el filtro de precio de P04. La primera versión resolvía el mínimo en
-- el cliente: traía los productos activos, reducía en memoria y acotaba la
-- consulta con `in(ids)`. Paginaba y contaba bien —el `in` va antes del
-- `range`—, pero carga todo el catálogo en cada visita y el `in(ids)` tiene
-- techo de longitud de URL.
--
-- El ticket pide lo correcto: que el mínimo lo dé Postgres. Con esta vista el
-- filtro pasa a ser un `gte`/`lte` normal y el rango, la paginación y el
-- `count` los resuelve el motor. **Sin columna materializada**: no hay nada que
-- mantener ni trigger que se desincronice. El día que el plan de ejecución lo
-- pida se materializa, con datos reales y no por si acaso.
--
-- ⚠️ `security_invoker = true` NO es opcional. Una vista corre por defecto con
-- los privilegios de SU DUEÑO, así que sin esto saltaría la RLS de
-- `tutor_profiles` y de `products` y publicaría tutores no aprobados y
-- borradores. Con el invoker puesto, mandan las políticas de siempre
-- (`tutor_profiles_select_public`, `products_select_public`). Regla de oro 1.
--
-- Columnas explícitas y no `tp.*`: es superficie pública: lo que se añada a
-- `tutor_profiles` mañana (tier, datos de payout) no debe colarse solo.
-- ============================================================================

create or replace view public.tutors_public
with (security_invoker = true) as
select
  tp.profile_id,
  tp.display_name,
  tp.avatar_path,
  tp.headline,
  tp.bio,
  tp.rating_avg,
  tp.rating_count,
  tp.approval_status,
  -- Precio de entrada = la mentoría activa más barata. En un paquete compite su
  -- precio TOTAL, no el equivalente por sesión (decisión 2 de EY-114): un
  -- paquete de 120 US$ ordena como 120, no como los 15 que sale la sesión.
  barata.price_amount as price_from,
  barata.currency     as price_currency
from public.tutor_profiles tp
left join lateral (
  select pr.price_amount, pr.currency
  from public.products pr
  where pr.tutor_id = tp.profile_id
    and pr.status = 'active'
  order by pr.price_amount asc
  limit 1
) barata on true;

comment on view public.tutors_public is
  'Tutores con el precio de su mentoría activa más barata (DD-04). security_invoker: hereda la RLS de tutor_profiles y products.';

-- Mismos grants que las tablas que envuelve: el catálogo es público (RN-24) y
-- la RLS sigue siendo la barrera.
grant select on public.tutors_public to anon, authenticated;

-- El filtro ordena y acota por `products.price_amount` dentro del lateral; sin
-- este índice cada tutor se resuelve con un scan de sus productos.
create index if not exists products_tutor_price_idx
  on public.products (tutor_id, price_amount)
  where status = 'active';
