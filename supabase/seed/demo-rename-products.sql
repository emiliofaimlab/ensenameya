-- Demo: renombra los productos de prueba del tutor de demo.
--
-- Problema: siete productos suyos se llaman "Payout test", "Sala EP-08
-- (fixture)", "Clase en vivo de prueba"… Están ARCHIVADOS, así que no salen en
-- el catálogo público, pero sus títulos siguen apareciendo en cualquier lista
-- que muestre reservas (paneles, /tutor/reservas, panel admin): la reserva
-- guarda el product_id y la pantalla lee `products.title`. Archivar no bastó.
--
-- No se pueden borrar: `bookings.product_id` es `on delete restrict`, y con
-- razón — se llevaría por delante el historial de pagos y reseñas.
--
-- Los nombres nuevos respetan precio y duración de cada uno (30 min salvo el
-- primero) y encajan con el titular del tutor ("Profesor de Programación y
-- Algoritmos"), para que la fila se lea como una clase real.
--
-- Ejecutar en el SQL Editor de Supabase (dev). Reejecutable: fija por id.

update public.products as p
   set title = v.title
  from (values
    -- id                                        título nuevo                        (antes)
    ('341fd29e-221a-4593-9910-20f3c734f5ab', 'Git y control de versiones'),        -- Clase Daily real
    ('51c0c996-a12e-4a7f-b774-0177c004bfe5', 'Preparación de entrevista técnica'), -- Balance test
    ('a309c740-3bcf-42ad-b423-8e01f433c622', 'Estructuras de datos en Python'),    -- Payout test
    ('6b82a32a-31b6-4131-a4b7-138779a7dcde', 'Tu primer script en Python'),        -- Clase en vivo de prueba
    ('0c4ca14b-b31d-41d1-94da-e24481bf7334', 'Leer y arreglar un error'),          -- Clase en vivo de prueba
    ('0092844a-6722-4c1a-b1c6-252625306db5', 'Bucles y condicionales'),            -- Sala futura
    ('bb19bcf8-aaa7-44d2-9ebb-304d17989df3', 'Introducción a la terminal')         -- Sala EP-08 (fixture)
  ) as v (id, title)
 where p.id = v.id::uuid;
