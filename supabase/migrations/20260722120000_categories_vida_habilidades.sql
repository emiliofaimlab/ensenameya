-- ============================================================================
-- Dos categorías que faltaban — Doc 1 §categories, S-13 (categorías planas).
--
-- Pedidas por diseño en tres comentarios del Figma (2026-07-22, #31/#32/#33):
-- aparecen en los chips del hero de P01, P02 y P06.
--
-- `sort_order` 90 y 100 para que queden al final de las 8 existentes.
-- Sin cambios de RLS ni grants: la tabla ya es de lectura pública (EP-03).
-- Idempotente por `slug` único.
-- ============================================================================

insert into public.categories (name, slug, sort_order) values
  ('Vida y creatividad',        'vida-y-creatividad',        90),
  ('Habilidades profesionales', 'habilidades-profesionales', 100)
on conflict (slug) do nothing;
