-- ============================================================================
-- Enséñame Ya — cuentas de GRUPALES y ACADEMIAS.  ⚠️  SOLO DEV.
--
-- Fase 0 de `docs/PLAN-ACADEMIAS-Y-GRUPALES.md`: las cuentas con las que se
-- verifica cada fase. Aplicar con:
--   npx supabase db query --linked -f supabase/seed/dev-grupales-academias.sql
--
-- Contraseña de todas: Ensename2026!   ·   Dominio: @ensenameya.dev
--
-- | Cuenta              | Qué es                                                |
-- | ga.tutor            | Tutor independiente. Aprobado, payout MX, 1 mentoría  |
-- |                     | 1:1 y agenda L-V. Será el de grupales (RG-18)         |
-- | ga.alumno.ve/mx/es  | Tres alumnos. Su PAÍS de cobro sale de la ZONA       |
-- |                     | HORARIA del perfil (`pais_de_cobro_por_zona`, en      |
-- |                     | create_booking_line), así que la zona NO es decorado: |
-- |                     | VE → Stripe, MX → dLocal, ES → Stripe (por defecto)   |
-- | ga.academia.admin   | Futuro administrador de «Academia Piloto»            |
-- | ga.academia.tutor1/2| Tutores de la academia (`tutor_profiles.academy_id`) |
-- | ga.lista.1 … 5      | Alumnos que irán en la lista de la academia           |
-- | ga.fuera            | Alumno que NO está en la lista                        |
--
-- Desde la Fase C (`20261008120100`, `20261009170100`) también enciende las
-- grupales de ga.tutor y monta la Academia Piloto: administrador, comisión del
-- 80 %, país CO y los cinco alumnos de la lista activos.
--
-- Idempotente: UUIDs fijos (espacio `c1…` cuentas, `c2…` mentorías, `c3…`
-- agenda) y `on conflict`. Una sola transacción (así corre `db query`).
-- ============================================================================

-- ── 1 · Cuentas (el trigger `handle_new_user` crea profiles + rol 'alumno') ──
-- Mismo patrón que `dev-poblar.sql`: email confirmado y `auth.identities`,
-- sin la cual el login falla en silencio.
with nuevos(id, email, full_name, tz) as (values
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'ga.tutor@ensenameya.dev',           'Gabriela Andrade', 'America/Mexico_City'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'ga.alumno.ve@ensenameya.dev',       'Víctor Escalona',  'America/Caracas'),
  ('c1000000-0000-4000-8000-000000000003'::uuid, 'ga.alumno.mx@ensenameya.dev',       'Mariana Xóchitl',  'America/Mexico_City'),
  ('c1000000-0000-4000-8000-000000000004'::uuid, 'ga.alumno.es@ensenameya.dev',       'Elena Soler',      'Europe/Madrid'),
  ('c1000000-0000-4000-8000-000000000010'::uuid, 'ga.academia.admin@ensenameya.dev',  'Adrián Montero',   'America/Bogota'),
  ('c1000000-0000-4000-8000-000000000011'::uuid, 'ga.academia.tutor1@ensenameya.dev', 'Teresa Uribe',     'America/Bogota'),
  ('c1000000-0000-4000-8000-000000000012'::uuid, 'ga.academia.tutor2@ensenameya.dev', 'Tobías Ugarte',    'America/Lima'),
  ('c1000000-0000-4000-8000-000000000021'::uuid, 'ga.lista.1@ensenameya.dev',         'Laura Iriarte',    'America/Bogota'),
  ('c1000000-0000-4000-8000-000000000022'::uuid, 'ga.lista.2@ensenameya.dev',         'Luis Ibarra',      'America/Bogota'),
  ('c1000000-0000-4000-8000-000000000023'::uuid, 'ga.lista.3@ensenameya.dev',         'Lina Isaza',       'America/Bogota'),
  ('c1000000-0000-4000-8000-000000000024'::uuid, 'ga.lista.4@ensenameya.dev',         'Lorenzo Illanes',  'America/Lima'),
  ('c1000000-0000-4000-8000-000000000025'::uuid, 'ga.lista.5@ensenameya.dev',         'Lucía Ibáñez',     'America/Lima'),
  ('c1000000-0000-4000-8000-000000000030'::uuid, 'ga.fuera@ensenameya.dev',           'Federico Uzcátegui','America/Caracas')
)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
select n.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       n.email, crypt('Ensename2026!', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', n.full_name, 'timezone', n.tz),
       now(), now(), '', '', '', '', '', ''
  from nuevos n
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
  from auth.users u
 where u.id::text like 'c1000000-0000-4000-8000-%'
on conflict (provider_id, provider) do nothing;

update public.profiles set onboarding_complete = true
 where id::text like 'c1000000-0000-4000-8000-%';

-- El alta encola `welcome_student`/`welcome_tutor`, y la cola de dev ENVÍA por
-- Resend: a @ensenameya.dev, que no existe, es un rebote por cuenta y ensucia
-- la reputación del dominio verificado. Se marcan `failed` antes de que salgan.
update public.notifications set status = 'failed'
 where recipient_id::text like 'c1000000-0000-4000-8000-%'
   and status = 'pending'
   and template in ('welcome_student', 'welcome_tutor');

-- ── 2 · Tutores: rol + perfil aprobado ───────────────────────────────────────
-- Aprobados en el INSERT, no con UPDATE: `notify_tutor_profile` es AFTER UPDATE
-- y la cola de correo ENVÍA DE VERDAD. Por lo mismo, el rol va a mano y no por
-- `review_tutor()` (y hay que acordarse: es el fallo de `tutor.us401`).
insert into public.user_roles (user_id, role)
select id, 'tutor'::public.app_role from auth.users
 where id in ('c1000000-0000-4000-8000-000000000001',
              'c1000000-0000-4000-8000-000000000011',
              'c1000000-0000-4000-8000-000000000012')
on conflict do nothing;

insert into public.academies (slug, name, tagline, description, status)
values ('academia-piloto', 'Academia Piloto',
        'Academia de pruebas de grupales y academias',
        'Existe solo en dev para verificar las fases de academias y clases grupales.',
        'active')
on conflict (slug) do nothing;

with datos(profile_id, display_name, headline, bio, payout, academia) as (values
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'Gabriela Andrade',
   'Matemáticas en grupo · clases pequeñas de hasta 10',
   'Tutora de pruebas para clases grupales. Da 1:1 y, en cuanto se enciende su interruptor, clases grupales.',
   'MX', null::text),
  ('c1000000-0000-4000-8000-000000000011'::uuid, 'Teresa Uribe',
   'Inglés para colegios · tutora de Academia Piloto',
   'Tutora de pruebas de la academia.', 'CO', 'academia-piloto'),
  ('c1000000-0000-4000-8000-000000000012'::uuid, 'Tobías Ugarte',
   'Matemáticas para colegios · tutor de Academia Piloto',
   'Tutor de pruebas de la academia.', 'PE', 'academia-piloto')
)
insert into public.tutor_profiles (
  profile_id, display_name, headline, bio, teaching_level,
  approval_status, identity_verification_status, approved_at, tier_id,
  payout_country, academy_id
)
select d.profile_id, d.display_name, d.headline, d.bio, 'intermedio'::public.teaching_level,
       'approved'::public.tutor_approval_status, 'approved'::public.identity_verification_status,
       now() - interval '30 days', (select id from public.tutor_tiers where is_default),
       d.payout, (select id from public.academies where slug = d.academia)
  from datos d
