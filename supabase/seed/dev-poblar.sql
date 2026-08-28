-- ============================================================================
-- Enséñame Ya — POBLAR DEV.  ⚠️  SOLO DEV — NO aplicar a producción.
--
-- Vive FUERA de supabase/migrations/ a propósito: el CI solo despliega
-- migraciones, así que estos tutores de mentira nunca llegan a prod.
--
-- Qué deja: 8 tutores APROBADOS y RESERVABLES DE VERDAD, con 14 mentorías
-- activas repartidas por las 10 categorías, disponibilidad semanal, 4 alumnos y
-- 24 reseñas con su historial de reservas completadas.
--
-- Por qué existe habiendo ya siete seeds: **ninguno crea availability_rules**.
-- Sin esa tabla `get_available_slots` devuelve vacío y el botón "Reservar" no
-- ofrece un solo horario — los tutores de `ep03-demo.sql` son vitrina muerta.
--
-- A DIFERENCIA de los seeds anteriores, estas cuentas SÍ pueden iniciar sesión
-- (los otros dejan `encrypted_password` en NULL). Contraseña de todas:
--
--        Ensename2026!
--
-- Cómo aplicarlo:
--   npm run db:seed
--   -- o: psql "$SUPABASE_DB_URL" -f supabase/seed/dev-poblar.sql
--   -- o: pegarlo ENTERO en el SQL Editor de Supabase (dev)
--
-- Idempotente: UUIDs fijos y `on conflict`. Reejecutable sin duplicar nada.
-- Espacio de nombres propio, no choca con los seeds viejos:
--   11111111-… tutores · 22222222-… mentorías · 33333333-… disponibilidad
--   44444444-… alumnos · 55555555-… reservas  · 66666666-… reseñas
-- ============================================================================

-- ⚠️  SIN TRANSACCIÓN (ni `begin` ni `commit`), Y ES A PROPÓSITO.
--
-- Este archivo se ejecuta desde el SQL Editor de Supabase, y ese editor solo
-- enseña el resultado de la ÚLTIMA sentencia. Envuelto en una transacción, un
-- error a mitad de camino se vuelve INVISIBLE: la transacción se aborta, el
-- `commit` se degrada a ROLLBACK, y cualquier `select` posterior corre ya en
-- una transacción nueva y limpia y responde tan feliz. Resultado: "Success. No
-- rows returned", cero datos y cero pistas. Pasó, y costó tres vueltas.
--
-- Sin transacción, cada sentencia va por su cuenta: el editor se para en la
-- primera que falle y te enseña el error. Se pierde la atomicidad, y no
-- importa: el archivo es idempotente, así que arreglas y lo vuelves a correr.
--
-- Por el mismo motivo, las consultas de comprobación viven al final COMENTADAS.
-- Si se ejecutan aquí, vuelven a tapar el error.
--
-- pgcrypto (bcrypt de las contraseñas) ya viene instalada en `extensions`, y el
-- search_path por defecto de Supabase la incluye — comprobado en dev:
--   search_path = "$user", public, extensions
-- así que `crypt()` y `gen_salt()` resuelven sin prefijo.
create extension if not exists pgcrypto with schema extensions;


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · TUTORES  (auth.users → el trigger crea profiles + rol 'alumno')
-- ════════════════════════════════════════════════════════════════════════════
-- El `timezone` NO es decorativo: `get_available_slots` lo usa como hora de
-- pared para convertir las franjas a UTC (RN-01/02). Variados a propósito, que
-- es justo lo que RISK-12 pide ejercitar.

with nuevos(id, email, full_name, tz) as (values
  ('11111111-0000-4000-8000-000000000001'::uuid, 'val.rios@ensenameya.dev',        'Valentina Ríos',  'America/Caracas'),
  ('11111111-0000-4000-8000-000000000002'::uuid, 'mateo.herrera@ensenameya.dev',   'Mateo Herrera',   'America/Bogota'),
  ('11111111-0000-4000-8000-000000000003'::uuid, 'camila.duarte@ensenameya.dev',   'Camila Duarte',   'America/Mexico_City'),
  ('11111111-0000-4000-8000-000000000004'::uuid, 'diego.salazar@ensenameya.dev',   'Diego Salazar',   'America/Argentina/Buenos_Aires'),
  ('11111111-0000-4000-8000-000000000005'::uuid, 'lucia.ferrer@ensenameya.dev',    'Lucía Ferrer',    'Europe/Madrid'),
  ('11111111-0000-4000-8000-000000000006'::uuid, 'andres.pena@ensenameya.dev',     'Andrés Peña',     'America/Lima'),
  ('11111111-0000-4000-8000-000000000007'::uuid, 'sofia.marin@ensenameya.dev',     'Sofía Marín',     'America/Santiago'),
  ('11111111-0000-4000-8000-000000000008'::uuid, 'tomas.aguilar@ensenameya.dev',   'Tomás Aguilar',   'America/Caracas'),
  -- Alumnos. Mismo INSERT porque para auth.users no hay diferencia, y el rol
  -- lo pone el trigger: 'alumno' es lo que todos reciben al nacer.
  ('44444444-0000-4000-8000-000000000001'::uuid, 'marina.gomez@ensenameya.dev',    'Marina Gómez',    'America/Caracas'),
  ('44444444-0000-4000-8000-000000000002'::uuid, 'julian.prado@ensenameya.dev',    'Julián Prado',    'America/Bogota'),
  ('44444444-0000-4000-8000-000000000003'::uuid, 'rocio.vera@ensenameya.dev',      'Rocío Vera',      'Europe/Madrid'),
  ('44444444-0000-4000-8000-000000000004'::uuid, 'ignacio.blanco@ensenameya.dev',  'Ignacio Blanco',  'America/Mexico_City')
)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
select
  n.id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  n.email,
  crypt('Ensename2026!', gen_salt('bf')),
  now(),                                    -- email ya confirmado: sin SMTP en dev
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', n.full_name, 'timezone', n.tz),
  now(), now(),
  -- Los token* van en '' para esquivar el NOT NULL sin default de auth.users.
  '', '', '', '', '', ''
