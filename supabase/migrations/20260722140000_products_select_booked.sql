-- ============================================================================
-- El alumno pierde el título del producto que YA COMPRÓ. Doc 3 §RLS, RN-24.
--
-- `products` tenía tres políticas de SELECT:
--   products_select_public → status = 'active' AND tutor approved  (RN-24)
--   products_select_own    → el tutor dueño
--   products_select_admin  → admin
--
-- Falta el comprador. En cuanto el tutor pausa o archiva un producto —o su
-- aprobación cambia—, el alumno con una reserva sobre él deja de poder leer la
-- fila, y la UI cae a su texto de reserva ("Producto" / "Clase"). Medido en dev
-- con la cuenta de alumno: 4 de 8 reservas sin título, y el chat de la reserva
-- sin encabezado.
--
-- No es cosmético: es el historial de compras. El alumno pagó por eso y tiene
-- que poder ver qué compró, en la lista, en el detalle, en el chat y en la sala.
--
-- RN-24 (qué se ve en el CATÁLOGO PÚBLICO) no se toca: esta política no expone
-- nada a `anon` ni a terceros; solo al alumno de esa reserva concreta.
--
-- Sin recursión: `bookings` es la tabla consultada y sus políticas filtran por
-- `student_id`, sin volver a mirar `products`.
-- ============================================================================

drop policy if exists "products_select_booked" on public.products;

create policy "products_select_booked"
  on public.products for select
  using (
    exists (
      select 1
      from public.bookings b
      where b.product_id = products.id
        and b.student_id = (select auth.uid())
    )
  );

-- Las categorías del producto siguen el mismo criterio: si el alumno puede leer
-- el producto de su reserva, debe poder leer sus categorías (el detalle las
-- pinta como badges).
drop policy if exists "product_categories_select_booked" on public.product_categories;

create policy "product_categories_select_booked"
  on public.product_categories for select
  using (
    exists (
      select 1
      from public.bookings b
      where b.product_id = product_categories.product_id
        and b.student_id = (select auth.uid())
    )
  );
