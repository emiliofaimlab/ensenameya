-- ============================================================================
-- Enséñame Ya · Doc 34 — TODOS LOS ESCENARIOS en las dos cuentas de Emilio.
-- ⚠️  SOLO DEV. Escribe en bookings / payments / sessions / payouts a mano,
--     que es la práctica de siembra del repo (dev-poblar.sql, dev-saldo-para-
--     payouts.sql). En producción no se ejecuta jamás.
--
-- Qué deja, en la cuenta de tutor de Emilio y en una de alumno suya:
--   §0  Las dos cuentas. La de alumno la CREA este fichero si no existe.
--   §0b Borra el seed anterior de esta cuenta (espacio ea0000xx-…), para que
--       la matriz se lea limpia y las sesiones no choquen entre sí.
--   §1  6 mentorías: una por estado (draft / active auto / active manual /
--       active paquete / paused / archived).
--   §2  Disponibilidad: 3 franjas activas, 1 apagada, excepción de día entero,
--       excepción de rango, día extra abierto, y una mentoría con franja propia.
--   §3  19 reservas: cada estado de reserva × cada estado de pago × cada estado
--       de sesión, incluidos paquete a medias y pedidos multilínea.
--   §4  4 reembolsos (uno por estado), 2 reseñas (con y sin comentario).
--   §5  6 payouts, uno por estado, y una cuenta de cobro manual.
--   §6  Conversación con mensajes sin leer y 3 notificaciones (una por estado).
--
-- Cómo aplicarlo (con --file: pegado, el CLI toma los `--` por flags):
--   npx supabase db query --linked --file docs/PROPUESTAS/34-escenarios-de-prueba/dev-escenarios-emilio.sql
--   -- o pegarlo ENTERO en el SQL Editor de Supabase (dev)
--
-- Idempotente: UUIDs fijos (espacio 88888888-00XX-…) y `on conflict`.
-- Para volver a empezar: ejecutar primero el bloque LIMPIAR del final.
--
-- ⚠️ SIN TRANSACCIÓN, a propósito (misma lección que dev-poblar.sql): en el SQL
-- Editor una transacción abortada se vuelve invisible. Así, si algo falla, el
-- editor se para en la sentencia culpable y la enseña.
--    OJO: por `db query --linked` sí es transaccional — un fallo en la última
--    sentencia tumba las 33 anteriores. Es la vía rápida; el SQL Editor es la
--    que deja ver hasta dónde llegó.
--
-- ⚠️ Se insertan las filas YA en su estado final, nunca con UPDATE posterior:
-- los triggers notify_* son AFTER UPDATE y la cola de correos ENVÍA DE VERDAD.
--
-- ── CINCO CORRECCIONES SOBRE EL BORRADOR DEL 11-sep ─────────────────────────
-- Verificadas contra dev (lbtpnszjjsxbeileqsja), no deducidas:
--   1. `messages.conversation_id` es NOT NULL. El borrador insertaba solo
--      `booking_id` → violación en seco. El hilo se BUSCA por su par.
--   2. `message_reads` NO EXISTE. La tabla es `conversation_reads`, y su clave
--      es `conversation_id`, no `booking_id`.
--   3. Los `doc_type` `id_front` / `id_back` / `selfie` NO EXISTEN desde C-14:
--      son `cv · degree · id_document · certificate · diploma · transcript`
--      (`20260715130000` borra cualquier otro). Sembrar los viejos deja tres
--      filas que el formulario del tutor no enseña y que la próxima migración
--      barre.
--   4. Las sesiones 5 y 6 SE SOLAPABAN (+5 min y −10 min, 60 min cada una).
--      El candado dejó de ser un único por `start_at` en `20260831180000`: hoy
--      es `EXCLUDE USING gist (tutor_id =, tstzrange(start_at, end_at) &&)`, y
--      compara TRAMOS. Se separan a −50 min y +10 min, pegadas y sin solape
--      (el rango es `[)`), que además deja ver los dos escenarios A LA VEZ.
--   5. La conversación con id fijo NO entraba: desde M-12 toda reserva abre su
--      hilo sola (`bookings_ensure_conversation`) con id aleatorio, así que el
--      `on conflict (student_id, tutor_id) do nothing` se la tragaba en
--      silencio... y el bloque LIMPIAR no borraba nada. Ya no se crea aquí.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 0 · LAS DOS CUENTAS  (DP-34.1 resuelta el 11-sep: José elige este par)
-- ════════════════════════════════════════════════════════════════════════════
--   tutor  → emilio@faimlab.com        (ya existe, aprobada desde el 11-sep)
--   alumno → emilio+alumno@faimlab.com (la crea este fichero si falta)
-- El `+alumno` es una dirección real: llega al mismo buzón de Emilio, así que
-- los correos de la plataforma le entran igual. Contraseña: Ensename2026!

