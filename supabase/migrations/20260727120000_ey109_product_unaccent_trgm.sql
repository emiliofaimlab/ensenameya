-- ============================================================================
-- Enséñame Ya — EY-109 (2ª vuelta): buscar mentorías sin tildes, de verdad.
--
-- El arreglo anterior (`20260721130000`) indexó las dos ramas en
-- `products.search_vector`, pero el fallo NO estaba en el índice sino en el
-- **lado de la consulta**: el stemmer español de Snowball es sensible al
-- acento.
--
--   documento "Aprende a programar…"  → stem `program`
--   consulta  "Programación"          → stem `program`   ✅ casa
--   consulta  "programacion"          → stem distinto     ❌ nunca casa
--
-- Cuando el usuario teclea sin tilde, las dos ramas de la consulta son el mismo
-- texto, así que ninguna llega a `program`. Verificado en dev: `programacion`
-- devolvía 0 productos y `Programación` 1.
--
-- Arreglo: un camino **no-stemmed** en paralelo, el mismo patrón que ya usan
-- los tutores — texto sin acentos + `ilike`, aquí con índice de trigramas para
-- que el `%term%` no degrade a seq scan cuando crezca el catálogo. El
-- `search_vector` se queda como está: sigue siendo el que da relevancia
-- lingüística; esto solo añade una red de seguridad para el tecleo sin tildes.
-- ============================================================================

create extension if not exists pg_trgm;

alter table public.products
  add column if not exists search_text text
  generated always as (
    public.f_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;

-- GIN de trigramas: hace indexable el `ilike '%term%'` (a diferencia del B-tree).
create index if not exists products_search_text_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);