from nuevos n
on conflict (id) do nothing;

-- La fila de auth.identities es OBLIGATORIA para que GoTrue resuelva el login.
-- Sin ella el usuario existe, la contraseña es correcta y el login falla igual
-- — en silencio y sin pista. Es el fallo más probable de todo este archivo.
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object(
    'sub', u.id::text, 'email', u.email,
    'email_verified', true, 'phone_verified', false
  ),
  'email', now(), now(), now()
from auth.users u
where u.id::text like '11111111-0000-4000-8000-%'
   or u.id::text like '44444444-0000-4000-8000-%'
on conflict (provider_id, provider) do nothing;

-- El onboarding ya está hecho: si no, la app los manda al asistente.
update public.profiles
   set onboarding_complete = true
 where id::text like '11111111-0000-4000-8000-%'
    or id::text like '44444444-0000-4000-8000-%';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · ROL 'tutor'
-- ════════════════════════════════════════════════════════════════════════════
-- Explícito y a mano. Normalmente lo concede `review_tutor()`, pero esa RPC
-- encola un correo por tutor (NTF-03) y la cola HOY ENVÍA DE VERDAD. Saltársela
-- es lo correcto aquí, pero entonces hay que acordarse del rol: es exactamente
-- lo que le pasó al fixture `tutor.us401`, aprobado por SQL y sin rol nunca.

insert into public.user_roles (user_id, role)
select id, 'tutor'::public.app_role
  from auth.users
 where id::text like '11111111-0000-4000-8000-%'
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · PERFILES DE TUTOR — aprobados de una vez
-- ════════════════════════════════════════════════════════════════════════════
-- `approval_status` entra ya en 'approved' en el INSERT, no con un UPDATE
-- posterior: `notify_tutor_profile` es AFTER UPDATE, así que insertándolo
-- aprobado no se encola ni un correo.
--
-- `identity_verification_status` también aprobado para que el panel de admin
-- sea coherente (RN-29 exige KYC aprobado antes de aprobar al tutor).

with datos(profile_id, display_name, headline, bio, nivel) as (values
  ('11111111-0000-4000-8000-000000000001'::uuid, 'Valentina Ríos',
   'Profesora de Matemáticas · 8 años preparando admisiones',
   'Licenciada en Matemáticas. Trabajo el razonamiento antes que la fórmula: si entiendes de dónde sale, no hay que memorizarla. He acompañado a más de 200 estudiantes a su examen de admisión.',
   'avanzado'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000002'::uuid, 'Mateo Herrera',
   'Desarrollador full-stack · React, Next.js y buenas prácticas',
   'Diez años construyendo producto, los últimos cuatro con React y Next.js. Damos clase sobre tu propio código: se aprende mucho más arreglando lo que ya escribiste que con ejercicios de juguete.',
   'intermedio'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000003'::uuid, 'Camila Duarte',
   'Coach de idiomas · Inglés de trabajo y portugués',
   'Traductora de formación y profesora por vocación. Mis clases son conversación desde el minuto uno: la gramática entra sola cuando tienes algo que contar.',
   'basico'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000004'::uuid, 'Diego Salazar',
   'Física y Química de bachillerato, sin sufrir',
   'Profesor de secundaria durante seis años. Me especializo en quienes llegan con la asignatura atragantada: empezamos por lo que falló, no por el temario.',
   'intermedio'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000005'::uuid, 'Lucía Ferrer',
   'Guitarra, piano y escritura creativa',
   'Música de conservatorio y escritora. Enseño desde cero y sin solfeo obligatorio: primero tocas algo que te guste, y la teoría llega cuando la necesitas.',
   'basico'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000006'::uuid, 'Andrés Peña',
   'IELTS y TOEFL · estrategia de examen, no solo inglés',
   'Examinador certificado. Un examen de idioma se aprueba con técnica tanto como con vocabulario, y la técnica se entrena. Media de mis alumnos: +1.5 bandas en tres meses.',
   'avanzado'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000007'::uuid, 'Sofía Marín',
   'Diseño UI e ilustración digital',
   'Diseñadora de producto. Trabajamos con Figma sobre casos reales y salimos con piezas de portafolio, no con ejercicios que no puedes enseñar a nadie.',
   'intermedio'::public.teaching_level),
  ('11111111-0000-4000-8000-000000000008'::uuid, 'Tomás Aguilar',
   'Finanzas para emprendedores y oratoria',
   'Quince años entre banca y consultoría. Explico las finanzas de un negocio sin jerga, y entreno la presentación con la que hay que defenderlas delante de alguien.',
   'avanzado'::public.teaching_level)
)
insert into public.tutor_profiles (
  profile_id, display_name, headline, bio, teaching_level,
  approval_status, identity_verification_status, approved_at,
  tier_id
)
select
  d.profile_id, d.display_name, d.headline, d.bio, d.nivel,
  'approved'::public.tutor_approval_status,
  'approved'::public.identity_verification_status,
  now() - interval '30 days',
  (select id from public.tutor_tiers where is_default)    -- Tier 1 · 75 %
