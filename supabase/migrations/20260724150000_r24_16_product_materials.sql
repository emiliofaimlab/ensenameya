-- ============================================================================
-- Enséñame Ya — R24-16 (reunión 24-jul): materiales de clase por PRODUCTO.
--
-- Los materiales se movieron del onboarding a la creación/edición de la oferta,
-- así que dejan de ser del tutor "en general" y pasan a colgar de un producto.
-- `product_id` es NULLABLE: las filas viejas (subidas en el onboarding) se
-- quedan sin producto y simplemente no aparecen en ninguna ficha de oferta.
--
-- RLS intacta (sigue siendo `auth.uid() = tutor_id`). Solo se abre `product_id`
-- en el column-grant de INSERT para que el tutor lo escriba al subir.
-- ============================================================================

alter table public.tutor_materials
  add column if not exists product_id uuid
    references public.products (id) on delete cascade;

create index if not exists tutor_materials_product_id_idx
  on public.tutor_materials (product_id);

-- El tutor ya podía insertar tutor_id/storage_path/file_name/size_bytes; ahora
-- también product_id (grant aditivo por columna).
grant insert (product_id) on public.tutor_materials to authenticated;
