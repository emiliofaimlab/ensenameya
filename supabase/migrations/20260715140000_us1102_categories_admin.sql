-- ============================================================================
-- Enséñame Ya — US-1102 (SCR-AD11): el admin gestiona las categorías.
-- CRUD con `slug` único; categorías PLANAS (S-13: sin jerarquía, no hay
-- parent_id y no se añade).
--
-- Aquí NO hacen falta RPC: no hay dinero ni roles de por medio (regla de oro 2
-- y S-15 no aplican), así que basta RLS + grants, que es para lo que está.
-- La lectura pública (`is_active`) y la del admin ya existen desde EP-03.
--
-- Baja lógica (AC): una categoría CON productos no se borra, se desactiva.
-- Esto no es cosmética: `product_categories.category_id` tiene
-- `on delete cascade`, así que un DELETE hoy borraría en silencio los enlaces
-- de todos sus productos y los dejaría sin categoría (RN-09). El guard vive en
-- BD porque la protección no puede depender de que la UI se acuerde.
-- ============================================================================

-- ── Escritura del admin (RLS decide; el grant solo deja llegar a la tabla) ───
create policy "categories_insert_admin"
  on public.categories for insert
  with check ( public.has_role('admin') );

create policy "categories_update_admin"
  on public.categories for update
  using ( public.has_role('admin') )
  with check ( public.has_role('admin') );

create policy "categories_delete_admin"
  on public.categories for delete
  using ( public.has_role('admin') );

grant insert, update, delete on public.categories to authenticated;

-- ── Guard de borrado: con productos asociados → baja lógica ─────────────────
create or replace function public.categories_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.product_categories pc
   where pc.category_id = old.id;

  if v_count > 0 then
    raise exception
      'La categoría tiene % producto(s) asociado(s). Desactívala en vez de borrarla.', v_count
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

create trigger categories_delete_guard
  before delete on public.categories
  for each row execute function public.categories_delete_guard();