from datos d
on conflict (profile_id) do update set
  display_name                 = excluded.display_name,
  headline                     = excluded.headline,
  bio                          = excluded.bio,
  teaching_level               = excluded.teaching_level,
  approval_status              = excluded.approval_status,
  identity_verification_status = excluded.identity_verification_status,
  approved_at                  = excluded.approved_at,
  tier_id                      = coalesce(tutor_profiles.tier_id, excluded.tier_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · MENTORÍAS  (después de aprobar: `products_publish_guard` lo exige)
-- ════════════════════════════════════════════════════════════════════════════
-- Repartidas para que los filtros del catálogo tengan con qué trabajar:
-- las 10 categorías, los 3 modelos de precio, los 3 niveles, 3 idiomas y un
-- rango de 18 a 180 USD (la vista `tutors_public` alimenta el slider de DD-04).
--
-- `session_duration_min` NUNCA nulo: `get_available_slots` corta seco si lo es,
-- sin error y sin slots. Es el fallo silencioso más fácil de meter aquí.

-- ⚠️ `auto` (M-02, `products.auto_accept_bookings`) NO es decorado: sin él, las
-- 14 mentorías nacen con el default `true` de la columna y en dev NO EXISTE
-- ninguna reserva `pending_acceptance`. O sea: el filtro «Por aceptar» del
-- panel del tutor, la cuenta atrás de 24 h, `expire_stale_bookings` y el aviso
-- NTF-07 quedan sin datos con los que probarse. Se reparte a propósito, y a
-- propósito hay tutores con las dos cosas —Valentina filtra a mano quién entra
-- en su preparación de examen pero deja las clases sueltas automáticas—, que es
-- literalmente el caso que pidió el cliente y el que hace que un carrito de
-- varias mentorías se resuelva a medias.
with p(id, tutor, title, outcome, description, modelo, precio, dur, paquete, nivel, idioma, auto) as (values
  ('22222222-0000-4000-8000-000000000001'::uuid, '11111111-0000-4000-8000-000000000001'::uuid,
   'Álgebra y Cálculo desde cero',
   'entiendes de dónde sale cada fórmula y dejas de memorizar',
   'Repasamos desde lo que falló: operaciones con fracciones, factorización, funciones y límites. Cada sesión sale de un ejercicio tuyo, no de un temario cerrado.',
   'per_session'::public.pricing_model, 2500, 60, null::int, 'basico'::public.teaching_level, 'es', true),
  ('22222222-0000-4000-8000-000000000002'::uuid, '11111111-0000-4000-8000-000000000001'::uuid,
   'Preparación para examen de admisión',
   'llegas al examen con el temario cerrado y cronometrado',
   'Cuatro sesiones: diagnóstico, los dos bloques que más pesan y un simulacro completo con corrección. Incluye plan de estudio entre sesiones.',
   'per_package'::public.pricing_model, 9000, 60, 4, 'avanzado'::public.teaching_level, 'es', false),
  ('22222222-0000-4000-8000-000000000003'::uuid, '11111111-0000-4000-8000-000000000002'::uuid,
   'React y Next.js en proyectos reales',
   'publicas una app en producción y sabes por qué está montada así',
   'Componentes, estado, rutas y datos en el App Router. Trabajamos sobre tu proyecto: si no tienes uno, empezamos uno el primer día.',
   'per_hour'::public.pricing_model, 3000, 90, null, 'intermedio'::public.teaching_level, 'es', true),
  ('22222222-0000-4000-8000-000000000004'::uuid, '11111111-0000-4000-8000-000000000002'::uuid,
   'Code review y arquitectura',
   'aprendes a leer código ajeno y a defender tus decisiones',
   'Traes un repositorio y lo revisamos juntos línea a línea: qué está bien, qué te va a doler en seis meses y qué se arregla hoy en veinte minutos.',
   'per_session'::public.pricing_model, 4000, 60, null, 'avanzado'::public.teaching_level, 'en', false),
  ('22222222-0000-4000-8000-000000000005'::uuid, '11111111-0000-4000-8000-000000000003'::uuid,
   'Inglés conversacional para el trabajo',
   'sostienes una reunión en inglés sin preparártela palabra por palabra',
   'Ocho sesiones centradas en situaciones reales: presentarte, discrepar, pedir aclaraciones, negociar un plazo. Con grabación y correcciones por escrito.',
   'per_package'::public.pricing_model, 18000, 45, 8, 'basico'::public.teaching_level, 'en', true),
  ('22222222-0000-4000-8000-000000000006'::uuid, '11111111-0000-4000-8000-000000000003'::uuid,
   'Portugués para viajar',
   'te desenvuelves en Brasil o Portugal sin recurrir al inglés',
   'Lo imprescindible para moverte: aeropuerto, alojamiento, comida, imprevistos. Pronunciación desde el primer día, que es donde se atasca todo el mundo.',
   'per_session'::public.pricing_model, 1800, 45, null, 'basico'::public.teaching_level, 'pt', true),
  ('22222222-0000-4000-8000-000000000007'::uuid, '11111111-0000-4000-8000-000000000004'::uuid,
   'Física y Química de bachillerato',
   'apruebas y además entiendes qué estabas calculando',
   'Cinemática, dinámica, energía, estequiometría y disoluciones. Empezamos por el examen que suspendiste: ahí está escrito exactamente qué falta.',
   'per_session'::public.pricing_model, 2000, 45, null, 'intermedio'::public.teaching_level, 'es', false),
  ('22222222-0000-4000-8000-000000000008'::uuid, '11111111-0000-4000-8000-000000000005'::uuid,
   'Guitarra: de cero a tu primera canción',
   'tocas una canción entera de principio a fin',
   'Sin solfeo. Postura, acordes básicos, ritmo y cambios limpios. Eliges tú la canción y la desmontamos hasta que salga.',
   'per_session'::public.pricing_model, 2200, 60, null, 'basico'::public.teaching_level, 'es', true),
  ('22222222-0000-4000-8000-000000000009'::uuid, '11111111-0000-4000-8000-000000000005'::uuid,
   'Escritura creativa',
   'terminas un relato y sabes por qué funciona',
   'Voz, punto de vista, estructura y diálogo. Escribes entre sesiones y en clase corregimos tu texto, no ejemplos de manual.',
   'per_session'::public.pricing_model, 2400, 60, null, 'basico'::public.teaching_level, 'es', true),
  ('22222222-0000-4000-8000-000000000010'::uuid, '11111111-0000-4000-8000-000000000006'::uuid,
   'IELTS y TOEFL: estrategia de examen',
   'subes de banda sin necesidad de subir de nivel de inglés',
   'Cómo puntúa cada sección y qué espera el examinador. Speaking y writing con rúbrica en mano y corrección inmediata.',
   'per_hour'::public.pricing_model, 4000, 60, null, 'avanzado'::public.teaching_level, 'en', false),
  ('22222222-0000-4000-8000-000000000011'::uuid, '11111111-0000-4000-8000-000000000007'::uuid,
   'Diseño UI con Figma',
   'sales con tres pantallas de portafolio y un sistema de diseño propio',
   'Cuatro sesiones: fundamentos, componentes y variantes, prototipo y presentación. Trabajamos un caso real de principio a fin.',
   'per_package'::public.pricing_model, 9500, 90, 4, 'intermedio'::public.teaching_level, 'es', true),
  ('22222222-0000-4000-8000-000000000012'::uuid, '11111111-0000-4000-8000-000000000008'::uuid,
   'Finanzas para emprendedores',
   'lees tus números y sabes cuánto te queda de caja',
   'Margen, punto de equilibrio, flujo de caja y precios. Sin jerga y con tu propia hoja de cálculo encima de la mesa.',
   'per_hour'::public.pricing_model, 5500, 60, null, 'avanzado'::public.teaching_level, 'es', false),
  ('22222222-0000-4000-8000-000000000013'::uuid, '11111111-0000-4000-8000-000000000008'::uuid,
   'Comunicación y oratoria',
   'presentas sin leer las diapositivas y sin quedarte en blanco',
   'Estructura del mensaje, control de los nervios y manejo de preguntas difíciles. Grabamos y revisamos: verte es la mitad del trabajo.',
   'per_session'::public.pricing_model, 3500, 45, null, 'intermedio'::public.teaching_level, 'es', true),
  ('22222222-0000-4000-8000-000000000014'::uuid, '11111111-0000-4000-8000-000000000007'::uuid,
   'Ilustración digital: primeros trazos',
   'terminas tu primera ilustración completa y sabes repetir el proceso',
   'Boceto, línea, color y luz con tableta. Del garabato a la pieza acabada, explicando cada decisión.',
   'per_session'::public.pricing_model, 2600, 60, null, 'basico'::public.teaching_level, 'es', true)
)
insert into public.products (
  id, tutor_id, title, outcome, description, pricing_model, price_amount,
  currency, session_duration_min, package_num_sessions, status, level, language,
  auto_accept_bookings
)
select
  p.id, p.tutor, p.title, p.outcome, p.description, p.modelo, p.precio,
  'USD', p.dur, p.paquete, 'active'::public.product_status, p.nivel, p.idioma,
  p.auto
from p
on conflict (id) do update set
  title                = excluded.title,
  outcome              = excluded.outcome,
  description          = excluded.description,
  pricing_model        = excluded.pricing_model,
  price_amount         = excluded.price_amount,
  session_duration_min = excluded.session_duration_min,
  package_num_sessions = excluded.package_num_sessions,
  status               = excluded.status,
  level                = excluded.level,
  language             = excluded.language,
  auto_accept_bookings = excluded.auto_accept_bookings;


-- ── 4a bis · Requerimientos de sesión (`20260828143000`) ─────────────────────
-- Lo que el ALUMNO tiene que traer. Va en un `update` aparte y no como columna
-- del `values` de arriba para no reescribir las 14 filas por un campo opcional
-- —y porque el interés en dev es tener las DOS caras: mentorías que piden algo
-- y mentorías que no piden nada, que es como se comprueba que la sección
-- desaparece en vez de quedarse vacía—.
--
-- Tres mentorías con requisitos de tres formas distintas: material físico, algo
-- que hay que instalar antes, y una condición del sitio desde donde se conecta.
update public.products set requirements = '[
  "Papel y lápiz: los ejercicios se hacen a mano, no en el chat",
  "Calculadora científica (vale la del móvil)"
]'::jsonb where id = '22222222-0000-4000-8000-000000000001';

