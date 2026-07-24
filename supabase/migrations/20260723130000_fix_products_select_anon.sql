-- ============================================================================
-- 🐞 El catálogo público de productos devolvía CERO filas a los visitantes sin
-- sesión. Refs: la migración 20260722140000_products_select_booked.
--
-- Aquella política añadió, para que el alumno no perdiera el título de lo que
-- ya compró:
--
--   create policy "products_select_booked" on public.products for select
--     using ( exists (select 1 from public.bookings b where ...) );
--
-- Sin `to authenticated`, la política se aplica a TODOS los roles, incluido
-- `anon` — y `anon` no tiene grant sobre `bookings`. Postgres evalúa las
-- políticas con los permisos del rol que consulta, así que cualquier SELECT de
-- `anon` sobre `products` moría con:
--
--   permission denied for table bookings
--
-- Resultado: home ("Tutorías destacadas"), /classes, /search, /categories/[slug]
-- y el detalle de producto salían vacíos para quien no había iniciado sesión.
-- Con sesión funcionaba, que es por lo que pasó desapercibido.
--
-- El arreglo es acotar la política al rol al que iba dirigida desde el primer
-- día: solo un usuario autenticado puede tener reservas. `products_select_public`
-- (RN-24) sigue siendo la que sirve al público y no cambia.
-- ============================================================================

drop policy if exists "products_select_booked" on public.products;

create policy "products_select_booked"
  on public.products for select
  to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      where b.product_id = products.id
        and b.student_id = (select auth.uid())
    )
  );

drop policy if exists "product_categories_select_booked" on public.product_categories;

create policy "product_categories_select_booked"
  on public.product_categories for select
  to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      where b.product_id = product_categories.product_id
        and b.student_id = (select auth.uid())
    )
  );