-- El alumno, con el patrón de dev-poblar.sql. Sin `auth.identities` el usuario
-- existe, la contraseña es correcta y el login falla igual — en silencio.
create extension if not exists pgcrypto with schema extensions;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
select
  '88888888-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'emilio+alumno@faimlab.com',
  extensions.crypt('Ensename2026!', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Emilio Faim (alumno)', 'timezone', 'America/Bogota'),
  now(), now(),
  '', '', '', '', '', ''
where not exists (
  select 1 from auth.users where lower(email) = lower('emilio+alumno@faimlab.com')
);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email,
                     'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
from auth.users u
where lower(u.email) = lower('emilio+alumno@faimlab.com')
on conflict (provider_id, provider) do nothing;

drop table if exists _ey;
create temporary table _ey as
select
  (select id from auth.users where lower(email) = lower('emilio@faimlab.com'))        as tutor,
  (select id from auth.users where lower(email) = lower('emilio+alumno@faimlab.com')) as alumno;

do $$
begin
  if (select tutor from _ey) is null or (select alumno from _ey) is null then
    raise exception 'Sección 0: falta una de las dos cuentas en auth.users.';
  end if;
  if (select tutor from _ey) = (select alumno from _ey) then
    raise exception 'Sección 0: tutor y alumno tienen que ser DOS cuentas distintas (conversations exige student_id <> tutor_id).';
  end if;
end $$;

-- Zona horaria = país. El trigger de profiles deduce `payout_country` (tutor)
-- y `pais_de_cobro_por_zona` decide la pasarela del alumno (dictado 9-sep).
--   tutor  → Caracas  → VE  → payout PayPal + manual (Zelle/Zinli/Binance)
--   alumno → Bogotá   → CO  → cobro por Stripe (mig. 20260910200000)
update public.profiles set timezone = 'America/Caracas', onboarding_complete = true
 where id = (select tutor from _ey);
update public.profiles set full_name = coalesce(full_name, 'Emilio Faim (alumno)'),
       timezone = 'America/Bogota', onboarding_complete = true
 where id = (select alumno from _ey);

insert into public.user_roles (user_id, role)
select tutor, 'tutor'::public.app_role from _ey
on conflict do nothing;

-- Aprobado e identidad verificada. Si el perfil ya existe NO se tocan headline
-- ni bio (son los de Emilio); solo los estados.
insert into public.tutor_profiles (
  profile_id, display_name, headline, bio, teaching_level,
  approval_status, identity_verification_status, approved_at, tier_id
)
select
  tutor, 'Emilio Faim',
  'Cuenta de pruebas · todos los escenarios',
  'Perfil de tutor usado para probar cada estado de reserva, pago, sesión y payout.',
  'intermedio'::public.teaching_level,
  'approved'::public.tutor_approval_status,
  'approved'::public.identity_verification_status,
  now() - interval '60 days',
  (select id from public.tutor_tiers where is_default)
from _ey
on conflict (profile_id) do update set
  approval_status              = 'approved',
  identity_verification_status = 'approved',
  approved_at                  = coalesce(tutor_profiles.approved_at, excluded.approved_at),
  tier_id                      = coalesce(tutor_profiles.tier_id, excluded.tier_id);

-- ⚠️ CORRECCIÓN 3 · Los SEIS documentos de C-14, no tres inventados.
-- `id_front` / `id_back` / `selfie` no existen desde `20260715130000`, que
-- además BORRA cualquier doc_type fuera de esta lista.
insert into public.verification_documents (id, tutor_id, doc_type, storage_path, status, reviewed_at, review_notes)
select ('88888888-0012-4000-8000-00000000000' || d.n)::uuid, tutor, d.tipo,
       tutor::text || '/' || d.tipo, 'approved'::public.document_status,
       now() - interval '59 days', 'Seed Doc 34'
from _ey, (values
  (1, 'cv'), (2, 'degree'), (3, 'id_document'),
  (4, 'certificate'), (5, 'diploma'), (6, 'transcript')
) as d(n, tipo)
on conflict (tutor_id, doc_type) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 0b · BORRAR EL SEED ANTERIOR de esta cuenta (espacio ea0000xx-…)
-- ════════════════════════════════════════════════════════════════════════════
-- El seed del 11-sep dejó 20 reservas en emilio@faimlab.com. Sumarlas a las 19
-- de aquí hace ilegible la matriz y arriesga un choque con
-- `sessions_sin_solape_por_tutor`. Se va lo transaccional; se QUEDAN el rol,
-- el perfil aprobado, el KYC, la cuenta de cobro y los intereses.
-- Orden por FK: lo que apunta antes que lo apuntado.
delete from public.reviews       where id::text like 'ea000008-%';
delete from public.messages      where id::text like 'ea000007-%';
delete from public.notifications where id::text like 'ea000009-%';
delete from public.payments      where booking_id::text ~ '^ea00000[34]-';
delete from public.sessions      where id::text like 'ea000005-%';
delete from public.bookings      where id::text ~ '^ea00000[34]-';
delete from public.payouts       where id::text like 'ea000006-%';
delete from public.products      where id::text like 'ea000001-%';
delete from public.availability_rules where id::text like 'ea000002-%';
-- Los hilos que abrió el trigger de aquellas reservas quedan vacíos: fuera.
delete from public.conversations c
 where not exists (select 1 from public.messages m where m.conversation_id = c.id)
   and (c.tutor_id   = (select tutor from _ey)
     or c.student_id = (select tutor from _ey));


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · MENTORÍAS — una por estado (y una por modelo de precio)
-- ════════════════════════════════════════════════════════════════════════════
-- `session_duration_min` nunca nulo (si no, get_available_slots calla y no da
-- huecos). `auto_accept_bookings` reparte confirmación inmediata y manual.
with p(n, titulo, outcome, modelo, precio, dur, paquete, estado, auto, paso) as (values
  (1, 'Prueba · confirmación inmediata',  'reserva confirmada al pagar',
      'per_session'::public.pricing_model, 2500, 60, null::int, 'active'::public.product_status,   true,  null::int),
  (2, 'Prueba · el tutor acepta a mano',  'la reserva espera hasta 24 h',
      'per_hour'::public.pricing_model,    3000, 60, null,      'active'::public.product_status,   false, 30),
  (3, 'Prueba · paquete de 4 sesiones',   'cuatro clases en una compra',
      'per_package'::public.pricing_model, 9000, 60, 4,         'active'::public.product_status,   true,  null),
  (4, 'Prueba · en borrador',             'todavía no se publica',
      'per_session'::public.pricing_model, 2000, 45, null,      'draft'::public.product_status,    true,  null),
  (5, 'Prueba · pausada',                 'estuvo activa y se paró',
      'per_session'::public.pricing_model, 2000, 45, null,      'paused'::public.product_status,   true,  null),
  (6, 'Prueba · archivada',               'ya no se ofrece',
      'per_session'::public.pricing_model, 2000, 45, null,      'archived'::public.product_status, true,  null)
)
insert into public.products (
  id, tutor_id, title, outcome, description, pricing_model, price_amount, currency,
  session_duration_min, package_num_sessions, status, level, language,
  auto_accept_bookings, start_time_increment_min
)
select ('88888888-0001-4000-8000-00000000000' || p.n)::uuid, e.tutor, p.titulo, p.outcome,
       'Mentoría de pruebas del Doc 34. Estado: ' || p.estado || '.',
       p.modelo, p.precio, 'USD', p.dur, p.paquete, p.estado,
       'intermedio'::public.teaching_level, 'es', p.auto, p.paso
from p, _ey e
on conflict (id) do update set
  status               = excluded.status,
  auto_accept_bookings = excluded.auto_accept_bookings,
  start_time_increment_min = excluded.start_time_increment_min;

-- Categoría para que salgan en el catálogo (si la tabla de categorías está sembrada).
insert into public.product_categories (product_id, category_id)
select p.id, c.id
  from public.products p
  join public.categories c on c.slug = 'matematicas'
 where p.id::text like '88888888-0001-%'
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · DISPONIBILIDAD — franjas activas, apagada, excepciones y franja por mentoría
-- ════════════════════════════════════════════════════════════════════════════
-- weekday: 0=domingo … 6=sábado. Ventanas de 4 h: caben todas las duraciones.
insert into public.availability_rules (id, tutor_id, weekday, start_time, end_time, is_active)
select ('88888888-0002-4000-8000-00000000000' || r.n)::uuid, e.tutor, r.wd, r.ini, r.fin, r.activa
from _ey e, (values
  (1, 1, '09:00'::time, '13:00'::time, true),    -- lunes mañana
  (2, 3, '09:00'::time, '13:00'::time, true),    -- miércoles mañana
  (3, 5, '14:00'::time, '18:00'::time, true),    -- viernes tarde
  (4, 6, '10:00'::time, '12:00'::time, false)    -- sábado APAGADA (is_active = false)
) as r(n, wd, ini, fin, activa)
on conflict (id) do update set is_active = excluded.is_active;

-- Excepciones. Fechas relativas: siempre en la ventana de 21 días del buscador.
--   a) lunes que viene: BLOQUEADO día entero (sin horas)
--   b) miércoles que viene: BLOQUEADO 11:00–13:00 (rango parcial)
--   c) domingo que viene: ABIERTO 10:00–12:00 (día que normalmente no tiene franja)
insert into public.availability_exceptions (id, tutor_id, date, type, start_time, end_time, reason)
select ('88888888-0003-4000-8000-00000000000' || x.n)::uuid, e.tutor,
       current_date + ((x.wd - extract(dow from current_date)::int + 7) % 7) + 7,
       x.tipo, x.ini, x.fin, x.motivo