update public.products set requirements = '[
  "Un portátil o sobremesa: desde el móvil no se puede programar",
  "Node.js 20 o superior y un editor instalados antes de la primera sesión",
  "Cuenta de GitHub"
]'::jsonb where id = '22222222-0000-4000-8000-000000000003';

update public.products set requirements = '[
  "Tableta gráfica (cualquier modelo con lápiz)",
  "Un sitio con buena luz y, si hace calor, ventilador: son 60 min seguidos"
]'::jsonb where id = '22222222-0000-4000-8000-000000000014';


-- ── 4b · Categorías, resueltas por slug (patrón de ep03-demo.sql) ────────────
insert into public.product_categories (product_id, category_id)
select v.product_id, c.id
  from (values
    ('22222222-0000-4000-8000-000000000001'::uuid, 'matematicas'),
    ('22222222-0000-4000-8000-000000000002'::uuid, 'preparacion-examenes'),
    ('22222222-0000-4000-8000-000000000002'::uuid, 'matematicas'),
    ('22222222-0000-4000-8000-000000000003'::uuid, 'programacion'),
    ('22222222-0000-4000-8000-000000000004'::uuid, 'programacion'),
    ('22222222-0000-4000-8000-000000000005'::uuid, 'idiomas'),
    ('22222222-0000-4000-8000-000000000006'::uuid, 'idiomas'),
    ('22222222-0000-4000-8000-000000000007'::uuid, 'ciencias'),
    ('22222222-0000-4000-8000-000000000008'::uuid, 'musica'),
    ('22222222-0000-4000-8000-000000000009'::uuid, 'vida-y-creatividad'),
    ('22222222-0000-4000-8000-000000000010'::uuid, 'preparacion-examenes'),
    ('22222222-0000-4000-8000-000000000010'::uuid, 'idiomas'),
    ('22222222-0000-4000-8000-000000000011'::uuid, 'arte-y-diseno'),
    ('22222222-0000-4000-8000-000000000012'::uuid, 'negocios'),
    ('22222222-0000-4000-8000-000000000013'::uuid, 'habilidades-profesionales'),
    ('22222222-0000-4000-8000-000000000014'::uuid, 'arte-y-diseno')
  ) as v(product_id, slug)
  join public.categories c on c.slug = v.slug
