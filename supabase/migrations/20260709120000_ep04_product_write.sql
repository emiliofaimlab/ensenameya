-- ============================================================================
-- Enséñame Ya — EP-04 (S2): escritura del catálogo del tutor.
-- La LECTURA pública ya vive en EP-03 (20260706120000). Este slice abre la
-- ESCRITURA: el tutor administra SUS productos y sus categorías (RLS por tutor_id).
--   · US-401 crear/editar productos → guarda como 'draft'.
--   · US-402 publicar/pausar/archivar → mueve `status`; publicar exige aprobación.
--
-- Guard RN-23/RN-24: un producto solo puede quedar 'active' si su tutor está
-- aprobado. Lo fuerza un trigger controlado (no el cliente): aunque un tutor sin
-- aprobar intente publicar por la API directa, se rechaza. (La lectura pública ya
-- exige `approval_status='approved'`, así que la visibilidad es segura por partida
-- doble.)
--
-- Anti-escalada (US-1403): el tutor solo toca SUS filas (tutor_id = uid, forzado
-- por WITH CHECK). Todas las columnas de `products` son contenido propio del tutor
-- → grant de tabla completo; `search_vector` es generada (no escribible) y la
-- moderación admin (forzar pausa) llega en EP-11 (S3).
-- ============================================================================

-- ── Guard RN-23: publicar exige tutor aprobado ───────────────────────────────
create or replace function public.enforce_product_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and not exists (
       select 1
       from public.tutor_profiles tp
       where tp.profile_id = new.tutor_id
         and tp.approval_status = 'approved'
     )
  then
    raise exception 'RN-23: solo un tutor aprobado puede publicar productos'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger products_publish_guard
  before insert or update on public.products
  for each row execute function public.enforce_product_publish_guard();

-- ── RLS de escritura: el tutor administra SUS productos ───────────────────────
create policy "products_insert_own"
  on public.products for insert to authenticated
  with check ( (select auth.uid()) = tutor_id );
create policy "products_update_own"
  on public.products for update to authenticated
  using ( (select auth.uid()) = tutor_id )
  with check ( (select auth.uid()) = tutor_id );
create policy "products_delete_own"
  on public.products for delete to authenticated
  using ( (select auth.uid()) = tutor_id );

-- product_categories: el tutor gestiona las de SUS productos (RN-09).
create policy "product_categories_write_own"
  on public.product_categories for all to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_categories.product_id
        and p.tutor_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_categories.product_id
        and p.tutor_id = (select auth.uid())
    )
  );

-- ── Grants de la Data API (auto-expose OFF). La lectura ya se otorgó en EP-03. ─
grant insert, update, delete on public.products           to authenticated;
grant insert, delete         on public.product_categories to authenticated;