from _ey e, (values
  (1, 1, 'block'::public.availability_exception_type, null::time,  null::time,  'Día bloqueado entero'),
  (2, 3, 'block'::public.availability_exception_type, '11:00'::time, '13:00'::time, 'Bloqueo parcial'),
  (3, 0, 'open'::public.availability_exception_type,  '10:00'::time, '12:00'::time, 'Domingo extra abierto')
) as x(n, wd, tipo, ini, fin, motivo)
on conflict (id) do nothing;

-- La mentoría 2 (aceptación manual) SOLO se ofrece en la franja del miércoles.
insert into public.product_availability_rules (product_id, rule_id)
values ('88888888-0001-4000-8000-000000000002', '88888888-0002-4000-8000-000000000002')
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · RESERVAS — la matriz (una fila = un escenario)
-- ════════════════════════════════════════════════════════════════════════════
-- b = estado de la reserva · p = estado del pago · s = estado de la sesión
-- inicio = cuándo empieza la sesión respecto a AHORA · creada / pagada = ídem
-- pct = % devuelto · orden = pedido multilínea al que pertenece (§3c)
--
-- ⚠️ CORRECCIÓN 4 · `sessions_sin_solape_por_tutor` es un EXCLUDE por TRAMO,
-- no un único por instante: dos sesiones del mismo tutor no pueden pisarse ni
-- un minuto. La 6 va de −50 a +10 min y la 5 de +10 a +70: pegadas, sin
-- solape (el rango es `[)`), y las dos visibles a la vez — la 6 en curso y la
-- 5 con la sala ya abierta (la ventana abre 10 min antes, o sea AHORA).
--
-- ⚠️ Escenarios efímeros (los cierra el cron close_expired_sessions cada 5 min):
--   5 «sala abierta» dura ~1 h 20 · 6 «en curso» dura ~1 h. Reejecutar el
--   fichero (o el bloque LIMPIAR + el fichero) justo antes de mirarlos.
--   1 y 18 «pendiente de pago» solo mueren si alguien llama a
--   /api/admin/expirar-reservas (no hay cron): en dev se quedan.
drop table if exists _r;
create temporary table _r (
  n int, b public.booking_status, p public.payment_status, s public.session_status,
  prod int, importe bigint, pct int, inicio interval, creada interval, pagada interval,
  motivo text, orden int
);
insert into _r values
  -- ── 3a · una reserva, una sesión ──────────────────────────────────────────
  ( 1, 'pending_payment',    'pending',            'scheduled',   1, 2500,   0, '2 days 10 hours',  '-3 minutes',  null,          null, null),
  ( 2, 'pending_acceptance', 'paid',               'scheduled',   2, 3000,   0, '3 days 15 hours',  '-2 hours',    '-2 hours',    null, null),
  ( 3, 'pending_acceptance', 'paid',               'scheduled',   2, 3000,   0, '4 days 15 hours',  '-21 hours',   '-21 hours',   null, null),
  ( 4, 'confirmed',          'paid',               'scheduled',   1, 2500,   0, '5 days 10 hours',  '-2 days',     '-2 days',     null, null),
  ( 5, 'confirmed',          'paid',               'scheduled',   1, 2500,   0, '10 minutes',       '-1 day',      '-1 day',      null, null),
  ( 6, 'in_progress',        'paid',               'in_progress', 1, 2500,   0, '-50 minutes',      '-1 day',      '-1 day',      null, null),
  ( 7, 'completed',          'paid',               'completed',   1, 2500,   0, '-20 days',         '-23 days',    '-23 days',    null, null),
  ( 8, 'completed',          'paid',               'completed',   2, 3000,   0, '-3 days',          '-6 days',     '-6 days',     null, null),
  ( 9, 'completed',          'paid',               'no_show',     1, 2500,   0, '-8 days',          '-11 days',    '-11 days',    null, null),
  (10, 'cancelled',          'failed',             'cancelled',   1, 2500,   0, '6 days 10 hours',  '-1 day',      null,          'El cobro no se completó (pago rechazado)', null),
  (11, 'cancelled',          'refunded',           'cancelled',   2, 3000, 100, '7 days 15 hours',  '-2 days',     '-2 days',     'Rechazada por el tutor', null),
  (12, 'cancelled',          'partially_refunded', 'cancelled',   1, 2500,  50, '8 days 10 hours',  '-3 days',     '-3 days',     'Cancelada por el alumno con menos de 24 h (RN-37, 50 %)', null),
  (13, 'cancelled',          'refunded',           'cancelled',   2, 3000, 100, '9 days 15 hours',  '-2 days',     '-2 days',     'RN-38 · el tutor no respondió en 24 h (100 %)', null),
  (14, 'refunded',           'refunded',           'completed',   1, 2500, 100, '-15 days',         '-18 days',    '-18 days',    'Reembolso posterior por admin (disputa)', null),
  -- ── 3c · pedidos multilínea (orders) ──────────────────────────────────────
  (16, 'confirmed',          'paid',               'scheduled',   1, 2500,   0, '10 days 10 hours', '-4 hours',    '-4 hours',    null, 1),
  (17, 'pending_acceptance', 'paid',               'scheduled',   2, 3000,   0, '10 days 15 hours', '-4 hours',    '-4 hours',    null, 1),
  (18, 'pending_payment',    'pending',            'scheduled',   1, 2500,   0, '11 days 10 hours', '-2 minutes',  null,          null, 2),
  (19, 'cancelled',          'failed',             'cancelled',   1, 2500,   0, '12 days 10 hours', '-1 day',      null,          'El pedido caducó sin pagar', 3);

