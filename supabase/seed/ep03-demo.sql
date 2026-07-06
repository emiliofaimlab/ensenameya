-- ============================================================================
-- Enséñame Ya — SEED DEMO (EP-03). ⚠️  SOLO DEV — NO aplicar a producción.
-- Vive FUERA de supabase/migrations/ a propósito: el CI solo despliega migraciones,
-- así que estos tutores/productos de mentira nunca llegan a prod.
--
-- Crea 3 tutores aprobados + sus productos activos para ver las pantallas de
-- descubrimiento con datos reales. Idempotente (on conflict do nothing).
--
-- Aplicar SOLO al proyecto dev — desde el SQL Editor de Supabase (dev) o:
--   psql "<connection string de DEV>" -f supabase/seed/ep03-demo.sql
--
-- Los tutores demo no inician sesión (encrypted_password NULL): son solo vitrina.
-- Los token* van en '' para evitar el NOT NULL sin default de auth.users.
-- ============================================================================

-- Tutores demo (auth.users → dispara handle_new_user: crea profiles + rol alumno).
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change,
   email_change_token_new, email_change_token_current, reauthentication_token)
values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'demo.ana@ensenameya.dev', null, now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Ana Torres","timezone":"America/Caracas"}', now(), now(),
   '', '', '', '', '', ''),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'demo.bruno@ensenameya.dev', null, now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Bruno Díaz","timezone":"America/Bogota"}', now(), now(),
   '', '', '', '', '', ''),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'demo.carla@ensenameya.dev', null, now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Carla Ruiz","timezone":"America/Mexico_City"}', now(), now(),
   '', '', '', '', '', '')
on conflict (id) do nothing;

-- Rol tutor (además del alumno que puso el trigger).
insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'tutor'),
  ('a0000000-0000-4000-8000-000000000002', 'tutor'),
  ('a0000000-0000-4000-8000-000000000003', 'tutor')
on conflict do nothing;

-- Perfiles públicos APROBADOS.
insert into public.tutor_profiles
  (profile_id, headline, bio, approval_status, identity_verification_status,
   rating_avg, rating_count, approved_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'Profesora de Matemáticas',
   'Ayudo a perderle el miedo al álgebra y al cálculo. 8 años de experiencia.',
   'approved', 'approved', 4.9, 37, now()),
  ('a0000000-0000-4000-8000-000000000002', 'Desarrollador y mentor de Programación',
   'Full-stack. Te acompaño de cero a tu primer proyecto real en la web.',
   'approved', 'approved', 4.7, 21, now()),
  ('a0000000-0000-4000-8000-000000000003', 'Coach de Idiomas (Inglés y Francés)',
   'Conversación desde la primera clase. Preparación para exámenes oficiales.',
   'approved', 'approved', 4.8, 52, now())
on conflict (profile_id) do nothing;

-- Productos ACTIVOS (price_amount en unidades menores; USD → centavos).
insert into public.products
  (id, tutor_id, title, slug, description, outcome,
   pricing_model, price_amount, currency, session_duration_min, package_num_sessions, status)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Cálculo I sin sufrir', 'calculo-i-sin-sufrir',
   'Límites, derivadas e integrales explicados paso a paso con ejercicios.',
   'Apruebas tu primer parcial de cálculo con confianza.',
   'per_session', 1500, 'USD', 60, null, 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'Tu primera app web', 'tu-primera-app-web',
   'HTML, CSS, JavaScript y React construyendo un proyecto real.',
   'Publicas tu propia app en internet.',
   'per_package', 12000, 'USD', 90, 8, 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'Inglés conversacional', 'ingles-conversacional',
   'Práctica hablada intensiva, corrección en vivo y material a medida.',
   'Sostienes una conversación fluida en 3 meses.',
   'per_hour', 1000, 'USD', 60, null, 'active')
on conflict (id) do nothing;

-- Categorías de cada producto (N–M) — resueltas por slug.
insert into public.product_categories (product_id, category_id)
select v.product_id::uuid, c.id
from (values
  ('b0000000-0000-4000-8000-000000000001', 'matematicas'),
  ('b0000000-0000-4000-8000-000000000001', 'preparacion-examenes'),
  ('b0000000-0000-4000-8000-000000000002', 'programacion'),
  ('b0000000-0000-4000-8000-000000000003', 'idiomas')
) as v(product_id, slug)
join public.categories c on c.slug = v.slug
on conflict do nothing;
