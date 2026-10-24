-- ============================================================================
-- Enséñame Ya — group_classes_public gana tutor_id y title (G1)
--
-- El panel del tutor (`/tutor`) pinta sus próximas fechas grupales con
-- «N/M inscritos», y para eso necesita filtrar la vista por tutor: tal como
-- nació (`20261009210000`) devolvía todas las clases públicas de todos los
-- tutores. El título va también porque el panel y el catálogo (G2) lo pintan
-- al lado de la fecha, y así no hace falta un embed sobre una vista.
--
-- Las dos columnas ya eran públicas (products.title y el tutor de una clase
-- visible), así que la vista no enseña nada que no se viera. Van AL FINAL:
-- `create or replace view` solo admite añadir columnas detrás.
-- ============================================================================

create or replace view public.group_classes_public
with (security_invoker = true) as
  select g.id,
         g.product_id,
         g.sequence_no,
         g.start_at,
         g.end_at,
         p.capacity,
         public.cupos_libres(g.product_id) as cupos_libres,
         g.tutor_id,
         p.title
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.status = 'scheduled';