-- 3c · Los pedidos primero (la FK bookings.order_id los exige).
insert into public.orders (id, student_id, status, provider, currency, provider_payment_id, lines_fingerprint, created_at)
select ('88888888-0008-4000-8000-00000000000' || o.n)::uuid, e.alumno, o.st, 'simulated', 'USD', o.pi, 'EY34-' || o.n, now() + o.creada
from _ey e, (values
  (1, 'paid'::public.order_status,            'pi_sim_EY34_orden_1', '-4 hours'::interval),
  (2, 'pending_payment'::public.order_status, null,                  '-2 minutes'::interval),
  (3, 'cancelled'::public.order_status,       null,                  '-1 day'::interval)
) as o(n, st, pi, creada)
on conflict (id) do nothing;

-- Reservas. Importes como create_booking (RN-10): por hora = precio × duración/60.
insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct,
  payer_country, payee_country, completed_at, cancelled_at, cancel_reason, order_id,
  created_at, updated_at
)
select
  ('88888888-0004-4000-8000-0000000000' || lpad(r.n::text, 2, '0'))::uuid,
  e.alumno, pr.id, e.tutor, r.b, pr.pricing_model, 1, pr.session_duration_min, 'USD',
  r.importe, r.importe, coalesce(ti.split_pct, 75.00),
  public.pais_de_cobro_por_zona(sp.timezone), coalesce(tp.payout_country, 'VE'),
  case when r.b in ('completed', 'refunded') then now() + r.inicio + interval '1 hour' end,
  case when r.b = 'cancelled' then now() + r.creada + interval '1 hour'
       when r.b = 'refunded'  then now() + r.inicio + interval '1 day' end,
  r.motivo,
  case when r.orden is not null then ('88888888-0008-4000-8000-00000000000' || r.orden)::uuid end,
  now() + r.creada, now() + r.creada