on conflict (profile_id) do update set
  approval_status = excluded.approval_status,
  payout_country  = excluded.payout_country,
  academy_id      = excluded.academy_id;

-- ── 3 · ga.tutor: una mentoría 1:1 y agenda ──────────────────────────────────
-- Hace falta para el criterio 3 de la Fase C y el escenario 2 del anexo B:
-- publicar una grupal tiene que QUITAR esa hora de su agenda 1:1.
insert into public.products (
  id, tutor_id, title, outcome, description, pricing_model, price_amount,
  currency, session_duration_min, status, level, language, auto_accept_bookings
) values (
  'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
  'Matemáticas 1:1', 'resuelves tus ejercicios con alguien al lado',
  'Mentoría 1:1 de la tutora de pruebas de grupales.',
  'per_session', 2000, 'USD', 60, 'active', 'intermedio', 'es', true
) on conflict (id) do nothing;

insert into public.product_categories (product_id, category_id)
select 'c2000000-0000-4000-8000-000000000001', id from public.categories where slug = 'matematicas'
on conflict do nothing;

insert into public.tutor_categories (tutor_id, category_id)
select 'c1000000-0000-4000-8000-000000000001', id from public.categories where slug = 'matematicas'
on conflict do nothing;

-- weekday: 1=lunes … 5=viernes, 09-18 en America/Mexico_City.
insert into public.availability_rules (id, tutor_id, weekday, start_time, end_time)
select ('c3000000-0000-4000-8000-00000000000' || d)::uuid,
       'c1000000-0000-4000-8000-000000000001', d, '09:00', '18:00'
  from generate_series(1, 5) d
on conflict (id) do nothing;

-- ── 4 · Fase C: grupales y academia ──────────────────────────────────────────
update public.tutor_profiles set group_classes_enabled = true
 where profile_id = 'c1000000-0000-4000-8000-000000000001';

update public.academies
   set owner_id = 'c1000000-0000-4000-8000-000000000010',
       commission_pct = 80, payout_country = 'CO', status = 'active'
 where slug = 'academia-piloto';

insert into public.academy_members (academy_id, email, profile_id, role, status, accepted_at)
select a.id, u.email, u.id, 'student', 'active', now()
  from public.academies a
  cross join auth.users u
 where a.slug = 'academia-piloto'
   and u.id::text like 'c1000000-0000-4000-8000-00000000002_'
on conflict (academy_id, email, role) do nothing;

-- ── Comprobación ─────────────────────────────────────────────────────────────
select u.email,
       string_agg(r.role::text, ',' order by r.role) as roles,
       tp.approval_status, tp.payout_country, a.slug as academia
  from auth.users u
  left join public.user_roles r on r.user_id = u.id
  left join public.tutor_profiles tp on tp.profile_id = u.id
  left join public.academies a on a.id = tp.academy_id
 where u.id::text like 'c1000000-0000-4000-8000-%'
 group by u.email, tp.approval_status, tp.payout_country, a.slug
 order by u.email;
