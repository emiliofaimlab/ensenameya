-- ============================================================================
-- EY-109 — Buscar sin tildes devolvía cero resultados. Doc 1 §products, RN-20.
--
-- `to_tsvector('spanish', …)` aplica el stemmer español pero NO quita acentos,
-- y `ilike` tampoco. En español la gente teclea sin tildes, así que:
--   "matematicas"  → 0 resultados   vs  "Matemáticas"  → 4
--   "programacion" → 0 resultados   vs  "Programación" → 6
--
-- Se normaliza el lado ALMACENADO. El término de búsqueda se normaliza en el
-- cliente (`stripAccents` en src/lib/catalog/queries.ts): así da igual cómo lo
-- escriba el usuario, ambos lados llegan sin acentos.
--
-- Sin cambios de RLS ni de grants: no hay tablas nuevas y los `grant select`
-- de `products` y `tutor_profiles` son a nivel de tabla, así que las columnas
-- nuevas quedan cubiertas.
-- ============================================================================

create extension if not exists unaccent with schema extensions;

-- `unaccent(text)` es STABLE (depende del diccionario por defecto), y una
-- columna generada exige IMMUTABLE. Pasar el diccionario explícitamente lo
-- vuelve determinista, que es el motivo de este envoltorio.
create or replace function public.f_unaccent(text)
  returns text
  language sql
  immutable
  parallel safe
  strict
  set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- ── products: regenerar el tsvector sin acentos ──────────────────────────────
-- Al soltar la columna generada se va con ella su índice GIN; se recrea abajo.
alter table public.products drop column if exists search_vector;

alter table public.products
  add column search_vector tsvector
  generated always as (
    to_tsvector(
      'spanish',
      public.f_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))
    )
  ) stored;

create index products_search_idx on public.products using gin (search_vector);

-- ── tutor_profiles: texto de búsqueda sin acentos para los `ilike` ───────────
-- `headline` + `bio` en una sola columna generada. El cliente hace
-- `ilike '%termino%'` contra ella con el término ya normalizado.
alter table public.tutor_profiles
  add column if not exists search_text text
  generated always as (
    public.f_unaccent(coalesce(headline, '') || ' ' || coalesce(bio, ''))
  ) stored;

-- ponytail: sin índice sobre `search_text`. Un `ilike '%x%'` no usa B-tree y
-- hoy hay una docena de tutores: el seq scan sobra. Cuando el catálogo crezca,
-- el arreglo es `pg_trgm` + índice GIN sobre esta misma columna.

-- Nota: `categories` no necesita nada. Son 8 filas que el frontend ya trae
-- enteras para pintar los chips; el filtrado por nombre se hace en memoria.
