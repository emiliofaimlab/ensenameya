-- ============================================================================
-- EY-109 (corrección de 20260721120000) — el vector guarda AMBAS formas.
--
-- La migración anterior construía el tsvector sobre el texto ya sin acentos, y
-- el cliente normalizaba también el término. Eso arreglaba las tildes pero
-- **rompía el stemmer español**: sus reglas de sufijo (`-ción`, `-ciones`…)
-- necesitan el acento. Efecto medido: "Programación" dejaba de encontrar un
-- producto cuya descripción dice "primeros programas" — antes casaban porque
-- ambos reducen a la raíz `program`.
--
-- Solución: indexar las dos ramas en el mismo vector.
--   · rama con acentos  → conserva el stemmer intacto (programación → program)
--   · rama sin acentos  → permite teclear sin tildes (matematicas ≡ Matemáticas)
--
-- El cliente consulta con el término tal cual y, si difiere, también sin
-- acentos, y une los resultados (`searchProducts`). Cada rama casa con la suya.
--
-- Limitación conocida y aceptada: la equivalencia entre palabras DISTINTAS que
-- comparten raíz ("programación" ↔ "programas") solo funciona escribiendo la
-- tilde, porque sin ella el stemmer no reduce. La misma palabra escrita de las
-- dos formas sí es equivalente, que es lo que pedía el bug.
-- ============================================================================

alter table public.products drop column if exists search_vector;

alter table public.products
  add column search_vector tsvector
  generated always as (
    to_tsvector(
      'spanish',
      coalesce(title, '') || ' ' || coalesce(description, '')
    )
    ||
    to_tsvector(
      'spanish',
      public.f_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))
    )
  ) stored;

create index products_search_idx on public.products using gin (search_vector);

-- `tutor_profiles.search_text` se queda como está: los `ilike` no pasan por el
-- stemmer, así que ahí quitar acentos en ambos lados es exactamente correcto.
