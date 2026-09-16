-- ============================================================================
-- Enséñame Ya — LAS DOS CUENTAS DEL CLIENTE.  ⚠️  SOLO DEV — NO a producción.
--
--   nestor@ensenameya.com  → Néstor Ramírez   · America/Bogota      (CO)
--   isabel@ensenameya.com  → Isabella Moreno  · America/Mexico_City (MX)
--   contraseña de las dos: Ensename2026!
--
-- Esto es `dev-emilio.sql` parametrizado a dos personas: las mismas secciones,
-- los mismos estados, envueltos en un `values` de dos filas. Cada una queda con
-- los TRES roles —alumno, tutor y admin— a la vez, así que el cliente prueba la
-- plataforma entera sin cambiar de sesión: el switch «Aprender / Enseñar» del
-- menú de cuenta sale siempre (`panelsFor`, lib/auth/roles.ts) y /admin también.
--
-- Qué deja en CADA UNA:
--   TUTOR  · perfil aprobado + los 6 documentos de C-14, 7 mentorías (4 activas,
--            1 paquete, 1 borrador, 1 en pausa), disponibilidad 5 días,
--            12 reservas en 5 estados, 5 reseñas recibidas, saldo con retención,
--            un payout pagado, preferencia de cobro y cuenta bancaria.
--   ALUMNO · 8 reservas con 8 tutores distintos, 2 reseñas dejadas y 2 pendientes
--            de dejar (el CTA de reseña), pagos e intereses.
--   ADMIN  · el rol, y nada más: /admin se alimenta de los datos de todos.
--   AMBOS  · 3 conversaciones de chat y 6 avisos de campana.
--
-- 🔴 ESTO MANDA CORREO DE VERDAD, Y ES A PROPÓSITO.
-- Son direcciones reales del cliente y él pidió usarlas tal cual. Sembrar deja
-- en `notifications` una cola con `channel = 'email'` que apunta a sus buzones,
-- porque hay cuatro triggers AFTER **INSERT** en el camino:
--   · NTF-24 «bienvenida al alumno» ×1 — `handle_new_user`, en el INSERT de
--     `auth.users` (`email_confirmed_at` ya viene puesto).
--   · NTF-25 «bienvenida al tutor»  ×1 — trigger de `tutor_profiles`
--     (`20260911200000:217-219`).
--   · NTF-26 «tienes una reseña»    ×5 — trigger `reviews_zz_notify_tutor`, una
--     por cada reseña recibida de la §5.
--   · NTF-21 «mensaje nuevo»        ×~2 — trigger `notifications_on_message`,
--     agrupado por hilo y hora (§8).
-- ⚠️ El comentario de `dev-emilio.sql:85-88` —«insertándolo aprobado no se
-- encola ni un correo»— describe el mundo ANTERIOR al Doc 33 y hoy es falso.
--
-- Nada sale solo: salen cuando alguien corra `/api/cron/notifications-send`, y
-- solo si RESEND_API_KEY está puesta. Para verlas antes, la comprobación 3 del
-- final. Para que NO salgan, marcarlas `failed` ANTES de correr el job:
--   update public.notifications set status = 'failed'
--    where channel = 'email' and status = 'pending'
--      and recipient_id in (select id from auth.users
--                            where email in ('nestor@ensenameya.com','isabel@ensenameya.com'));
--
-- DEPENDE de `dev-poblar.sql`: los alumnos (44444444-…) y las mentorías de los
-- otros tutores (22222222-…) salen de ahí. Lo que no encuentre NO se inserta
-- —va por `join`, no por literal—, así que degrada en vez de reventar.
--
-- Cómo aplicarlo:
--   npx supabase db query --linked --file supabase/seed/dev-nestor-isabel.sql
--   ⚠️ Esa vía es TRANSACCIONAL: un fallo en la última sentencia tumba las
--   anteriores y no queda nada. Para DEPURAR, pégalo entero en el SQL Editor de
--   Supabase (dev), que se para en la sentencia culpable y la enseña.
--
-- Idempotente: ids fijos + `on conflict`. Reejecutable sin duplicar.
--
-- Espacio de nombres PROPIO — no se solapa con `ea0000xx-` (dev-emilio) ni con
-- `88888888-00xx-` (Doc 34). No es cosmética: el §0b del Doc 34 borra POR PATRÓN
-- de uuid, y un solape convierte su limpieza en un borrado cruzado.
--   aa000000-… las cuentas   aa000001-… mentorías     aa000002-… disponibilidad
--   aa000003-… reservas(tutor)  aa000004-… reservas(alumno)  aa000005-… sesiones
--   aa000006-… payouts       aa000007-… chat          aa000008-… reseñas
--   aa000009-… avisos
-- Dentro de cada uno, los 4 dígitos que siguen a `8000-` son la PERSONA
-- (0001 = Néstor, 0002 = Isabella) y los 8 últimos, la fila.
--
-- ⚠️ SIN TRANSACCIÓN, a propósito: mismo criterio que dev-poblar.sql y
-- dev-emilio.sql. En el SQL Editor un `begin/commit` vuelve invisible un error a
-- mitad, que ya costó tres vueltas.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;


-- ════════════════════════════════════════════════════════════════════════════
-- 0 · LAS DOS CUENTAS
-- ════════════════════════════════════════════════════════════════════════════
-- Toda la parametrización del fichero vive en esta tabla. `hora` es la hora UTC
-- a la que empiezan SUS sesiones y no es un detalle de estilo: ver la §5.
drop table if exists _ey_cuentas;
create temporary table _ey_cuentas (
  p        int primary key,   -- 1 · 2 — el discriminador de todos los uuid
  uid      uuid,              -- propuesto; abajo se RE-RESUELVE contra auth.users
  email    text,
  nombre   text,
  apellido text,
  tz       text,
  hora     int,               -- hora UTC de sus sesiones (§5)
  doc      text,              -- documento fiscal para la cuenta de cobro (§6)
  clave    text,              -- prefijo de idempotency_key de sus avisos (§9)
  headline text,
  bio      text
);

