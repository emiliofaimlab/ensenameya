-- ============================================================================
-- Enséñame Ya — EY-109 (cierre): que "programacion" encuentre "programar".
--
-- Tras la rama sin acentos (`20260727120000`) quedaba UN caso: teclear sin
-- tilde una palabra cuya coincidencia depende del **stemmer**.
--
--   doc "Aprende a programar…"                     → stem `program`
--   consulta "programación"  → stem `program`       ✅
--   consulta "programacion"  → stem distinto        ❌  (Snowball ES necesita la tilde)
--   consulta "programacion"  ⊄ "programar"          ❌  (tampoco es subcadena)
--
-- Ni el índice ni el `ilike` lo resuelven: hace falta **similitud por palabra**.
-- `<%` (word_similarity de pg_trgm) compara el término contra la mejor porción
-- del texto, así que "programacion" ~ "programar" por su raíz común.
--
-- Devuelve solo IDs a propósito: la fila completa la sigue leyendo el cliente
-- con su `select`, y la función es **SECURITY INVOKER** (por defecto), así que
-- la RLS de `products` sigue mandando — no se expone nada que el visitante no
-- pudiera ver ya.
-- ============================================================================

create or replace function public.search_product_ids_fuzzy(
  p_q     text,
  p_limit int default 12
)
returns table (id uuid)
language sql
stable
-- Ojo: `search_path = ''` NO sirve aquí — `word_similarity` y el operador `<%`
-- viven en el esquema de extensiones y quedarían sin resolver. Se acota a
-- public+extensions y las tablas se siguen citando con `public.`.
set search_path = public, extensions
as $$
  select p.id
  from public.products p
  where p.status = 'active'
    and length(btrim(p_q)) >= 4                    -- evita ruido con 1-3 letras
    and public.f_unaccent(p_q) <% p.search_text
  order by word_similarity(public.f_unaccent(p_q), p.search_text) desc
  limit p_limit;
$$;

grant execute on function public.search_product_ids_fuzzy(text, int) to anon, authenticated;