from _r r
cross join _ey e
join public.products pr on pr.id = ('88888888-0001-4000-8000-00000000000' || r.prod)::uuid
join public.profiles sp on sp.id = e.alumno
join public.tutor_profiles tp on tp.profile_id = e.tutor
left join public.tutor_tiers ti on ti.id = tp.tier_id
on conflict (id) do nothing;

-- Pagos. `provider = 'simulated'`: no deben aparecer nunca en Stripe/dLocal.
insert into public.payments (
  booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
  tier_split_pct, payer_country, payee_country, provider, provider_payment_id,
  refunded_amount, paid_at, failed_at, created_at
)
select
  b.id, r.p, 'USD', b.total_amount,
  b.total_amount - round(b.total_amount * b.tier_split_pct / 100)::bigint,
  round(b.total_amount * b.tier_split_pct / 100)::bigint,
  b.tier_split_pct, b.payer_country, b.payee_country, 'simulated',
  case when r.p <> 'pending' then 'pi_sim_EY34_' || r.n end,
  round(b.total_amount * r.pct / 100.0)::bigint,
  case when r.pagada is not null then now() + r.pagada end,
  case when r.p = 'failed' then now() + r.creada + interval '7 minutes' end,
  b.created_at
from _r r
join public.bookings b on b.id = ('88888888-0004-4000-8000-0000000000' || lpad(r.n::text, 2, '0'))::uuid
on conflict (booking_id) do nothing;

-- Sesiones. La ventana de acceso (±10 min) la pone el trigger. `daily_room_name`
-- solo en la que está en curso, como lo dejaría join_session.
insert into public.sessions (
  id, booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status,
  daily_room_name, completed_at, cancelled_at, created_at
)
select
  ('88888888-0005-4000-8000-0000000000' || lpad(r.n::text, 2, '0'))::uuid,
  b.id, b.tutor_id, b.student_id, 1,
  date_trunc('minute', now()) + r.inicio,
  date_trunc('minute', now()) + r.inicio + make_interval(mins => b.session_duration_min),
  r.s,
  case when r.s = 'in_progress' then 'ey-' || replace(('88888888-0005-4000-8000-0000000000' || lpad(r.n::text, 2, '0')), '-', '') end,
  case when r.s = 'completed' then date_trunc('minute', now()) + r.inicio + make_interval(mins => b.session_duration_min) end,
  case when r.s = 'cancelled' then b.cancelled_at end,
  b.created_at
from _r r
join public.bookings b on b.id = ('88888888-0004-4000-8000-0000000000' || lpad(r.n::text, 2, '0'))::uuid
on conflict (id) do nothing;

-- 3b · PAQUETE A MEDIAS (reserva 15): 4 sesiones, 2 dadas y 2 por dar.
insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct,
  payer_country, payee_country, created_at, updated_at
)
select '88888888-0004-4000-8000-000000000015', e.alumno, pr.id, e.tutor,
       'confirmed', 'per_package', 4, 60, 'USD', 9000, 9000, coalesce(ti.split_pct, 75.00),
       public.pais_de_cobro_por_zona(sp.timezone), coalesce(tp.payout_country, 'VE'),
       now() - interval '16 days', now() - interval '16 days'
