-- ============================================================================
-- Enséñame Ya — Lote 8 del sondeo de grupales: checkout, regalo y su reserva
-- (`docs/SONDEO-GRUPALES-LOTES.md`, «Lote 8 · Alumno: checkout, regalo y su
-- reserva»)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- · M4  · con el último cupo solo APARTADO (un pago en curso, `pending_payment`)
--         los demás veían «Clase completa», igual que con la clase llena de
--         verdad. `cupos_libres` ya descuenta el hold —y está bien: ese cupo no
--         se puede vender dos veces—, pero la pantalla no tenía cómo distinguir
--         «llena» de «alguien está terminando de pagar». La RLS de `bookings`
--         esconde los holds de otros alumnos, así que el número lo tiene que
--         dar una función SECURITY DEFINER: `cupos_apartados()`, que solo
--         devuelve cuántos, nunca de quién.
--         «Llena por un pago en curso» = cupos_libres = 0 y cupos_apartados > 0.
--         La otra mitad de M4 (que quien apartó el cupo vea SU reserva viva al
--         recargar) es de pantalla: la RLS ya le deja leer su propio booking.
--
-- ── QUÉ VERSIÓN REEMPLAZA CADA COSA ────────────────────────────────────────
-- (Comprobado contra el cuerpo vivo en dev el 17-oct: la vista viva coincide
-- con 20261017160000, así que no hay cambios de la otra rama que combinar.)
-- · cupos_apartados .............. NUEVA (misma forma que cupos_libres,
--                                  20261009210000)
-- · group_classes_public ......... 20261017160000:93   (+ 1 columna al final)
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · La columna va AL FINAL, después de `inscritos_pagados`: `create or replace
--   view` no puede quitar ni reordenar columnas, y así conserva los grants.
-- · Ninguna firma existente cambia (regla de oro 12 no aplica).
-- · No se toca ninguna tabla ni ningún cron.
-- ============================================================================


-- ── 0 · cupos_apartados (M4) ────────────────────────────────────────────────
create or replace function public.cupos_apartados(p_product uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.bookings b
           where b.product_id = p.id
             and b.status = 'pending_payment')::int
    from public.products p
   where p.id = p_product and p.pricing_model = 'group'
$$;

comment on function public.cupos_apartados(uuid) is
  'M4 · cupos de una grupal retenidos por un pago en curso (pending_payment). cupos_libres ya los descuenta; esto solo permite decir «alguien está terminando de pagar». Solo devuelve el número.';

revoke execute on function public.cupos_apartados(uuid) from public;
grant  execute on function public.cupos_apartados(uuid) to anon, authenticated, service_role;


-- ── 1 · group_classes_public gana cupos_apartados (al final) ────────────────
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
         p.title,
         p.inscripcion_cierra_at,
         p.min_seats,
         public.inscritos_pagados(g.product_id) as inscritos_pagados,
         public.cupos_apartados(g.product_id) as cupos_apartados
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.status = 'scheduled';

comment on view public.group_classes_public is
  'G2 · lo que el catálogo enseña de una clase grupal: sus fechas pendientes, el cupo y cuántos quedan. security_invoker: hereda la RLS de group_classes y products. Lote 6 · M17: cupos_libres DESCUENTA los holds en curso (un pago abierto ocupa su cupo); inscritos_pagados son SOLO los pagados (confirmed | in_progress). «+N pagando» = capacity − cupos_libres − inscritos_pagados. Lote 8 · M4: cupos_apartados son los pagos en curso (pending_payment), sin decir de quién; «llena por un pago en curso» = cupos_libres = 0 y cupos_apartados > 0.';

grant select on public.group_classes_public to anon, authenticated;