insert into _ey_cuentas values
  (1, 'aa000000-0000-4000-8000-000100000000',
   'nestor@ensenameya.com', 'Néstor', 'Ramírez', 'America/Bogota', 18,
   'CO1234567', 'ey-nestor',
   'Inglés de negocios, TOEFL y finanzas para quien ya trabaja',
   'Doce años entre consultoría y formación corporativa. Doy clase a gente que necesita el idioma o los números para el lunes, no para un examen abstracto: trabajamos sobre tus correos, tus reuniones y tus hojas de cálculo. Certificado TOEFL iBT y MBA.'),

  (2, 'aa000000-0000-4000-8000-000200000000',
   'isabel@ensenameya.com', 'Isabella', 'Moreno', 'America/Mexico_City', 21,
   'MX7654321', 'ey-isabella',
   'Preparación de exámenes y comunicación profesional en inglés',
   'Quince años dando clase a adultos que vuelven a estudiar con poco tiempo. Trabajo con la rúbrica del examen delante desde la primera sesión y con material tuyo, no de libro: el avance se nota en semanas, no en cursos.');

-- El alta, con el patrón de dev-poblar.sql. ⚠️ Sin la fila en `auth.identities`
-- el usuario existe, la contraseña es correcta y el login falla igual — en
-- silencio y sin pista: GoTrue resuelve el login por identidad, no por
-- `encrypted_password`.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
select
  c.uid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  c.email,
  extensions.crypt('Ensename2026!', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', c.nombre || ' ' || c.apellido, 'timezone', c.tz),
  now() - interval '90 days', now(),
  '', '', '', '', '', ''
from _ey_cuentas c
where not exists (
  select 1 from auth.users u where lower(u.email) = lower(c.email)
);

-- ⚠️ El uuid de arriba es una PROPUESTA, no un hecho: si alguien ya registró
-- esa dirección por la app, el `where not exists` no insertó nada y su id es
-- otro. Todo lo que sigue cuelga de `c.uid`, así que se re-resuelve contra
-- `auth.users` y el fichero funciona en los dos casos. Lo contrario son FK
-- violadas —o peor, filas colgando de un uuid que no es de nadie—.
update _ey_cuentas c
   set uid = u.id
  from auth.users u
 where lower(u.email) = lower(c.email);

do $$
begin
  if exists (select 1 from _ey_cuentas where uid is null) then
    raise exception 'Sección 0: alguna de las dos cuentas no llegó a auth.users. Mira el INSERT de arriba antes de seguir.';
  end if;
end $$;

-- Repone contraseña y confirmación por si la cuenta ya existía (registrada por
-- la app, o con Google). No le quita el Google: le añade la vía de contraseña
-- al lado, que es como funciona el account linking de Supabase.
-- El `email_confirmed_at` dispara `notify_email_confirmed` → NTF-24, pero
-- comparte clave con la del alta (`NTF-24:welcome:<uuid>`), así que no duplica.
update auth.users u
   set encrypted_password = extensions.crypt('Ensename2026!', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(u.email_confirmed_at, now())
  from _ey_cuentas c
 where u.id = c.uid;

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
join _ey_cuentas c on c.uid = u.id
on conflict (provider_id, provider) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · PERFIL Y ROLES
-- ════════════════════════════════════════════════════════════════════════════
-- `handle_new_user` ya dejó el perfil con nombre y zona horaria; esto lo repone
-- si la cuenta venía de antes y pone `onboarding_complete`.
update public.profiles p
   set full_name           = c.nombre || ' ' || c.apellido,
       timezone            = c.tz,
       onboarding_complete = true
  from _ey_cuentas c
 where p.id = c.uid;

-- Los DOS roles que no pone nadie solo:
--   `alumno` lo inserta `handle_new_user` en el alta — no se toca aquí.
--   `tutor`  normalmente lo concede `review_tutor()`, pero esa RPC encola NTF-03
--            y la cola HOY ENVÍA DE VERDAD. Saltársela obliga a acordarse del
--            rol: es lo que le pasó al fixture `tutor.us401`, aprobado por SQL y
--            sin rol nunca. Aprobar por SQL son SIEMPRE dos escrituras —el
--            `approval_status` de la §2 y esta fila—.
--   `admin`  es el patrón de `supabase/seed/admin-bootstrap.sql`: `user_roles`
--            no tiene políticas de escritura a propósito (RN-31/S-31), así que
--            el alta de admin va por fuera del cliente, siempre.
insert into public.user_roles (user_id, role)
select c.uid, r.role::public.app_role
  from _ey_cuentas c
  cross join (values ('tutor'), ('admin')) as r(role)
on conflict do nothing;

-- Intereses del alumno (los chips de /app).
insert into public.student_interests (student_id, category_id)
select c.uid, cat.id
  from _ey_cuentas c
  join public.categories cat on cat.slug in ('idiomas', 'negocios', 'preparacion-examenes')
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · PERFIL DE TUTOR — aprobado de una vez
-- ════════════════════════════════════════════════════════════════════════════
-- Entra ya en 'approved' en el INSERT y no con un UPDATE posterior:
-- `notify_tutor_profile` (el del resultado del KYC) es AFTER UPDATE, así que
-- insertándolo aprobado no se encola ese correo. El de bienvenida NTF-25 sí
-- sale — cuelga del INSERT — y es lo que avisa la cabecera.
--
-- `payout_country` se escribe explícito con la MISMA función que usa el trigger
-- `profiles_sincroniza_pais_de_cobro`. El trigger no sirve aquí: corre sobre
-- `profiles` y en la §1 esta tabla todavía no existía, así que no habría tocado
-- nada y el país se quedaría nulo → ruteo de payout a la fila 'simulated'.
insert into public.tutor_profiles (
  profile_id, display_name, headline, bio, teaching_level,
  approval_status, identity_verification_status, approved_at,
  payout_country, tier_id, faqs
)
select
  c.uid,
  c.nombre || ' ' || c.apellido,
  c.headline,
  c.bio,
  'intermedio'::public.teaching_level,
  'approved'::public.tutor_approval_status,
  'approved'::public.identity_verification_status,
  now() - interval '60 days',
  public.pais_de_cobro_por_zona(c.tz),
  (select id from public.tutor_tiers where is_default),
  '[
    {"q":"¿Necesito un nivel mínimo de inglés para empezar?","a":"No. En la primera sesión hacemos una prueba corta de 10 minutos y armamos el plan desde ahí. Tengo alumnos que empezaron sin poder presentarse."},
    {"q":"¿Qué pasa si tengo que cancelar por trabajo?","a":"Cancelando con más de 24 horas se reprograma sin coste. Con menos, se pierde la sesión: el hueco ya no lo puede tomar nadie más."},
    {"q":"¿Me mandas material entre clases?","a":"Sí, y es la mitad del avance. Cada sesión termina con dos o tres tareas cortas que reviso antes de la siguiente."},
    {"q":"¿Puedo grabar las sesiones?","a":"Se graban siempre y las tienes disponibles unos días. Te aviso al empezar, no hay letra pequeña."}
  ]'::jsonb
from _ey_cuentas c
on conflict (profile_id) do update set
  display_name                 = excluded.display_name,
  headline                     = excluded.headline,
  bio                          = excluded.bio,
  teaching_level               = excluded.teaching_level,
  approval_status              = excluded.approval_status,
  identity_verification_status = excluded.identity_verification_status,
  approved_at                  = excluded.approved_at,
  payout_country               = excluded.payout_country,
  faqs                         = excluded.faqs,
  tier_id                      = coalesce(tutor_profiles.tier_id, excluded.tier_id);

-- Los 6 documentos de C-14, los seis APROBADOS.
-- ⚠️ Esta tabla MANDA sobre `identity_verification_status`: un trigger lo
-- recalcula desde aquí (`20260715120000`) y pisa lo que pusiera el insert de
-- arriba. Un solo documento `rejected` volvería la identidad entera `rejected`,
-- así que los seis van aprobados o el perfil sale incoherente.
insert into public.verification_documents (
  tutor_id, doc_type, storage_path, status, reviewed_at, reviewed_by, created_at
)
select
  c.uid, d.doc_type,
  c.uid::text || '/' || d.doc_type,
  'approved'::public.document_status,
  now() - interval '60 days',
  (select id from auth.users where email = 'admin.us1101@ensenameya.dev'),
  now() - interval '63 days'
from _ey_cuentas c
cross join (values ('cv'),('degree'),('id_document'),('certificate'),('diploma'),('transcript'))
     as d(doc_type)
where not exists (
  select 1 from public.verification_documents v
   where v.tutor_id = c.uid and v.doc_type = d.doc_type
);


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · MENTORÍAS  (después de aprobar: `products_publish_guard` lo exige)
-- ════════════════════════════════════════════════════════════════════════════
-- El orden de las secciones NO es cosmético: el guard mira el perfil aprobado
-- ANTES de dejar insertar una mentoría publicable.
--
-- `session_duration_min` NUNCA nulo: `get_available_slots` corta seco si lo es,
-- sin error y sin slots. Es el fallo silencioso más fácil de meter aquí.
--
-- La 04 nace con `auto_accept_bookings = false` a propósito: sin una mentoría de
-- aceptación manual NO existe ninguna reserva `pending_acceptance`, y el filtro
-- «Por aceptar» del panel, la cuenta atrás de 24 h y NTF-07 se quedan sin datos
-- con los que probarse.
insert into public.products (
  id, tutor_id, title, outcome, description, pricing_model, price_amount,
  session_duration_min, package_num_sessions, level, language, currency,
  status, auto_accept_bookings, created_at
)
select
  ('aa000001-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(m.n::text, 8, '0'))::uuid,
  c.uid, m.title, m.outcome, m.description,
  m.pricing_model::public.pricing_model, m.price_amount,
  m.session_duration_min, m.package_num_sessions,
  m.level::public.teaching_level, m.language, 'USD',
  m.status::public.product_status, m.auto_accept,
  now() - make_interval(days => m.dias)
from _ey_cuentas c
cross join (values
  (1, 'Inglés de negocios para reuniones',
      'diriges una reunión en inglés sin leer un guion',
      'Trabajamos sobre tus reuniones reales: cómo abrir, cómo interrumpir sin sonar brusco, cómo pedir una aclaración. Grabamos un rol-play cada sesión y lo revisamos juntos.',
      'per_session', 3200::bigint, 60, null::int, 'intermedio', 'en', 'active', true, 58),
  (2, 'Preparación TOEFL iBT intensiva',
      'sabes qué pide la rúbrica en cada sección y cuánto tiempo darle',
      'Las cuatro secciones con la rúbrica oficial delante. No enseño inglés: enseño a examinarse, que es la mitad de la nota que la gente deja sobre la mesa.',
      'per_hour', 4000, 90, null, 'avanzado', 'en', 'active', true, 55),
  (3, 'Excel y modelos financieros desde cero',
      'construyes un modelo de tres estados que cuadra solo',
      'De las tablas dinámicas al modelo con proyección a cinco años. Traes los números de tu negocio o usamos un caso real; lo que no hacemos es rellenar plantillas.',
      'per_session', 2800, 60, null, 'basico', 'es', 'active', true, 50),
  (4, 'Mentoría de carrera 1:1',
      'sales con un plan de tres movimientos y con el CV que lo sostiene',
      'Una hora para ordenar a dónde vas. Revisamos CV, LinkedIn y el discurso con el que te presentas. Acepto a mano: hablamos antes por chat para ver si encajo con lo que buscas.',
      'per_session', 5000, 45, null, 'avanzado', 'es', 'active', false, 40),
  (5, 'Pack de 4 sesiones de conversación',
      'pierdes el miedo a hablar, que es lo único que te frena',
      'Cuatro sesiones seguidas, solo conversación, sin gramática explícita. Corrijo al final de cada bloque para no cortarte el ritmo.',
      'per_package', 11000, 60, 4, 'intermedio', 'en', 'active', true, 35),
  (6, 'Oratoria para presentaciones de trabajo',
      'defiendes tu propuesta sin leer la diapositiva',
      'Te grabas, lo vemos juntos y lo repetimos. Incómodo las dos primeras veces y utilísimo a partir de la tercera.',
      'per_session', 3500, 60, null, 'intermedio', 'es', 'draft', true, 10),
  (7, 'Introducción a la IA aplicada al negocio',
      'sabes qué automatizar y qué no tocar todavía',
      'Qué pueden y qué no pueden hacer hoy estas herramientas en una pyme. Sin código.',
      'per_session', 4500, 60, null, 'basico', 'es', 'paused', true, 20)
) as m(n, title, outcome, description, pricing_model, price_amount,
       session_duration_min, package_num_sessions, level, language,
       status, auto_accept, dias)
on conflict (id) do update set
  title                = excluded.title,
  outcome              = excluded.outcome,
  description          = excluded.description,
  pricing_model        = excluded.pricing_model,
  price_amount         = excluded.price_amount,
  session_duration_min = excluded.session_duration_min,
  package_num_sessions = excluded.package_num_sessions,
  status               = excluded.status,
  auto_accept_bookings = excluded.auto_accept_bookings;

-- Requisitos en dos de ellas, que los bloques de la ficha pública no salgan
-- vacíos.
update public.products p
   set requirements = r.req::jsonb
  from _ey_cuentas c
  cross join (values
    (1, '["Auriculares con micrófono: el audio del portátil se come las consonantes",
          "Un correo o una presentación tuya de verdad para la primera sesión"]'),
    (3, '["Excel o Google Sheets, cualquiera de los dos",
          "Los números de tu negocio si quieres trabajar sobre ellos"]')
  ) as r(n, req)
 where p.id = ('aa000001-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(r.n::text, 8, '0'))::uuid;

-- Categorías, resueltas por slug (patrón de dev-poblar.sql: si el catálogo
-- cambia de ids, esto sigue valiendo).
insert into public.product_categories (product_id, category_id)
select
  ('aa000001-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.n::text, 8, '0'))::uuid,
  cat.id
from _ey_cuentas c
cross join (values
  (1, 'idiomas'), (2, 'preparacion-examenes'), (2, 'idiomas'),
  (3, 'negocios'), (4, 'habilidades-profesionales'), (5, 'idiomas'),
  (6, 'habilidades-profesionales'), (7, 'negocios')
) as v(n, slug)
join public.categories cat on cat.slug = v.slug
on conflict do nothing;

insert into public.tutor_categories (tutor_id, category_id)
select distinct pr.tutor_id, pc.category_id
  from public.product_categories pc
  join public.products pr on pr.id = pc.product_id
 where pr.tutor_id in (select uid from _ey_cuentas)
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · DISPONIBILIDAD
-- ════════════════════════════════════════════════════════════════════════════
-- weekday: 0=domingo … 6=sábado. Ventanas de 4 h: `get_available_slots` trocea
-- la franja en pasos de `session_duration_min`, así que una ventana más corta
-- que la mentoría más larga (90 min, el TOEFL) daría CERO slots en silencio.
insert into public.availability_rules (id, tutor_id, weekday, start_time, end_time)
select
  ('aa000002-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.n::text, 8, '0'))::uuid,
  c.uid, v.weekday, v.desde::time, v.hasta::time
from _ey_cuentas c
cross join (values
  (1, 1, '08:00', '12:00'),
  (2, 2, '14:00', '18:00'),
  (3, 3, '08:00', '12:00'),
  (4, 4, '14:00', '18:00'),
  (5, 6, '09:00', '13:00')
) as v(n, weekday, desde, hasta)
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · COMO TUTORES — 12 reservas en 5 estados cada uno
-- ════════════════════════════════════════════════════════════════════════════
-- Los snapshots financieros se escriben a mano porque esto no pasa por
-- `create_booking` (mismo criterio que dev-poblar.sql: corre como superusuario,
-- no es el flujo del cliente). El total sale del modelo de precio igual que
-- `create_booking` (RN-10): por hora se multiplica por la duración.
--
-- `dias` positivo = pasado, negativo = futuro.
--
-- ⚠️ EL DESFASE ES DE TRES HORAS, NO DE UNA, Y ESO NO ES DECORATIVO.
-- `sessions_sin_solape_por_tutor` (`20260831180000`) es un EXCLUDE sobre
-- `tstzrange(start_at, end_at)`, y una sesión dura 90 MINUTOS: con Néstor a las
-- 18 e Isabella a las 19, sus rangos (18:00-19:30 y 19:00-20:30) se pisan en
-- cuanto los dos reservan con el MISMO tutor de `dev-poblar` el mismo día — que
-- es exactamente lo que hace la §7. Medido el 16-sep-2026: `23P01` sobre el
-- tutor 11111111-…-0002 el 19-ago. Cualquier desfase menor que la duración de
-- una sesión vuelve a romperlo.
-- ⚠️ LA HORA DE LAS SESIONES VA DESFASADA POR PERSONA (`c.hora`: 18 h Néstor,
-- 21 h Isabella) y no es estética. `sessions_sin_solape_por_tutor` es un EXCLUDE
-- por RANGO sobre `tutor_id` (`20260831180000`), no un único por `start_at`. En
-- esta sección el tutor es cada uno de ellos y no chocarían... pero en la §7 los
-- dos reservan LAS MISMAS mentorías de LOS MISMOS tutores el MISMO día, y ahí
-- clavar la hora es un `23P01` que tumba el fichero entero. Emilio ya ocupa las
-- 17:00 y el seed grande las 10:00, así que 18 y 19 quedan libres. Esto mordió
-- al borrador del Doc 34 y por eso se escribe una vez, arriba, para las dos.
drop table if exists _ey_tutor;
create temporary table _ey_tutor (
  n int, alumno uuid, mentoria int, estado public.booking_status,
  dias numeric, rating smallint, comentario text
);

insert into _ey_tutor values
  (1,'44444444-0000-4000-8000-000000000001',1,'completed', 45, 5,'Llevaba años evitando hablar en las reuniones con la matriz. Al mes ya abría yo la llamada. Los rol-play grabados son incómodos y funcionan.'),
  (2,'44444444-0000-4000-8000-000000000002',1,'completed', 38, 5,'Prepara cada sesión con MIS correos, no con ejercicios de libro. Se nota el trabajo que hay detrás.'),
  (3,'44444444-0000-4000-8000-000000000003',2,'completed', 31, 4,'Muy buena preparación de examen. La parte de speaking me habría gustado trabajarla más, pero es cuestión de pedírselo.'),
  (4,'44444444-0000-4000-8000-000000000004',2,'completed', 24, 5,'Saqué 104. Venía de 87 en un simulacro. Y no mejoré mi inglés en dos meses: mejoré cómo me presento al examen.'),
  (5,'44444444-0000-4000-8000-000000000001',3,'completed', 18, null,null),
  (6,'44444444-0000-4000-8000-000000000002',1,'completed', 12, 5,'Puntual, claro y con paciencia. Le pregunté tres veces lo mismo y la tercera lo explicó mejor que la primera.'),
  (7,'44444444-0000-4000-8000-000000000003',3,'completed',  3, null,null),
  (8,'44444444-0000-4000-8000-000000000004',1,'confirmed', -2, null,null),
  (9,'44444444-0000-4000-8000-000000000001',2,'confirmed', -6, null,null),
  (12,'44444444-0000-4000-8000-000000000004',3,'cancelled', 9, null,null);

-- Las dos de aceptación manual van aparte: su antigüedad se mide en HORAS.
-- Una recién llegada (le quedan ~22 h de las 24, píldora negra) y una casi
-- vencida (~3 h, que es cuando G-05 la pone ROJA). Sin la segunda, el estado
-- urgente del diseño no se puede mirar.
insert into _ey_tutor values
  (10,'44444444-0000-4000-8000-000000000002',4,'pending_acceptance', 2/24.0, null,null),
  (11,'44444444-0000-4000-8000-000000000003',4,'pending_acceptance',21/24.0, null,null);

insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount,
  tier_split_pct, payee_country, payer_country,
  completed_at, cancelled_at, cancel_reason, created_at, updated_at
)
select
  ('aa000003-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(t.n::text, 8, '0'))::uuid,
  t.alumno, p.id, c.uid, t.estado, p.pricing_model, 1,
  p.session_duration_min, p.currency,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  coalesce(ti.split_pct, 75.00),
  coalesce(tp.payout_country, 'PA'),
  -- Dictado 9-sep-2026: de dónde paga el ALUMNO decide la pasarela. Se deduce
  -- con la MISMA función que create_booking_line, no con un literal.
  public.pais_de_cobro_por_zona(sp.timezone),
  case when t.estado = 'completed' then now() - make_interval(days => t.dias::int) end,
  case when t.estado = 'cancelled' then now() - make_interval(days => t.dias::int - 2) end,
  case when t.estado = 'cancelled' then 'El alumno canceló con más de 24 h de antelación.' end,
  now() - make_interval(secs => t.dias * 86400 + 3 * 86400),
  now() - make_interval(secs => t.dias * 86400)
from _ey_cuentas c
cross join _ey_tutor t
join public.products p
  on p.id = ('aa000001-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(t.mentoria::text, 8, '0'))::uuid
join public.profiles sp on sp.id = t.alumno
left join public.tutor_profiles tp on tp.profile_id = c.uid
left join public.tutor_tiers    ti on ti.id = tp.tier_id
on conflict (id) do nothing;

-- El cobro. `provider = 'simulated'` aunque dev esté ruteado a Stripe: son pagos
-- de mentira y no deben aparecer nunca en el panel de Stripe.
-- Las `pending_acceptance` NO llevan pago (precedente: dev-reservas-por-aceptar).
insert into public.payments (
  booking_id, status, currency, gross_amount, platform_fee_amount,
  tutor_net_amount, tier_split_pct, payee_country, payer_country,
  provider, refunded_amount, paid_at, created_at
)
select
  b.id,
  case when b.status = 'cancelled' then 'refunded' else 'paid' end::public.payment_status,
  b.currency, b.total_amount,
  b.total_amount - round(b.total_amount * b.tier_split_pct / 100)::bigint,
  round(b.total_amount * b.tier_split_pct / 100)::bigint,
  b.tier_split_pct, b.payee_country, b.payer_country, 'simulated',
  case when b.status = 'cancelled' then b.total_amount else 0 end,
  b.created_at, b.created_at
from public.bookings b
where b.id::text like 'aa000003-0000-4000-8000-%'
  and b.status <> 'pending_acceptance'
on conflict (booking_id) do nothing;

-- Una sesión por reserva, a `c.hora` UTC (ver el aviso del solape, arriba).
-- Una reserva por aceptar cuya clase ya pasó NO existe —el cron la cancela—,
-- así que las dos manuales llevan su sesión en el futuro.
insert into public.sessions (
  id, booking_id, tutor_id, student_id, sequence_no,
  start_at, end_at, status, completed_at, cancelled_at,
  access_opens_at, access_closes_at, created_at
)
select
  ('aa000005-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(t.n::text, 8, '0'))::uuid,
  b.id, b.tutor_id, b.student_id, 1,
  inicio.at, inicio.at + make_interval(mins => b.session_duration_min),
  case b.status
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    else 'scheduled' end::public.session_status,
  case when b.status = 'completed' then b.completed_at end,
  case when b.status = 'cancelled' then b.cancelled_at end,
  inicio.at - interval '10 minutes',
  inicio.at + make_interval(mins => b.session_duration_min) + interval '30 minutes',
  b.created_at
from _ey_cuentas c
cross join _ey_tutor t
join public.bookings b
  on b.id = ('aa000003-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(t.n::text, 8, '0'))::uuid
join lateral (select
  case
    -- Las dos manuales: en el futuro, a días que ninguna otra ocupa.
    when t.estado = 'pending_acceptance'
      then date_trunc('day', now()) + make_interval(days => 10 + t.n, hours => c.hora)
    when t.dias < 0
      then date_trunc('day', now()) + make_interval(days => (-t.dias)::int, hours => c.hora)
    else date_trunc('day', now()) - make_interval(days => t.dias::int) + make_interval(hours => c.hora)
  end as at) inicio on true
where not exists (select 1 from public.sessions s where s.booking_id = b.id);

-- Las reseñas que reciben. El trigger `reviews_refresh_rating` recalcula
-- rating_avg y rating_count solo: no se tocan a mano.
insert into public.reviews (
  id, booking_id, student_id, tutor_id, product_id, rating, comment, created_at
)
select
  ('aa000008-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(t.n::text, 8, '0'))::uuid,
  b.id, b.student_id, b.tutor_id, b.product_id, t.rating, t.comentario,
  b.completed_at + interval '1 day'
from _ey_cuentas c
cross join _ey_tutor t
join public.bookings b
  on b.id = ('aa000003-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(t.n::text, 8, '0'))::uuid
where t.rating is not null
on conflict (booking_id) do nothing;

drop table _ey_tutor;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · COBRO DEL TUTOR — preferencia, cuenta y un payout pagado
-- ════════════════════════════════════════════════════════════════════════════
-- 'banco' es lo que el tutor VE (dLocal, Wise y Stripe leen la misma fila y él
-- no elige entre ellos, dictado 9-sep). No es una clave de RIELES.
insert into public.tutor_payout_preferences (tutor_id, method)
select uid, 'banco' from _ey_cuentas
on conflict (tutor_id) do update set method = excluded.method;

-- La cuenta bancaria, solo si su país de cobro tiene bancos cargados: el
-- `bank_code` es FK contra `payout_banks (country, bank_code)` y adivinarlo es
-- un payout REJECTED semanas después. Si no hay fila, la pantalla enseña el
-- formulario vacío, que también es un estado que vale la pena mirar.
insert into public.tutor_payout_accounts (
  tutor_id, country, beneficiary_first_name, beneficiary_last_name,
  beneficiary_document_type, beneficiary_document, bank_code, bank_account
)
select
  c.uid, banco.country, c.nombre, c.apellido,
  'PASS', c.doc, banco.bank_code, '04001234567890'
from _ey_cuentas c
join lateral (
  select pb.country, pb.bank_code
    from public.payout_banks pb
   where pb.country = coalesce(
     (select payout_country from public.tutor_profiles where profile_id = c.uid), 'PA')
   order by pb.bank_code
   limit 1
) banco on true
on conflict (tutor_id) do nothing;

-- Un payout ya pagado, para que «Ya cobrado» no salga vacío. NO lleva
-- `payout_items`: así no consume ninguno de los pagos de arriba y el saldo
-- disponible se queda entero (las completadas de hace más de 7 días).
insert into public.payouts (
  id, tutor_id, status, currency, amount, provider, funding_provider,
  payee_country, paid_at, created_at, updated_at
)
select
  ('aa000006-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(1::text, 8, '0'))::uuid,
  c.uid, 'paid'::public.payout_status,
  'USD', 7200, 'simulated', 'simulated',
  coalesce(tp.payout_country, 'PA'),
  now() - interval '25 days', now() - interval '27 days', now() - interval '25 days'
from _ey_cuentas c
join public.tutor_profiles tp on tp.profile_id = c.uid
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · COMO ALUMNOS — 8 reservas con 8 tutores distintos cada uno
-- ════════════════════════════════════════════════════════════════════════════
-- Las mentorías salen de dev-poblar.sql. Van por `join`, así que si ese seed no
-- está aplicado estas filas sencillamente no se crean.
--
-- DOS completadas se quedan SIN reseña a propósito: es el único modo de ver el
-- CTA «¿Cómo te fue? Deja tu reseña» en /reservas.
--
-- ⚠️ Aquí es donde importa `c.hora`: los dos reservan las mismas mentorías de
-- los mismos tutores los mismos días. Con la misma hora, la segunda persona
-- choca contra `sessions_sin_solape_por_tutor`.
drop table if exists _ey_alumno;
create temporary table _ey_alumno (
  n int, producto uuid, estado public.booking_status,
  dias numeric, rating smallint, comentario text
);

insert into _ey_alumno values
  (1,'22222222-0000-4000-8000-000000000001','completed', 40, 5,'Le tenía el álgebra atragantada desde el colegio. Explica de dónde sale la fórmula, y entonces ya no hay nada que memorizar.'),
  (2,'22222222-0000-4000-8000-000000000003','completed', 28, 4,'Revisamos mi proyecto de verdad. Va rápido, pero si le pides que pare lo repite sin problema.'),
  (3,'22222222-0000-4000-8000-000000000006','completed', 15, null,null),
  (4,'22222222-0000-4000-8000-000000000007','completed',  6, null,null),
  (5,'22222222-0000-4000-8000-000000000010','confirmed', -3, null,null),
  (6,'22222222-0000-4000-8000-000000000014','confirmed', -9, null,null),
  (7,'22222222-0000-4000-8000-000000000012','pending_acceptance', 5/24.0, null,null),
  (8,'22222222-0000-4000-8000-000000000008','cancelled', 20, null,null);

insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount,
  tier_split_pct, payee_country, payer_country,
  completed_at, cancelled_at, cancel_reason, created_at, updated_at
)
select
  ('aa000004-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(a.n::text, 8, '0'))::uuid,
  c.uid, a.producto, p.tutor_id, a.estado,
  p.pricing_model, 1, p.session_duration_min, p.currency,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  coalesce(ti.split_pct, 75.00),
  coalesce(tp.payout_country, 'VE'),
  -- Su propia zona horaria: aquí se ve el ruteo de cobro de CO y de MX de verdad.
  public.pais_de_cobro_por_zona(c.tz),
  case when a.estado = 'completed' then now() - make_interval(days => a.dias::int) end,
  case when a.estado = 'cancelled' then now() - make_interval(days => a.dias::int - 2) end,
  case when a.estado = 'cancelled' then 'Cancelada por el alumno: se solapaba con un viaje.' end,
  now() - make_interval(secs => a.dias * 86400 + 3 * 86400),
  now() - make_interval(secs => a.dias * 86400)
from _ey_cuentas c
cross join _ey_alumno a
join public.products p on p.id = a.producto
left join public.tutor_profiles tp on tp.profile_id = p.tutor_id
left join public.tutor_tiers    ti on ti.id = tp.tier_id
on conflict (id) do nothing;

insert into public.payments (
  booking_id, status, currency, gross_amount, platform_fee_amount,
  tutor_net_amount, tier_split_pct, payee_country, payer_country,
  provider, refunded_amount, paid_at, created_at
)
select
  b.id,
  case when b.status = 'cancelled' then 'refunded' else 'paid' end::public.payment_status,
  b.currency, b.total_amount,
  b.total_amount - round(b.total_amount * b.tier_split_pct / 100)::bigint,
  round(b.total_amount * b.tier_split_pct / 100)::bigint,
  b.tier_split_pct, b.payee_country, b.payer_country, 'simulated',
  case when b.status = 'cancelled' then b.total_amount else 0 end,
  b.created_at, b.created_at
from public.bookings b
where b.id::text like 'aa000004-0000-4000-8000-%'
  and b.status <> 'pending_acceptance'
on conflict (booking_id) do nothing;

insert into public.sessions (
  id, booking_id, tutor_id, student_id, sequence_no,
  start_at, end_at, status, completed_at, cancelled_at,
  access_opens_at, access_closes_at, created_at
)
select
  ('aa000005-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad((100 + a.n)::text, 8, '0'))::uuid,
  b.id, b.tutor_id, b.student_id, 1,
  inicio.at, inicio.at + make_interval(mins => b.session_duration_min),
  case b.status
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    else 'scheduled' end::public.session_status,
  case when b.status = 'completed' then b.completed_at end,
  case when b.status = 'cancelled' then b.cancelled_at end,
  inicio.at - interval '10 minutes',
  inicio.at + make_interval(mins => b.session_duration_min) + interval '30 minutes',
  b.created_at
from _ey_cuentas c
cross join _ey_alumno a
join public.bookings b
  on b.id = ('aa000004-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(a.n::text, 8, '0'))::uuid
join lateral (select
  case
    when a.estado = 'pending_acceptance'
      then date_trunc('day', now()) + make_interval(days => 7, hours => c.hora)
    when a.dias < 0
      then date_trunc('day', now()) + make_interval(days => (-a.dias)::int, hours => c.hora)
    else date_trunc('day', now()) - make_interval(days => a.dias::int) + make_interval(hours => c.hora)
  end as at) inicio on true
where not exists (select 1 from public.sessions s where s.booking_id = b.id);

-- Las dos reseñas que SÍ dejaron. (Suben el rating de esos tutores: es dev.)
insert into public.reviews (
  id, booking_id, student_id, tutor_id, product_id, rating, comment, created_at
)
select
  ('aa000008-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad((100 + a.n)::text, 8, '0'))::uuid,
  b.id, b.student_id, b.tutor_id, b.product_id, a.rating, a.comentario,
  b.completed_at + interval '2 days'
from _ey_cuentas c
cross join _ey_alumno a
join public.bookings b
  on b.id = ('aa000004-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(a.n::text, 8, '0'))::uuid
where a.rating is not null
on conflict (booking_id) do nothing;

drop table _ey_alumno;


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · CHAT — tres hilos cada uno, en los dos sentidos
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ AQUÍ NO SE CREA NINGUNA CONVERSACIÓN, Y ES LO CORRECTO: desde M-12 toda
-- reserva abre su hilo sola por el trigger `bookings_ensure_conversation`
-- (`20260820180000`). O sea que al insertar las §5 y §7 ya nacieron los hilos
-- con id ALEATORIO, y un `insert` con id fijo choca contra
-- `conversations_pair_unique` — el par ya tiene el suyo. `on conflict do
-- nothing` se lo traga en silencio y los mensajes se quedan sin FK.
-- Así que el hilo se BUSCA por su par (alumno, tutor), que es su clave de
-- verdad, y si no existe la fila no se inserta.
--
-- ⚠️ `expires_at` va NULO Y ESCRITO A MANO. Omitir la columna NO da null: su
-- DEFAULT sigue siendo `now() + interval '30 days'` (EP-17), y desde
-- `20260817210000` el check `messages_caducidad_por_reserva` exige
-- `(booking_id is null) = (expires_at is null)`. O sea: un mensaje de hilo libre
-- —sin reserva detrás— NO caduca, y dejar que el default hable lo rechaza la BD.
--
-- `soy_tutor` dice de qué lado del hilo está la persona sembrada; `quien` dice
-- quién escribe ese mensaje. Es lo único que hay que parametrizar para que los
-- mismos tres hilos valgan para los dos.
insert into public.messages (id, conversation_id, sender_id, body, created_at, expires_at)
select
  ('aa000007-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.n::text, 8, '0'))::uuid,
  conv.id,
  case when v.quien = 'yo' then c.uid else v.otro end,
  v.body, now() - v.hace, null
from _ey_cuentas c
cross join (values
  -- Hilo 1 · Julián le escribe (aquí la persona sembrada es el TUTOR)
  (101, '44444444-0000-4000-8000-000000000002'::uuid, true, 'otro',
   'Hola. Te pedí la mentoría de carrera. Trabajo en logística y quiero moverme a un rol de producto, ¿lo ves razonable?',
   interval '3 hours'),
  (102, '44444444-0000-4000-8000-000000000002', true, 'yo',
   'Muy razonable, y el salto se hace mejor desde dentro de tu sector que desde fuera. Mándame el CV antes de la sesión y lo llevo leído.',
   interval '2 hours 30 minutes'),
  (103, '44444444-0000-4000-8000-000000000002', true, 'otro',
   'Perfecto, te lo paso esta tarde. Gracias.',
   interval '2 hours'),
  -- Hilo 2 · Rocío
  (201, '44444444-0000-4000-8000-000000000003', true, 'otro',
   '¿La sesión de Excel la damos sobre mis números o prefieres un caso tuyo? Los míos están un poco desordenados.',
   interval '22 hours'),
  (202, '44444444-0000-4000-8000-000000000003', true, 'yo',
   'Sobre los tuyos, desordenados y todo. Ordenarlos es media clase y es la mitad que de verdad te sirve después.',
   interval '20 hours'),
  -- Hilo 3 · le escribe a Andrés (aquí la persona sembrada es el ALUMNO;
  -- el hilo existe porque la §7 le reservó la mentoría …010, que es de él)
  (301, '11111111-0000-4000-8000-000000000006', false, 'yo',
   'Hola Andrés, tengo el IELTS en seis semanas y voy justo de writing. ¿Da tiempo?',
   interval '2 days'),
  (302, '11111111-0000-4000-8000-000000000006', false, 'otro',
   'Da tiempo de sobra si trabajamos con la rúbrica delante desde la primera sesión. Mándame un Task 2 tuyo tal cual, sin retocarlo.',
   interval '1 day')
) as v(n, otro, soy_tutor, quien, body, hace)
join public.conversations conv
  on conv.student_id = case when v.soy_tutor then v.otro else c.uid end
 and conv.tutor_id   = case when v.soy_tutor then c.uid else v.otro end
on conflict (id) do nothing;

-- La bandeja ordena por `last_message_at` y el trigger de la reserva lo deja
-- nulo: sin esto los hilos con texto caen al fondo de la lista.
update public.conversations c
   set last_message_at = m.ultimo
  from (select conversation_id, max(created_at) as ultimo
          from public.messages
         where id::text like 'aa000007-0000-4000-8000-%'
         group by conversation_id) m
 where c.id = m.conversation_id;


-- ════════════════════════════════════════════════════════════════════════════
-- 9 · AVISOS DE CAMPANA — tres sin leer, tres leídos
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `channel = 'in_app'` para que el job de correo NO los recoja: estas dos
-- direcciones son buzones REALES del cliente y Resend está verificado. Los
-- correos que sí quedan encolados son los de la cabecera (NTF-24/25/26/21), y
-- los encolan triggers, no este bloque: aquí se pinta la campana y nada más.
insert into public.notifications (
  id, recipient_id, type, template, channel, status, payload, idempotency_key,
  read_at, sent_at, created_at
)
select
  ('aa000009-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.n::text, 8, '0'))::uuid,
  c.uid, v.tipo, v.plantilla, 'in_app', 'sent'::public.notification_status,
  case
    when v.reserva_tutor  is not null
      then jsonb_build_object('booking_id',
             'aa000003-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.reserva_tutor::text, 8, '0'))
    when v.reserva_alumno is not null
      then jsonb_build_object('booking_id',
             'aa000004-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.reserva_alumno::text, 8, '0'))
    when v.payout is not null
      then jsonb_build_object('payout_id',
             'aa000006-0000-4000-8000-' || lpad(c.p::text, 4, '0') || lpad(v.payout::text, 8, '0'))
    else '{}'::jsonb
  end,
  c.clave || ':' || v.sufijo,
  case when v.leido_hace is not null then now() - v.leido_hace end,
  now() - v.hace, now() - v.hace
from _ey_cuentas c
cross join (values
  (1::int, 'NTF-07','booking_new_tutor',      10::int, null::int, null::int, 'ntf07:booking:10',
   interval '2 hours',  null::interval),
  (2::int, 'NTF-08','booking_expiring_tutor', 11,      null,      null,      'ntf08:booking:11',
   interval '1 hour',   null),
  (3::int, 'NTF-16','review_received_tutor',  null,    null,      null,      'ntf16:review',
   interval '11 days',  null),
  (4::int, 'NTF-13','payout_paid',            null,    null,      1,         'ntf13:payout:01',
   interval '25 days',  interval '24 days'),
  (5::int, 'NTF-12','review_request',         null,    4,         null,      'ntf12:review-request:04',
   interval '5 days',   interval '5 days'),
  (6::int, 'NTF-03','tutor_review_result',    null,    null,      null,      'ntf03:tutor-approved',
   interval '60 days',  interval '59 days')
) as v(n, tipo, plantilla, reserva_tutor, reserva_alumno, payout, sufijo, hace, leido_hace)
on conflict (id) do nothing;


drop table _ey_cuentas;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — CÓRRELA APARTE, EN OTRA PESTAÑA
-- ════════════════════════════════════════════════════════════════════════════
-- Va comentada a propósito: un `select` al final de este archivo es justo lo que
-- enmascara un error veinte sentencias más arriba (ver la cabecera).
--
-- ── 1. Los tres roles, los dos paneles y el rating, de un vistazo ───────────
--   select u.email,
--          (select count(*) from public.user_roles  where user_id   = u.id) as roles,
--          (select count(*) from public.products    where tutor_id  = u.id) as mentorias,
--          (select count(*) from public.bookings    where tutor_id  = u.id) as como_tutor,
--          (select count(*) from public.bookings    where student_id= u.id) as como_alumno,
--          (select count(*) from public.reviews     where tutor_id  = u.id) as resenas,
--          (select rating_avg from public.tutor_profiles where profile_id = u.id) as rating,
--          (select payout_country from public.tutor_profiles where profile_id = u.id) as pais
--     from auth.users u
--    where u.email in ('nestor@ensenameya.com','isabel@ensenameya.com');
--   Se espera, por fila: 3 roles / 7 / 12 / 8 / 5 / ~4.8 / CO y MX.
--
-- ── 2. Que sus mentorías se puedan reservar de verdad ───────────────────────
--   select p.title, p.status, p.session_duration_min as dur,
--          (select count(*) from public.get_available_slots(p.id, current_date, current_date + 21)) as slots
--     from public.products p
--    where p.tutor_id = (select id from auth.users where email = 'nestor@ensenameya.com')
--    order by slots asc;
--   Se esperan 7 filas; las 5 'active' con slots > 0 (draft y paused, en 0).
--
-- ── 3. Los correos que quedaron encolados (los de la cabecera) ──────────────
--   select n.type, n.template, n.channel, n.status, u.email
--     from public.notifications n
--     join auth.users u on u.id = n.recipient_id
--    where u.email in ('nestor@ensenameya.com','isabel@ensenameya.com')
--      and n.channel = 'email';
--   Se esperan ~9 filas `pending` por persona (NTF-24, NTF-25, 5×NTF-26 y las
--   NTF-21 del chat que no agrupe el dedupe). Salen cuando alguien corra
--   /api/cron/notifications-send; el `update` para apagarlas está en la
--   cabecera.
--
-- ── 4. El saldo que verán en /tutor/payouts ─────────────────────────────────
-- No se llama a `tutor_balance()`: es SECURITY DEFINER y lee `auth.uid()`, que
-- aquí es null. Se repite su misma cuenta a mano.
--   select u.email,
--     sum(pay.tutor_net_amount) filter (where b.completed_at <= now() - interval '7 days') as disponible,
--     sum(pay.tutor_net_amount) filter (where b.completed_at >  now() - interval '7 days') as en_retencion
--   from auth.users u
--   join public.bookings b  on b.tutor_id = u.id and b.status = 'completed'
--   join public.payments pay on pay.booking_id = b.id
--   where u.email in ('nestor@ensenameya.com','isabel@ensenameya.com')
--   group by u.email;
--   Se esperan las dos columnas con cifra: la reserva de hace 3 días cae en
--   retención.