from _ey e
join public.products pr on pr.id = '88888888-0001-4000-8000-000000000003'
join public.profiles sp on sp.id = e.alumno
join public.tutor_profiles tp on tp.profile_id = e.tutor
left join public.tutor_tiers ti on ti.id = tp.tier_id
on conflict (id) do nothing;

insert into public.payments (
  booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
  tier_split_pct, payer_country, payee_country, provider, provider_payment_id, paid_at, created_at
)
select b.id, 'paid', 'USD', 9000,
       9000 - round(9000 * b.tier_split_pct / 100)::bigint, round(9000 * b.tier_split_pct / 100)::bigint,
       b.tier_split_pct, b.payer_country, b.payee_country, 'simulated', 'pi_sim_EY34_15',
       b.created_at, b.created_at
from public.bookings b where b.id = '88888888-0004-4000-8000-000000000015'
on conflict (booking_id) do nothing;

insert into public.sessions (id, booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status, completed_at, created_at)
select ('88888888-0005-4000-8000-0000000000' || (50 + q.seq))::uuid, b.id, b.tutor_id, b.student_id, q.seq,
       date_trunc('minute', now()) + q.inicio,
       date_trunc('minute', now()) + q.inicio + interval '60 minutes',
       q.st,
       case when q.st = 'completed' then date_trunc('minute', now()) + q.inicio + interval '60 minutes' end,
       b.created_at
from public.bookings b, (values
  (1, '-14 days 11 hours'::interval, 'completed'::public.session_status),
  (2, '-7 days 11 hours'::interval,  'completed'::public.session_status),
  (3, '7 days 11 hours'::interval,   'scheduled'::public.session_status),
  (4, '14 days 11 hours'::interval,  'scheduled'::public.session_status)
) as q(seq, inicio, st)
where b.id = '88888888-0004-4000-8000-000000000015'
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · REEMBOLSOS (uno por estado) y RESEÑAS (con y sin comentario)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.refund_requests (
  id, payment_id, booking_id, idempotency_key, provider, provider_payment_id, provider_refund_id,
  amount, currency, reason, status, last_error, last_attempt_at, processed_at, created_at
)
select
  ('88888888-0009-4000-8000-0000000000' || lpad(q.n::text, 2, '0'))::uuid,
  p.id, p.booking_id, 'X01:payment:' || p.id || ':' || p.refunded_amount,
  'simulated', p.provider_payment_id,
  case when q.st = 'refunded' then 're_sim_EY34_' || q.n end,
  p.refunded_amount, p.currency, b.cancel_reason, q.st,
  case when q.st = 'failed' then 'PSP: charge_already_disputed (necesita una persona)' end,
  case when q.st in ('refunded', 'failed') then b.cancelled_at + interval '2 minutes' end,
  case when q.st = 'refunded' then b.cancelled_at + interval '2 minutes' end,
  b.cancelled_at
from (values
  (11, 'refunded'::public.refund_request_status),
  (12, 'refunded'::public.refund_request_status),
  (13, 'pending'::public.refund_request_status),
  (14, 'failed'::public.refund_request_status)
) as q(n, st)
join public.bookings b on b.id = ('88888888-0004-4000-8000-0000000000' || q.n)::uuid
join public.payments p on p.booking_id = b.id
on conflict do nothing;

-- Reseña con comentario y firmada (8) · solo estrellas, anónima (9).
-- El trigger reviews_refresh_rating recalcula rating_avg / rating_count solo.
-- La 7 se deja SIN reseña: es la que el alumno puede reseñar desde su panel.
insert into public.reviews (id, booking_id, student_id, tutor_id, product_id, rating, comment, author_display, created_at)
select ('88888888-0007-4000-8000-0000000000' || lpad(q.n::text, 2, '0'))::uuid,
       b.id, b.student_id, b.tutor_id, b.product_id, q.rating, q.comentario, q.autor, b.completed_at + interval '1 day'