on conflict do nothing;

-- Las categorías que el tutor declara en su perfil (TU01 p2), derivadas de las
-- de sus productos: así el perfil no contradice al catálogo.
insert into public.tutor_categories (tutor_id, category_id)
select distinct pr.tutor_id, pc.category_id
  from public.product_categories pc
  join public.products pr on pr.id = pc.product_id
 where pr.tutor_id::text like '11111111-0000-4000-8000-%'
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · DISPONIBILIDAD — la pieza que no existía
-- ════════════════════════════════════════════════════════════════════════════
-- weekday: 0=domingo … 6=sábado (coincide con extract(dow), Doc 1 §1.4.8).
--
-- Ventanas de 4 h a propósito. `get_available_slots` trocea la franja en pasos
-- de `session_duration_min`, así que una ventana más corta que la mentoría más
-- larga del tutor produce CERO slots para esa mentoría — en silencio. Con 4 h
-- caben hasta las de 90 min.
--
-- Entre los ocho se cubren los siete días de la semana, y nadie baja de tres
-- días: con la ventana de 21 días que mira el buscador, siempre hay hueco.

insert into public.availability_rules (id, tutor_id, weekday, start_time, end_time)
values
  -- Valentina · mañanas entre semana + viernes tarde
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 1, '09:00', '13:00'),
  ('33333333-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 3, '09:00', '13:00'),
  ('33333333-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000001', 5, '14:00', '18:00'),
  -- Mateo · noches y sábado por la mañana (mentorías de 90 min)
  ('33333333-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000002', 2, '18:00', '22:00'),
  ('33333333-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000002', 4, '18:00', '22:00'),
  ('33333333-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000002', 6, '10:00', '14:00'),
  -- Camila · cuatro mañanas temprano
  ('33333333-0000-4000-8000-000000000007', '11111111-0000-4000-8000-000000000003', 1, '07:00', '11:00'),
  ('33333333-0000-4000-8000-000000000008', '11111111-0000-4000-8000-000000000003', 2, '07:00', '11:00'),
  ('33333333-0000-4000-8000-000000000009', '11111111-0000-4000-8000-000000000003', 3, '07:00', '11:00'),
  ('33333333-0000-4000-8000-000000000010', '11111111-0000-4000-8000-000000000003', 4, '07:00', '11:00'),
  -- Diego · tardes y domingo
  ('33333333-0000-4000-8000-000000000011', '11111111-0000-4000-8000-000000000004', 3, '15:00', '19:00'),
  ('33333333-0000-4000-8000-000000000012', '11111111-0000-4000-8000-000000000004', 5, '15:00', '19:00'),
  ('33333333-0000-4000-8000-000000000013', '11111111-0000-4000-8000-000000000004', 0, '10:00', '14:00'),
  -- Lucía · tardes y sábado (horario de Madrid)
  ('33333333-0000-4000-8000-000000000014', '11111111-0000-4000-8000-000000000005', 2, '16:00', '20:00'),
  ('33333333-0000-4000-8000-000000000015', '11111111-0000-4000-8000-000000000005', 4, '16:00', '20:00'),
  ('33333333-0000-4000-8000-000000000016', '11111111-0000-4000-8000-000000000005', 6, '11:00', '15:00'),
  -- Andrés · mañanas L-X-V
  ('33333333-0000-4000-8000-000000000017', '11111111-0000-4000-8000-000000000006', 1, '08:00', '12:00'),
  ('33333333-0000-4000-8000-000000000018', '11111111-0000-4000-8000-000000000006', 3, '08:00', '12:00'),
  ('33333333-0000-4000-8000-000000000019', '11111111-0000-4000-8000-000000000006', 5, '08:00', '12:00'),
  -- Sofía · mediodías y domingo tarde (mentorías de 90 min)
  ('33333333-0000-4000-8000-000000000020', '11111111-0000-4000-8000-000000000007', 2, '13:00', '17:00'),
  ('33333333-0000-4000-8000-000000000021', '11111111-0000-4000-8000-000000000007', 4, '13:00', '17:00'),
  ('33333333-0000-4000-8000-000000000022', '11111111-0000-4000-8000-000000000007', 0, '15:00', '19:00'),
  -- Tomás · noches y sábado
  ('33333333-0000-4000-8000-000000000023', '11111111-0000-4000-8000-000000000008', 1, '17:00', '21:00'),
  ('33333333-0000-4000-8000-000000000024', '11111111-0000-4000-8000-000000000008', 3, '17:00', '21:00'),
  ('33333333-0000-4000-8000-000000000025', '11111111-0000-4000-8000-000000000008', 5, '17:00', '21:00'),
  ('33333333-0000-4000-8000-000000000026', '11111111-0000-4000-8000-000000000008', 6, '09:00', '13:00')
on conflict (id) do update set
  weekday    = excluded.weekday,
  start_time = excluded.start_time,
  end_time   = excluded.end_time,
  is_active  = true;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · HISTORIAL: reservas completadas que sostienen las reseñas
-- ════════════════════════════════════════════════════════════════════════════
-- Los snapshots financieros se escriben a mano porque aquí no se pasa por
-- `create_booking` (mismo criterio que ep09-demo-reviews.sql: esto corre como
-- superusuario, no es el flujo del cliente).
--
-- `provider = 'simulated'` a propósito aunque dev esté ruteado a Stripe: son
-- pagos históricos de mentira, no deben aparecer nunca en el panel de Stripe.
--
-- Solo mentorías de sesión única (nada de paquetes): una reserva, una sesión.
-- `dias` es único por tutor — el índice `sessions(tutor_id, start_at)` cuenta
-- las 'completed', así que dos reseñas del mismo tutor el mismo día chocarían.

-- OJO con el `on commit drop` de toda la vida: sin transacción alrededor, cada
-- sentencia es su propia transacción, así que la tabla moriría al terminar el
-- propio CREATE y las tres sentencias siguientes no encontrarían nada. Se
-- borra a mano al final de la sección 7.
drop table if exists _resenas;
create temporary table _resenas (
  booking_id uuid, product_id uuid, student_id uuid,
  rating smallint, comentario text, dias int
);

insert into _resenas values
  -- Valentina (mentoría 01)
  ('55555555-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001',5,'Llevaba dos años arrastrando el álgebra y en cuatro clases dejé de tenerle miedo. Explica el porqué, no la receta.',41),
  ('55555555-0000-4000-8000-000000000002','22222222-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000002',5,'Puntual, preparada y con paciencia infinita. Me mandaba ejercicios entre sesiones y los corregía uno a uno.',33),
  ('55555555-0000-4000-8000-000000000003','22222222-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000003',4,'Muy buena profesora. Le pondría cinco si las clases fueran algo más largas, se me hacían cortas.',22),
  -- Mateo (mentorías 03 y 04)
  ('55555555-0000-4000-8000-000000000004','22222222-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000002',5,'Revisamos mi proyecto de verdad, no un ejemplo. Salí con la app desplegada y entendiendo cada decisión.',38),
  ('55555555-0000-4000-8000-000000000005','22222222-0000-4000-8000-000000000004','44444444-0000-4000-8000-000000000004',5,'El code review más útil que me han hecho. Señaló cosas que llevaban meses ahí y ni las veía.',29),
  ('55555555-0000-4000-8000-000000000006','22222222-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000001',4,'Sabe muchísimo y se nota. A veces va rápido, pero si le pides que pare lo repite sin problema.',17),
  -- Camila (mentoría 06)
  ('55555555-0000-4000-8000-000000000007','22222222-0000-4000-8000-000000000006','44444444-0000-4000-8000-000000000003',5,'Empezamos hablando desde el primer minuto. Fui a Lisboa un mes después y me defendí sin inglés.',44),
  ('55555555-0000-4000-8000-000000000008','22222222-0000-4000-8000-000000000006','44444444-0000-4000-8000-000000000004',5,'Corrige la pronunciación sin cortarte el ritmo, que es justo lo difícil. Encantado.',26),
  ('55555555-0000-4000-8000-000000000009','22222222-0000-4000-8000-000000000006','44444444-0000-4000-8000-000000000001',4,'Muy buena clase y muy amena. El material que comparte después vale tanto como la sesión.',15),
  -- Diego (mentoría 07)
  ('55555555-0000-4000-8000-000000000010','22222222-0000-4000-8000-000000000007','44444444-0000-4000-8000-000000000004',5,'Cogimos mi examen suspenso y lo desmontamos entero. Aprobé la recuperación con un 8.',36),
  ('55555555-0000-4000-8000-000000000011','22222222-0000-4000-8000-000000000007','44444444-0000-4000-8000-000000000002',4,'Explica muy claro la parte de dinámica. En química me costó más seguirle el ritmo.',24),
  ('55555555-0000-4000-8000-000000000012','22222222-0000-4000-8000-000000000007','44444444-0000-4000-8000-000000000003',5,'Le tenía pánico a la física y me la ha hecho entretenida. No sabía que era posible.',11),
  -- Lucía (mentorías 08 y 09)
  ('55555555-0000-4000-8000-000000000013','22222222-0000-4000-8000-000000000008','44444444-0000-4000-8000-000000000001',5,'En la tercera clase toqué la canción entera. Nunca había cogido una guitarra.',40),
  ('55555555-0000-4000-8000-000000000014','22222222-0000-4000-8000-000000000009','44444444-0000-4000-8000-000000000003',5,'Corrige tu texto, no te da teoría genérica. Terminé el relato que llevaba dos años empezado.',31),
  ('55555555-0000-4000-8000-000000000015','22222222-0000-4000-8000-000000000008','44444444-0000-4000-8000-000000000004',4,'Muy maja y muy clara. Los dedos duelen igual, pero eso no es culpa suya.',19),
  -- Andrés (mentoría 10)
  ('55555555-0000-4000-8000-000000000016','22222222-0000-4000-8000-000000000010','44444444-0000-4000-8000-000000000002',5,'Pasé de 6.0 a 7.5 en dos meses sin mejorar mi inglés: mejoré cómo me presento al examen.',43),
  ('55555555-0000-4000-8000-000000000017','22222222-0000-4000-8000-000000000010','44444444-0000-4000-8000-000000000003',5,'Te enseña la rúbrica y te corrige con ella delante. Se acabó adivinar qué querían.',28),
  ('55555555-0000-4000-8000-000000000018','22222222-0000-4000-8000-000000000010','44444444-0000-4000-8000-000000000001',3,'Muy buen contenido, pero tuvimos problemas de conexión dos veces y perdimos tiempo.',13),
  -- Sofía (mentoría 14)
  ('55555555-0000-4000-8000-000000000019','22222222-0000-4000-8000-000000000014','44444444-0000-4000-8000-000000000004',5,'Salí con una ilustración terminada y, más importante, sabiendo cómo repetir el proceso.',37),
  ('55555555-0000-4000-8000-000000000020','22222222-0000-4000-8000-000000000014','44444444-0000-4000-8000-000000000001',4,'Explica muy bien el color. Me habría gustado más práctica de línea, pero es cuestión de pedirlo.',25),
  ('55555555-0000-4000-8000-000000000021','22222222-0000-4000-8000-000000000014','44444444-0000-4000-8000-000000000002',5,'Justifica cada decisión de diseño en vez de darte una plantilla. Se aprende muchísimo más.',12),
  -- Tomás (mentorías 12 y 13)
  ('55555555-0000-4000-8000-000000000022','22222222-0000-4000-8000-000000000012','44444444-0000-4000-8000-000000000003',5,'Entendí el flujo de caja de mi negocio en una sesión. Llevaba un año mirando la hoja sin verlo.',39),
  ('55555555-0000-4000-8000-000000000023','22222222-0000-4000-8000-000000000013','44444444-0000-4000-8000-000000000002',5,'Grabarme y revisarlo con él fue incómodo y utilísimo. Presenté al comité sin leer una diapositiva.',27),
  ('55555555-0000-4000-8000-000000000024','22222222-0000-4000-8000-000000000012','44444444-0000-4000-8000-000000000004',4,'Muy claro con los números. Va directo al grano, que es lo que buscaba.',14);

-- Reservas. El total sale del modelo de precio, igual que `create_booking`
-- (RN-10): por hora se multiplica por la duración, el resto es el precio tal cual.
insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount,
  tier_split_pct, payee_country, completed_at, created_at, updated_at
)
select
  r.booking_id, r.student_id, r.product_id, p.tutor_id,
  'completed'::public.booking_status, p.pricing_model, 1,
  p.session_duration_min, p.currency,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  75.00, 'VE',
  now() - make_interval(days => r.dias),
  now() - make_interval(days => r.dias + 3),
  now() - make_interval(days => r.dias)
