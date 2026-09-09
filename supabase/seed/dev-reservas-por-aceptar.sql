-- Dos reservas «por aceptar» para la tutora de pruebas (Valentina Ríos).
--
-- ⚠️ POR QUÉ HACE FALTA ESTE FICHERO. En dev NO existe ni una sola reserva en
-- `pending_acceptance`: `select status, count(*) from bookings` da 81
-- completadas, 72 canceladas y 3 confirmadas, y nada más. O sea que **el bloque
-- más importante del panel del tutor no se puede ver**: «Por aceptar» de
-- Reservas, «Por atender» del dashboard, la cuenta atrás de 24 h (RN-38), los
-- contadores del menú y el aviso NTF-07 se prueban todos contra una lista vacía.
--
-- El propio `dev-poblar.sql` ya avisaba de esto ("sin `auto` … en dev NO EXISTE
-- ninguna reserva `pending_acceptance`") y repartía `auto_accept_bookings` para
-- evitarlo; hoy las tres mentorías de Valentina están en automático, así que el
-- reparto se perdió por el camino. Esto lo repone sin volver a sembrar dev
-- entero.
--
-- Se escribe en `bookings` con SQL igual que hace `dev-poblar.sql`: es la
-- práctica de siembra del repo. La regla de oro 2 («el dinero es server-side»)
-- habla de que la APP no escriba dinero desde el cliente, no de la siembra de
-- un entorno de pruebas.
--
-- ⚠️ **A propósito NO se crea fila en `payments`.** En el flujo real una reserva
-- llega a `pending_acceptance` ya pagada, pero aquí solo hacen falta los datos
-- que pinta la interfaz (título, alumno, fecha, importe), y una fila de pago
-- movería el saldo del tutor justo en la pantalla de «Mis pagos», que es otra de
-- las que se está revisando. Si algún día hace falta ejercitar el cobro o el
-- reembolso de estas dos, la fila de pago se añade entonces y con su importe.
--
-- Uso:  npx supabase db query --linked --file supabase/seed/dev-reservas-por-aceptar.sql
--       (con `--file`, no pegando el SQL: el CLI toma los comentarios `--` por flags)
-- Es idempotente (`on conflict do nothing`), así que se puede repetir.

-- Las dos mentorías de Valentina que se reservan pasan a aceptación MANUAL: sin
-- eso, `create_booking` las confirmaría solas y la reserva no se quedaría
-- esperando (M-02).
update public.products
   set auto_accept_bookings = false
 where id in (
   '22222222-0000-4000-8000-000000000001',  -- Álgebra y Cálculo desde cero
   'b8fb0862-72ef-4610-b3e6-149373b8133d'   -- Química Orgánica e Intermedia
 );

insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount,
  tier_split_pct, payee_country, created_at, updated_at
) values
  -- Recién llegada: le quedan ~21 h de las 24 (píldora negra).
  ('66666666-0000-4000-8000-000000000001',
   '44444444-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001',
   'pending_acceptance', 'per_session', 1, 60, 'USD', 2500, 2500,
   75.00, 'VE', now() - interval '3 hours', now() - interval '3 hours'),
  -- Casi vencida: le quedan ~3 h, que es cuando la píldora se pone ROJA
  -- (G-05: roja por debajo de 12 h). Sin una de éstas, el estado urgente del
  -- diseño no se puede mirar.
  ('66666666-0000-4000-8000-000000000002',
   '44444444-0000-4000-8000-000000000002',
   'b8fb0862-72ef-4610-b3e6-149373b8133d',
   '11111111-0000-4000-8000-000000000001',
   'pending_acceptance', 'per_session', 1, 55, 'USD', 3500, 3500,
   75.00, 'VE', now() - interval '21 hours', now() - interval '21 hours')
on conflict (id) do nothing;

-- Su sesión, en el futuro: una reserva por aceptar cuya clase ya pasó no existe
-- (el cron la cancela), y con la fecha en pasado la fila se leería como un error.
insert into public.sessions (
  id, booking_id, tutor_id, student_id, start_at, end_at, status,
  access_opens_at, access_closes_at
) values
  ('77777777-0000-4000-8000-000000000001',
   '66666666-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001',
   '44444444-0000-4000-8000-000000000001',
   date_trunc('hour', now()) + interval '3 days 2 hours',
   date_trunc('hour', now()) + interval '3 days 3 hours',
   'scheduled',
   date_trunc('hour', now()) + interval '3 days 1 hour 50 minutes',
   date_trunc('hour', now()) + interval '3 days 3 hours 30 minutes'),
  ('77777777-0000-4000-8000-000000000002',
   '66666666-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000001',
   '44444444-0000-4000-8000-000000000002',
   date_trunc('hour', now()) + interval '4 days 5 hours',
   date_trunc('hour', now()) + interval '4 days 5 hours 55 minutes',
   'scheduled',
   date_trunc('hour', now()) + interval '4 days 4 hours 50 minutes',
   date_trunc('hour', now()) + interval '4 days 6 hours 25 minutes')
on conflict (id) do nothing;