from (values
  (8, 5::smallint, 'Explica el porqué, no la receta. Salí con la duda resuelta y con ejercicios para la semana.', 'Emilio F.'),
  (9, 3::smallint, null, null)
) as q(n, rating, comentario, autor)
join public.bookings b on b.id = ('88888888-0004-4000-8000-0000000000' || lpad(q.n::text, 2, '0'))::uuid
on conflict (booking_id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · PAYOUTS — uno por estado — y cuenta de cobro manual
-- ════════════════════════════════════════════════════════════════════════════
-- Sin `payout_items`: no consumen los pagos de §3, así que el saldo que calcula
-- tutor_balance() sale de las reservas completadas (7 y 9 disponibles, 8 en
-- retención de 7 días) y «Ya cobrado» de los payouts en 'paid'.
-- `scheduled_for` en el futuro para que process_scheduled_payouts (cron cada
-- 10 min, coge scheduled con scheduled_for <= now()) NO intente ejecutarlo.
insert into public.payouts (
  id, tutor_id, status, currency, amount, provider, funding_provider, payee_country,
  provider_payout_id, retention_until, scheduled_for, paid_at, failed_at, failure_reason,
  created_at, updated_at
)
select ('88888888-0006-4000-8000-00000000000' || q.n)::uuid, e.tutor, q.st, 'USD', q.importe,
       q.prov, 'simulated', coalesce(tp.payout_country, 'VE'), q.ref,
       now() - interval '7 days', q.prog, q.pagado, q.fallo, q.motivo,
       now() + q.creada, now() + q.creada
from _ey e
join public.tutor_profiles tp on tp.profile_id = e.tutor
cross join (values
  (1, 'pending'::public.payout_status,    1875, null,        null,               null::timestamptz,          null::timestamptz,          null::timestamptz,         null,
      '-1 day'::interval),
  (2, 'scheduled'::public.payout_status,  2250, null,        null,               now() + interval '7 days',  null,                       null,                      null,
      '-2 days'::interval),
  (3, 'processing'::public.payout_status, 4125, 'simulated', 'SIM-EY34-3',       now() - interval '1 hour',  null,                       null,                      null,
      '-1 day'::interval),
  (4, 'paid'::public.payout_status,       5625, 'paypal',    'PAYOUT-EY34-4',    now() - interval '30 days', now() - interval '30 days', null,                      null,
      '-32 days'::interval),
  (5, 'failed'::public.payout_status,     1875, 'dlocal',    null,               now() - interval '5 days',  null,                       now() - interval '5 days', 'dLocal: el país no tiene account_types (NTF-16)',
      '-6 days'::interval),
  (6, 'on_hold'::public.payout_status,    3000, null,        null,               null,                       null,                       null,                      'Retenido por admin: revisión de identidad',
      '-4 days'::interval)
) as q(n, st, importe, prov, ref, prog, pagado, fallo, motivo, creada)
on conflict (id) do nothing;

-- Cuenta de cobro manual (VE): un Zelle registrado; PayPal se conecta desde la
-- app (conectar_cuenta_paypal), no se siembra. Comprobado en dev: los canales
-- sembrados son zinli, binance, zelle, airtm y paypal.
insert into public.tutor_manual_payout_destinations (tutor_id, channel, holder_name, handle)
select e.tutor, c.channel, 'Emilio Faim', 'emilio.zelle@faimlab.com'
from _ey e join public.payout_manual_channels c on c.channel = 'zelle'
on conflict (tutor_id, channel) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · CONVERSACIÓN con mensajes sin leer, y NOTIFICACIONES (una por estado)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CORRECCIÓN 5 · La conversación NO se crea aquí: las 19 reservas de §3 ya
-- abrieron el hilo de este par por `bookings_ensure_conversation`, con id
-- aleatorio. Se BUSCA por (student_id, tutor_id), que es su clave real
-- (`conversations_pair_unique`).
--
-- ⚠️ CORRECCIÓN 1 · `messages.conversation_id` es NOT NULL. Y como estos
-- mensajes SÍ llevan `booking_id`, `expires_at` tiene que quedarse con su
-- default (+30 días): `messages_caducidad_por_reserva` exige
-- `(booking_id is null) = (expires_at is null)` — al revés que un hilo libre.
--
-- Mensajes sobre la reserva 4 (confirmada). El último lo mandó el alumno y el
-- tutor lo leyó hasta las -19 h: le queda UNO sin leer (contador del menú).
insert into public.messages (id, conversation_id, booking_id, sender_id, body, created_at)
select ('88888888-0013-4000-8000-00000000000' || q.n)::uuid, c.id,
       '88888888-0004-4000-8000-000000000004',
       case when q.de = 'alumno' then e.alumno else e.tutor end, q.texto, now() + q.cuando
from _ey e
join public.conversations c on c.student_id = e.alumno and c.tutor_id = e.tutor
cross join (values
  (1, 'alumno', 'Hola, ¿puedo llevar mis propios ejercicios a la clase?', '-1 day'::interval),
  (2, 'tutor',  'Claro, tráelos y empezamos por ahí.',                    '-20 hours'::interval),
  (3, 'alumno', 'Perfecto, nos vemos el día de la clase.',                '-1 hour'::interval)
) as q(n, de, texto, cuando)
on conflict (id) do nothing;

-- ⚠️ CORRECCIÓN 2 · la tabla es `conversation_reads`, no `message_reads`, y su
-- clave es el HILO, no la reserva.
insert into public.conversation_reads (conversation_id, user_id, last_read_at)
select c.id, e.tutor, now() - interval '19 hours'
from _ey e
join public.conversations c on c.student_id = e.alumno and c.tutor_id = e.tutor
on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;

-- La bandeja ordena por `last_message_at` y el trigger de la reserva lo deja
-- nulo: sin esto el hilo con texto cae al fondo de la lista.
update public.conversations c
   set last_message_at = m.ultimo
  from (select conversation_id, max(created_at) as ultimo
          from public.messages where id::text like '88888888-0013-%'
         group by conversation_id) m
 where c.id = m.conversation_id;

-- Notificaciones. La pendiente va por 'in_app' a propósito: la cola de correo
-- (process_notifications, cada 2 min) solo despacha email+pending y ENVÍA DE VERDAD.
insert into public.notifications (id, recipient_id, type, channel, template, payload, idempotency_key, status, sent_at, created_at)
select ('88888888-0011-4000-8000-00000000000' || q.n)::uuid,
       case when q.para = 'tutor' then e.tutor else e.alumno end,
       q.tipo, q.canal, q.plantilla, q.payload, 'EY34:' || q.n, q.st, q.enviada, now() - interval '2 hours'
from _ey e, (values
  (1, 'tutor',  'NTF-16', 'in_app', 'payout_issue',              '{"payout_id":"88888888-0006-4000-8000-000000000005"}'::jsonb,  'pending'::public.notification_status, null::timestamptz),
  (2, 'alumno', 'NTF-05', 'email',  'booking_confirmed_student', '{"booking_id":"88888888-0004-4000-8000-000000000004"}'::jsonb, 'sent'::public.notification_status,    now() - interval '2 days'),
  (3, 'tutor',  'NTF-07', 'email',  'booking_new_tutor',         '{"booking_id":"88888888-0004-4000-8000-000000000003"}'::jsonb, 'failed'::public.notification_status,  null)
) as q(n, para, tipo, canal, plantilla, payload, st, enviada)
on conflict (idempotency_key) do nothing;

drop table if exists _r;
drop table if exists _ey;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN (ejecutar aparte, después)
-- ════════════════════════════════════════════════════════════════════════════
-- select b.id, b.status, p.status as pago, s.status as sesion, s.start_at, b.cancel_reason
--   from public.bookings b
--   join public.payments p on p.booking_id = b.id
--   join public.sessions s on s.booking_id = b.id
--  where b.id::text like '88888888-0004-%'
--  order by b.id, s.sequence_no;
-- select status, count(*) from public.payouts where id::text like '88888888-0006-%' group by 1;


-- ════════════════════════════════════════════════════════════════════════════
-- OPCIONAL · estados que NO caben a la vez en una sola cuenta
-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutar UNO, mirar la pantalla, y volver a 'approved'. Son UPDATE y por
-- tanto disparan notify_tutor_profile (correo real): hacerlo con el correo del
-- tutor a mano o con la cola parada.
-- update public.tutor_profiles set approval_status = 'pending'   where profile_id = '<tutor>';  -- «En revisión»
-- update public.tutor_profiles set approval_status = 'rejected'  where profile_id = '<tutor>';  -- «Rechazado»
-- update public.tutor_profiles set approval_status = 'suspended' where profile_id = '<tutor>';  -- «Suspendido»
-- update public.tutor_profiles set identity_verification_status = 'not_submitted' where profile_id = '<tutor>';
-- update public.verification_documents set status = 'draft'    where tutor_id = '<tutor>' and doc_type = 'cv';
-- update public.verification_documents set status = 'pending'  where tutor_id = '<tutor>' and doc_type = 'cv';
-- update public.verification_documents set status = 'rejected', review_notes = 'Borrosa' where tutor_id = '<tutor>' and doc_type = 'cv';
-- update public.conversations set blocked_at = now(), blocked_reason = 'Reportada'
--   where student_id = (select id from auth.users where email='emilio+alumno@faimlab.com');


-- ════════════════════════════════════════════════════════════════════════════
-- LIMPIAR · borra SOLO lo que sembró este fichero (orden por FK)
-- ════════════════════════════════════════════════════════════════════════════
-- delete from public.notifications              where id::text like '88888888-0011-%';
-- delete from public.conversation_reads         where conversation_id in (select id from public.conversations where student_id = (select id from auth.users where email='emilio+alumno@faimlab.com'));
-- delete from public.messages                   where id::text like '88888888-0013-%';
-- delete from public.reviews                    where id::text like '88888888-0007-%';
-- delete from public.refund_requests            where id::text like '88888888-0009-%';
-- delete from public.payouts                    where id::text like '88888888-0006-%';
-- delete from public.sessions                   where id::text like '88888888-0005-%';
-- delete from public.payments                   where booking_id::text like '88888888-0004-%';
-- delete from public.bookings                   where id::text like '88888888-0004-%';
-- delete from public.orders                     where id::text like '88888888-0008-%';
-- delete from public.conversations              where student_id = (select id from auth.users where email='emilio+alumno@faimlab.com');
-- delete from public.availability_exceptions    where id::text like '88888888-0003-%';
-- delete from public.product_availability_rules where rule_id::text like '88888888-0002-%';
-- delete from public.availability_rules         where id::text like '88888888-0002-%';
-- delete from public.products                   where id::text like '88888888-0001-%';
-- delete from public.verification_documents     where id::text like '88888888-0012-%';