from _resenas r
join public.products p on p.id = r.product_id
on conflict (id) do nothing;

insert into public.payments (
  booking_id, status, currency, gross_amount, platform_fee_amount,
  tutor_net_amount, tier_split_pct, payee_country, provider, paid_at, created_at
)
select
  b.id, 'paid'::public.payment_status, b.currency, b.total_amount,
  b.total_amount - round(b.total_amount * 0.75)::bigint,   -- comisión de plataforma
  round(b.total_amount * 0.75)::bigint,                    -- neto del tutor (Tier 1)
  75.00, 'VE', 'simulated',
  b.created_at, b.created_at
from public.bookings b
where b.id::text like '55555555-0000-4000-8000-%'
on conflict (booking_id) do nothing;

-- Una sesión por reserva, en el pasado y a una hora redonda. `start_at` va a
-- las 10:00 UTC del día correspondiente: distinto `dias` por tutor garantiza
-- que no chocan con el índice único de doble reserva.
insert into public.sessions (
  booking_id, tutor_id, student_id, sequence_no,
  start_at, end_at, status, completed_at, created_at
)
select
  b.id, b.tutor_id, b.student_id, 1,
  date_trunc('day', b.completed_at) + interval '10 hours',
  date_trunc('day', b.completed_at) + interval '10 hours'
    + make_interval(mins => b.session_duration_min),
  'completed'::public.session_status,
  b.completed_at, b.created_at
