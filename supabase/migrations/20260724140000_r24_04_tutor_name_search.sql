-- ============================================================================
-- Enséñame Ya — R24-04 (reunión 24-jul): buscar tutores por NOMBRE.
--
-- BUG: `tutor_profiles.search_text` (la columna sin acentos contra la que corre
-- el `ilike` de `searchTutors`) se generaba solo de `headline + bio`. Buscar el
-- nombre de un tutor ("Emilio", "Ana Torres") no devolvía nada, aunque el
-- usuario espera encontrar a la persona.
--
-- Arreglo: incluir `display_name` (el nombre público del tutor, DD-01) en la
-- expresión generada. Es columna GENERATED: PG no deja cambiar la expresión
-- in-place, así que se dropea y se recrea (se regenera sola, sin datos que
-- perder). El grant de SELECT es table-wide (`ep03_catalog`), así que la nueva
-- columna queda expuesta igual que la anterior; no hace falta re-grant.
-- ============================================================================

alter table public.tutor_profiles drop column if exists search_text;

alter table public.tutor_profiles
  add column search_text text
  generated always as (
    public.f_unaccent(
      coalesce(display_name, '') || ' ' ||
      coalesce(headline, '')     || ' ' ||
      coalesce(bio, '')
    )
  ) stored;
