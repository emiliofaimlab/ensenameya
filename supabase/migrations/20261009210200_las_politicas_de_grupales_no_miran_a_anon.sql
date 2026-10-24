-- ============================================================================
-- Enséñame Ya — las políticas privadas de group_classes, solo para authenticated
--
-- Arreglo encontrado al probar `group_classes_public` como `anon`
-- (`20261009210000`): la vista respondía «permission denied for table
-- sessions». `group_classes_select_inscrito` (`20261008120100`) se creó SIN
-- `to authenticated`, así que Postgres la evalúa también para `anon`, y `anon`
-- no tiene grant sobre `sessions`. Una sola política así tumba la consulta
-- ENTERA, no solo esa rama: el catálogo de grupales salía roto para cualquier
-- visitante sin sesión.
--
-- Es exactamente la trampa que documenta `20260723130000` con
-- `products_select_booked`. Las tres políticas que solo sirven a usuarios con
-- sesión (tutor, inscrito, admin) pasan a `to authenticated`; la pública
-- (`group_classes_select_publica`) se queda para todos.
-- ============================================================================

drop policy if exists "group_classes_select_tutor" on public.group_classes;
create policy "group_classes_select_tutor"
  on public.group_classes for select to authenticated
  using ( (select auth.uid()) = tutor_id );

drop policy if exists "group_classes_select_inscrito" on public.group_classes;
create policy "group_classes_select_inscrito"
  on public.group_classes for select to authenticated
  using ( exists (
    select 1 from public.sessions s
     where s.group_class_id = group_classes.id
       and s.student_id = (select auth.uid())
       and s.status not in ('cancelled', 'no_show')
  ) );

drop policy if exists "group_classes_select_admin" on public.group_classes;
create policy "group_classes_select_admin"
  on public.group_classes for select to authenticated
  using ( public.has_role('admin') );