from public.bookings b
where b.id::text like '55555555-0000-4000-8000-%'
  and not exists (select 1 from public.sessions s where s.booking_id = b.id);


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · RESEÑAS  (el trigger reviews_refresh_rating recalcula el rating solo)
-- ════════════════════════════════════════════════════════════════════════════

insert into public.reviews (id, booking_id, student_id, tutor_id, product_id, rating, comment, created_at)
select
  overlay(r.booking_id::text placing '66666666' from 1 for 8)::uuid,
  r.booking_id, r.student_id, p.tutor_id, r.product_id,
  r.rating, r.comentario,
  now() - make_interval(days => r.dias - 1)
from _resenas r
join public.products p on p.id = r.product_id
on conflict (booking_id) do nothing;

drop table _resenas;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — CÓRRELA APARTE, NO LA DEJES AQUÍ SUELTA
-- ════════════════════════════════════════════════════════════════════════════
-- Va comentada a propósito. Un `select` al final de este archivo es justo lo
-- que enmascaró el primer fallo: devolvía 0 filas tan tranquilo mientras el
-- error de verdad estaba veinte sentencias más arriba (ver la cabecera).
--
-- Cópialas a una pestaña nueva del editor y córrelas ahí, DESPUÉS de que este
-- archivo haya terminado sin quejarse.
--
-- ── 1. La prueba que separa este seed de los siete anteriores ───────────────
-- TODA mentoría sembrada tiene que devolver slots. La que salga en 0 está en
-- el catálogo pero no se puede reservar, que es el estado del que veníamos.
--
--   select
--     p.title,
--     p.session_duration_min as dur,
--     (select count(*) from public.get_available_slots(p.id, current_date, current_date + 21)) as slots
--   from public.products p
--   where p.id::text like '22222222-0000-4000-8000-%'
--   order by slots asc, p.title;
--
-- Se esperan 14 filas y ninguna con slots = 0.
--
-- ── 2. El catálogo: los 8 con precio y con reseñas ─────────────────────────
--
--   select display_name, price_from, rating_avg, rating_count
--     from public.tutors_public
--    where profile_id::text like '11111111-0000-4000-8000-%'
--    order by display_name;
