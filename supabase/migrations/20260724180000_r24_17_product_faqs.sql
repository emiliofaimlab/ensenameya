-- ============================================================================
-- Enséñame Ya — R24-17 (reunión 24-jul): FAQ por MENTORÍA (no de plataforma).
--
-- El tutor define las preguntas frecuentes de SU oferta al crearla/editarla,
-- en vez de mostrar siempre las genéricas de la plataforma. Se guardan como
-- jsonb en el propio producto: `[{ "q": "...", "a": "..." }, ...]`.
--
-- Sin tabla ni RLS nuevas: `products` ya tiene grant de escritura del tutor
-- (table-level, acotado por `products_write_own`) y lectura pública (EP-03),
-- así que la nueva columna queda cubierta por ambos.
-- ============================================================================

alter table public.products
  add column if not exists faqs jsonb not null default '[]'::jsonb;
