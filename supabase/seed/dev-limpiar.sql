-- ============================================================================
-- Enséñame Ya — LIMPIAR DEV.  ⚠️⚠️  DESTRUCTIVO Y SOLO DEV.  ⚠️⚠️
--
-- Borra TODAS las cuentas de dev menos el admin, y con ellas todo lo que
-- cuelga: perfiles de tutor, mentorías, disponibilidad, reservas, sesiones,
-- pagos, reseñas, mensajes, documentos de KYC, notificaciones y ficheros.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  NO ES REEJECUTABLE COMO RUTINA. Se corre a mano, una vez, a propósito.   │
-- │  Vive SEPARADO de `dev-poblar.sql` justamente por eso: el seed sí se      │
-- │  reejecuta, y un `delete` escondido dentro de un script que corres cada   │
-- │  mes para refrescar el catálogo se llevaría por delante todo lo que       │
-- │  hubieras creado desde la última vez.                                     │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Contexto: a 2026-08-10 dev arrastraba 49 cuentas de semanas de pruebas —los
-- 3 tutores demo sin contraseña, los 3 alumnos de reseñas, las tandas de
-- `jose@profesorN` y `johndoe@*`, los restos de la verificación de referidos—
-- y ninguna servía para probar el flujo real.
--
-- Cómo aplicarlo: pegarlo ENTERO en el SQL Editor de Supabase (dev), con el
-- rol `postgres`. Después, `dev-poblar.sql`.
-- ============================================================================

begin;

-- Lo único que sobrevive. Sin un admin sembrado nadie puede aprobar a nadie
-- (`admin-bootstrap.sql`: huevo y gallina), así que esta cuenta no se toca.
create temporary table _conservar (id uuid primary key) on commit drop;
insert into _conservar values
  ('29b69342-1c39-4eff-9606-30840e0b3020');   -- admin.us1101@ensenameya.dev

-- El "antes" se guarda en vez de mostrarse: el SQL Editor solo enseña el
-- resultado de la ÚLTIMA consulta, así que si se imprime aquí se pierde. Al
-- final se sacan las dos filas juntas y se ve de un vistazo qué se llevó.
create temporary table _conteo (
  momento text, usuarios int, perfiles int, t_perfiles int, mentorias int,
  dispo int, reservas int, sesiones int, pagos int, resenas int, mensajes int,
  notifs int, ficheros int, categorias int, tiers int, rutas_pago int
) on commit drop;

insert into _conteo
select 'antes',
       (select count(*) from auth.users),
       (select count(*) from public.profiles),
       (select count(*) from public.tutor_profiles),
       (select count(*) from public.products),
       (select count(*) from public.availability_rules),
       (select count(*) from public.bookings),
       (select count(*) from public.sessions),
       (select count(*) from public.payments),
       (select count(*) from public.reviews),
       (select count(*) from public.messages),
       (select count(*) from public.notifications),
       (select count(*) from storage.objects),
       (select count(*) from public.categories),
       (select count(*) from public.tutor_tiers),
       (select count(*) from public.payment_routing_rules);


-- ── 1 · Vaciar los datos, con TRUNCATE y no con DELETE ─────────────────────
-- El primer intento fue `delete from bookings` y falló:
--     violates foreign key constraint "payout_items_payment_id_fkey"
-- No todos los FK cascadean —`bookings.product_id → products` es RESTRICT,
-- `payout_items.payment_id → payments` también— y averiguarlos uno a uno es
-- jugar al whack-a-mole: cada error revela el siguiente.
--
-- `TRUNCATE … CASCADE` no juega a eso: vacía la tabla y, recursivamente, TODAS
-- las que la referencian, **sin mirar el ON DELETE de cada FK**. Una sentencia
-- y la clase entera del problema desaparece. Además es transaccional, así que
-- sigue dentro del begin/commit y se revierte igual si algo peta después.
--
-- Lo que NO está en esta lista, y por qué:
--   · profiles / user_roles → el admin tiene que sobrevivir con su rol.
--   · categories / tutor_tiers / payment_routing_rules → datos de referencia
--     que llegan por migración. Sin el tier por defecto y sin la ruta de pago,
--     `create_booking` deja de funcionar y el seed siguiente no arranca.
--
-- El CASCADE se encarga solo de sessions, payments, payout_items, reviews,
-- messages, product_categories y payment_webhook_events.
truncate
  public.bookings,
  public.products,
  public.payouts,
  public.tutor_profiles,
  public.availability_rules,
  public.availability_exceptions,
  public.tutor_categories,
  public.tutor_materials,
  public.student_interests,
  public.verification_documents,
  public.notifications,
  public.payment_methods,
  public.session_recording_consents,
  public.alert_acks
cascade;


-- ── 2 · Las cuentas ─────────────────────────────────────────────────────────
-- Ya no queda nada colgando de `profiles`, así que aquí no hay FK que pueda
-- bloquear: solo cascadean `profiles` y `user_roles`, ambos ON DELETE CASCADE.
delete from auth.users u
 where not exists (select 1 from _conservar c where c.id = u.id);


-- ── 3 · Los ficheros NO se borran aquí ─────────────────────────────────────
-- Aquí había un `delete from storage.objects` y Supabase lo rechaza:
--     42501: Direct deletion from storage tables is not allowed.
--            Use the Storage API instead.   (trigger storage.protect_delete)
-- Y tiene razón: borrar la fila dejaría el blob en el bucket para siempre,
-- pagándolo y sin nada que lo referencie. Solo la API de Storage borra las dos
-- cosas a la vez.
--
-- Encima `storage.objects.owner` no tiene FK a `auth.users` (Supabase la
-- quitó), así que los ficheros tampoco se van con su dueño: sobreviven con un
-- owner que ya no existe.
--
-- → La limpieza de Storage va por separado, con `service_role` contra la API.
--   No bloquea nada: son ficheros huérfanos que ya no referencia ninguna fila
--   (los `avatar_path` e `image_path` que los apuntaban se fueron en el paso 1).
--   El conteo de abajo los sigue mostrando a propósito, para saber cuántos son.


-- ── 4 · Comprobación ────────────────────────────────────────────────────────
-- Se espera: usuarios=1, perfiles=1, y en 0 todo lo demás …
--   · salvo `ficheros`, que no baja (ver paso 3: los borra la API, no el SQL);
--   · y salvo las tres últimas. `categorias`, `tiers` y `rutas_pago` son datos
--     de referencia que llegan por migración, no fixtures: tienen que seguir en
--     10, 3 y 1. Si alguna sale en 0 esto se pasó de frenada y `dev-poblar.sql`
--     fallará después al buscar el tier por defecto.

insert into _conteo
select 'despues',
       (select count(*) from auth.users),
       (select count(*) from public.profiles),
       (select count(*) from public.tutor_profiles),
       (select count(*) from public.products),
       (select count(*) from public.availability_rules),
       (select count(*) from public.bookings),
       (select count(*) from public.sessions),
       (select count(*) from public.payments),
       (select count(*) from public.reviews),
       (select count(*) from public.messages),
       (select count(*) from public.notifications),
       (select count(*) from storage.objects),
       (select count(*) from public.categories),
       (select count(*) from public.tutor_tiers),
       (select count(*) from public.payment_routing_rules);

select * from _conteo order by momento desc;   -- 'antes' primero

commit;
