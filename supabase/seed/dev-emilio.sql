-- ============================================================================
-- Enséñame Ya — POBLAR emilio@faimlab.com.  ⚠️  SOLO DEV — NO a producción.
--
-- Deja a Emilio con los DOS paneles llenos a la vez: el switch
-- «Aprender / Enseñar» del menú de cuenta sale siempre con sesión
-- (`panelsFor`, lib/auth/roles.ts), así que una sola cuenta con el rol `tutor`
-- ve /app y /tutor sin cambiar de usuario.
--
-- Qué deja:
--   TUTOR  · perfil aprobado + KYC, 7 mentorías (4 activas, 1 en pausa,
--            1 borrador, 1 paquete), disponibilidad 5 días, 12 reservas en 5
--            estados, 5 reseñas recibidas, saldo con retención y un payout
--            pagado, preferencia de cobro y FAQs.
--   ALUMNO · 8 reservas con 8 tutores distintos, 2 reseñas dejadas y 2
--            pendientes de dejar (el CTA de reseña), pagos, intereses.
--   AMBOS  · 3 conversaciones de chat y 6 avisos de campana.
--
-- DEPENDE de `dev-poblar.sql`: los alumnos (44444444-…) y las mentorías de los
-- otros tutores (22222222-…) salen de ahí. Lo que no encuentre NO se inserta
-- —van por `join`, no por literal—, así que degrada en vez de reventar.
--
-- Cómo aplicarlo: pégalo ENTERO en el SQL Editor de Supabase (dev).
--   (`npm run db:seed` no sirve: apunta a dev-poblar.sql y exige SUPABASE_DB_URL.)
--
-- Idempotente: ids fijos + `on conflict`. Reejecutable sin duplicar.
-- Espacio de nombres propio:
--   ea000001-… mentorías   ea000002-… disponibilidad  ea000003-… reservas(tutor)
--   ea000004-… reservas(alumno)  ea000005-… sesiones  ea000006-… payouts
--   ea000007-… chat        ea000008-… reseñas         ea000009-… avisos
--
-- ⚠️ SIN TRANSACCIÓN, a propósito: el SQL Editor solo enseña el resultado de la
-- última sentencia, y envuelto en `begin/commit` un error a mitad se vuelve
-- invisible. Mismo criterio que dev-poblar.sql, que ya costó tres vueltas.
-- ============================================================================

-- La red: si el id no es el suyo, mejor parar aquí que sembrar sobre otro.
do $$
begin
  if not exists (
    select 1 from auth.users
     where id = '96b6e155-45c8-49f9-a8a0-6903d5272710'
       and email = 'emilio@faimlab.com'
  ) then
    raise exception
      'emilio@faimlab.com no es 96b6e155-45c8-49f9-a8a0-6903d5272710 en esta base. Comprueba el id antes de seguir.';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · PERFIL Y ROL
-- ════════════════════════════════════════════════════════════════════════════
-- La contraseña se repone para poder entrar a mirarlo. Si Emilio entró con
-- Google esto NO le quita el Google: añade la vía de contraseña al lado.
update auth.users
   set encrypted_password = extensions.crypt('Ensename2026!', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now())
 where id = '96b6e155-45c8-49f9-a8a0-6903d5272710';

update public.profiles
   set full_name           = 'Emilio Faim',
       timezone            = 'America/Panama',
       onboarding_complete = true
 where id = '96b6e155-45c8-49f9-a8a0-6903d5272710';

-- El rol `tutor`, a mano. Normalmente lo concede `review_tutor()`, pero esa RPC
-- encola un correo (NTF-03) y la cola HOY ENVÍA DE VERDAD a un buzón real de
-- FaimLab. Saltársela obliga a acordarse del rol: es lo que le pasó al fixture
-- `tutor.us401`, aprobado por SQL y sin rol nunca.
insert into public.user_roles (user_id, role)
values ('96b6e155-45c8-49f9-a8a0-6903d5272710', 'tutor'::public.app_role)
on conflict do nothing;

-- Intereses del alumno (los chips de /app).
insert into public.student_interests (student_id, category_id)
select '96b6e155-45c8-49f9-a8a0-6903d5272710', c.id
  from public.categories c
 where c.slug in ('idiomas', 'negocios', 'preparacion-examenes')
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · PERFIL DE TUTOR — aprobado de una vez
-- ════════════════════════════════════════════════════════════════════════════
-- Entra ya en 'approved' en el INSERT y no con un UPDATE posterior:
-- `notify_tutor_profile` es AFTER UPDATE, así que insertándolo aprobado no se
-- encola ni un correo. (En una REejecución el `do update` sí lo encolará: la
-- cola solo sale si alguien corre /api/cron/notifications-send.)
insert into public.tutor_profiles (
  profile_id, display_name, headline, bio, teaching_level,
  approval_status, identity_verification_status, approved_at, tier_id, faqs
)
values (
  '96b6e155-45c8-49f9-a8a0-6903d5272710',
  'Emilio Faim',
  'Inglés de negocios, TOEFL y finanzas para quien ya trabaja',
  'Doce años entre consultoría y formación corporativa. Doy clase a gente que necesita el idioma o los números para el lunes, no para un examen abstracto: trabajamos sobre tus correos, tus reuniones y tus hojas de cálculo. Certificado TOEFL iBT y MBA por la Universidad de Panamá.',
  'intermedio'::public.teaching_level,
  'approved'::public.tutor_approval_status,
  'approved'::public.identity_verification_status,
  now() - interval '60 days',
  (select id from public.tutor_tiers where is_default),
  '[
    {"q":"¿Necesito un nivel mínimo de inglés para empezar?","a":"No. En la primera sesión hacemos una prueba corta de 10 minutos y armamos el plan desde ahí. Tengo alumnos que empezaron sin poder presentarse."},
    {"q":"¿Qué pasa si tengo que cancelar por trabajo?","a":"Cancelando con más de 24 horas se reprograma sin coste. Con menos, se pierde la sesión: el hueco ya no lo puede tomar nadie más."},
    {"q":"¿Me mandas material entre clases?","a":"Sí, y es la mitad del avance. Cada sesión termina con dos o tres tareas cortas que reviso antes de la siguiente."},
    {"q":"¿Puedo grabar las sesiones?","a":"Se graban siempre y las tienes disponibles unos días. Te aviso al empezar, no hay letra pequeña."}
  ]'::jsonb
)
on conflict (profile_id) do update set
  display_name                 = excluded.display_name,
  headline                     = excluded.headline,
  bio                          = excluded.bio,
  teaching_level               = excluded.teaching_level,
  approval_status              = excluded.approval_status,
  identity_verification_status = excluded.identity_verification_status,
  approved_at                  = excluded.approved_at,
  faqs                         = excluded.faqs,
  tier_id                      = coalesce(tutor_profiles.tier_id, excluded.tier_id);

-- Los 6 documentos de C-14, aprobados, para que /tutor/verification y la ficha
-- del admin sean coherentes con `identity_verification_status = 'approved'`.
insert into public.verification_documents (
  tutor_id, doc_type, storage_path, status, reviewed_at, reviewed_by, created_at
)
select
  '96b6e155-45c8-49f9-a8a0-6903d5272710', d.doc_type,
  '96b6e155-45c8-49f9-a8a0-6903d5272710/' || d.doc_type,
  'approved'::public.document_status,
  now() - interval '60 days',
  (select id from auth.users where email = 'admin.us1101@ensenameya.dev'),
  now() - interval '63 days'
from (values ('cv'),('degree'),('id_document'),('certificate'),('diploma'),('transcript'))
     as d(doc_type)
where not exists (
  select 1 from public.verification_documents v
   where v.tutor_id = '96b6e155-45c8-49f9-a8a0-6903d5272710'
     and v.doc_type = d.doc_type
);


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · MENTORÍAS  (después de aprobar: `products_publish_guard` lo exige)
-- ════════════════════════════════════════════════════════════════════════════
-- `session_duration_min` NUNCA nulo: `get_available_slots` corta seco si lo es,
-- sin error y sin slots. Es el fallo silencioso más fácil de meter aquí.
--
-- La 04 nace con `auto_accept_bookings = false` a propósito: sin una mentoría
-- de aceptación manual NO existe ninguna reserva `pending_acceptance`, y el
-- filtro «Por aceptar» del panel, la cuenta atrás de 24 h y NTF-07 se quedan
-- sin datos con los que probarse.
insert into public.products (
  id, tutor_id, title, outcome, description, pricing_model, price_amount,
  session_duration_min, package_num_sessions, level, language, currency,
  status, auto_accept_bookings, created_at
)
values
  ('ea000001-0000-4000-8000-000000000001','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Inglés de negocios para reuniones',
   'diriges una reunión en inglés sin leer un guion',
   'Trabajamos sobre tus reuniones reales: cómo abrir, cómo interrumpir sin sonar brusco, cómo pedir una aclaración. Grabamos un rol-play cada sesión y lo revisamos juntos.',
   'per_session'::public.pricing_model, 3200, 60, null::int,
   'intermedio'::public.teaching_level, 'en', 'USD',
   'active'::public.product_status, true, now() - interval '58 days'),

  ('ea000001-0000-4000-8000-000000000002','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Preparación TOEFL iBT intensiva',
   'sabes qué pide la rúbrica en cada sección y cuánto tiempo darle',
   'Las cuatro secciones con la rúbrica oficial delante. No enseño inglés: enseño a examinarse, que es la mitad de la nota que la gente deja sobre la mesa.',
   'per_hour'::public.pricing_model, 4000, 90, null::int,
   'avanzado'::public.teaching_level, 'en', 'USD',
   'active'::public.product_status, true, now() - interval '55 days'),

  ('ea000001-0000-4000-8000-000000000003','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Excel y modelos financieros desde cero',
   'construyes un modelo de tres estados que cuadra solo',
   'De las tablas dinámicas al modelo con proyección a cinco años. Traes los números de tu negocio o usamos un caso real; lo que no hacemos es rellenar plantillas.',
   'per_session'::public.pricing_model, 2800, 60, null::int,
   'basico'::public.teaching_level, 'es', 'USD',
   'active'::public.product_status, true, now() - interval '50 days'),

  ('ea000001-0000-4000-8000-000000000004','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Mentoría de carrera 1:1',
   'sales con un plan de tres movimientos y con el CV que lo sostiene',
   'Una hora para ordenar a dónde vas. Revisamos CV, LinkedIn y el discurso con el que te presentas. Acepto a mano: hablamos antes por chat para ver si encajo con lo que buscas.',
   'per_session'::public.pricing_model, 5000, 45, null::int,
   'avanzado'::public.teaching_level, 'es', 'USD',
   'active'::public.product_status, false, now() - interval '40 days'),

  ('ea000001-0000-4000-8000-000000000005','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Pack de 4 sesiones de conversación',
   'pierdes el miedo a hablar, que es lo único que te frena',
   'Cuatro sesiones seguidas, solo conversación, sin gramática explícita. Corrijo al final de cada bloque para no cortarte el ritmo.',
   'per_package'::public.pricing_model, 11000, 60, 4,
   'intermedio'::public.teaching_level, 'en', 'USD',
   'active'::public.product_status, true, now() - interval '35 days'),

  ('ea000001-0000-4000-8000-000000000006','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Oratoria para presentaciones de trabajo',
   'defiendes tu propuesta sin leer la diapositiva',
   'Te grabas, lo vemos juntos y lo repetimos. Incómodo las dos primeras veces y utilísimo a partir de la tercera.',
   'per_session'::public.pricing_model, 3500, 60, null::int,
   'intermedio'::public.teaching_level, 'es', 'USD',
   'draft'::public.product_status, true, now() - interval '10 days'),

  ('ea000001-0000-4000-8000-000000000007','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'Introducción a la IA aplicada al negocio',
   'sabes qué automatizar y qué no tocar todavía',
   'Qué pueden y qué no pueden hacer hoy estas herramientas en una pyme. Sin código.',
   'per_session'::public.pricing_model, 4500, 60, null::int,
   'basico'::public.teaching_level, 'es', 'USD',
   'paused'::public.product_status, true, now() - interval '20 days')
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

-- Requisitos y política de cancelación en dos de ellas, que los bloques de la
-- ficha pública no salgan vacíos.
update public.products set requirements = '[
  "Auriculares con micrófono: el audio del portátil se come las consonantes",
  "Un correo o una presentación tuya de verdad para la primera sesión"
]'::jsonb where id = 'ea000001-0000-4000-8000-000000000001';

update public.products set requirements = '[
  "Excel o Google Sheets, cualquiera de los dos",
  "Los números de tu negocio si quieres trabajar sobre ellos"
]'::jsonb where id = 'ea000001-0000-4000-8000-000000000003';

-- Categorías, resueltas por slug (patrón de dev-poblar.sql: si el catálogo de
-- categorías cambia de ids, esto sigue valiendo).
insert into public.product_categories (product_id, category_id)
select v.product_id, c.id
  from (values
    ('ea000001-0000-4000-8000-000000000001'::uuid, 'idiomas'),
    ('ea000001-0000-4000-8000-000000000002'::uuid, 'preparacion-examenes'),
    ('ea000001-0000-4000-8000-000000000002'::uuid, 'idiomas'),
    ('ea000001-0000-4000-8000-000000000003'::uuid, 'negocios'),
    ('ea000001-0000-4000-8000-000000000004'::uuid, 'habilidades-profesionales'),
    ('ea000001-0000-4000-8000-000000000005'::uuid, 'idiomas'),
    ('ea000001-0000-4000-8000-000000000006'::uuid, 'habilidades-profesionales'),
    ('ea000001-0000-4000-8000-000000000007'::uuid, 'negocios')
  ) as v(product_id, slug)
  join public.categories c on c.slug = v.slug
on conflict do nothing;

insert into public.tutor_categories (tutor_id, category_id)
select distinct pr.tutor_id, pc.category_id
  from public.product_categories pc
  join public.products pr on pr.id = pc.product_id
 where pr.tutor_id = '96b6e155-45c8-49f9-a8a0-6903d5272710'
on conflict do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · DISPONIBILIDAD
-- ════════════════════════════════════════════════════════════════════════════
-- weekday: 0=domingo … 6=sábado. Ventanas de 4 h: `get_available_slots` trocea
-- la franja en pasos de `session_duration_min`, así que una ventana más corta
-- que la mentoría más larga (90 min, el TOEFL) daría CERO slots en silencio.
insert into public.availability_rules (id, tutor_id, weekday, start_time, end_time)
values
  ('ea000002-0000-4000-8000-000000000001','96b6e155-45c8-49f9-a8a0-6903d5272710', 1, '08:00', '12:00'),
  ('ea000002-0000-4000-8000-000000000002','96b6e155-45c8-49f9-a8a0-6903d5272710', 2, '14:00', '18:00'),
  ('ea000002-0000-4000-8000-000000000003','96b6e155-45c8-49f9-a8a0-6903d5272710', 3, '08:00', '12:00'),
  ('ea000002-0000-4000-8000-000000000004','96b6e155-45c8-49f9-a8a0-6903d5272710', 4, '14:00', '18:00'),
  ('ea000002-0000-4000-8000-000000000005','96b6e155-45c8-49f9-a8a0-6903d5272710', 6, '09:00', '13:00')
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · EMILIO COMO TUTOR — 12 reservas en 5 estados
-- ════════════════════════════════════════════════════════════════════════════
-- Los snapshots financieros se escriben a mano porque esto no pasa por
-- `create_booking` (mismo criterio que dev-poblar.sql: corre como superusuario,
-- no es el flujo del cliente). El total sale del modelo de precio igual que
-- `create_booking` (RN-10): por hora se multiplica por la duración.
--
-- `dias` positivo = pasado, negativo = futuro. Ninguno se repite: las sesiones
-- de un mismo tutor van todas a las 15:00 UTC y `sessions_sin_solape_por_tutor`
-- es un EXCLUDE por intervalo, así que dos el mismo día chocarían.
drop table if exists _ey_emilio_tutor;
create temporary table _ey_emilio_tutor (
  n int, alumno uuid, producto uuid, estado public.booking_status,
  dias numeric, rating smallint, comentario text
);

insert into _ey_emilio_tutor values
  (1,'44444444-0000-4000-8000-000000000001','ea000001-0000-4000-8000-000000000001','completed', 45, 5,'Llevaba años evitando hablar en las reuniones con la matriz. Al mes ya abría yo la llamada. Los rol-play grabados son incómodos y funcionan.'),
  (2,'44444444-0000-4000-8000-000000000002','ea000001-0000-4000-8000-000000000001','completed', 38, 5,'Prepara cada sesión con MIS correos, no con ejercicios de libro. Se nota el trabajo que hay detrás.'),
  (3,'44444444-0000-4000-8000-000000000003','ea000001-0000-4000-8000-000000000002','completed', 31, 4,'Muy buena preparación de examen. La parte de speaking me habría gustado trabajarla más, pero es cuestión de pedírselo.'),
  (4,'44444444-0000-4000-8000-000000000004','ea000001-0000-4000-8000-000000000002','completed', 24, 5,'Saqué 104. Venía de 87 en un simulacro. Y no mejoré mi inglés en dos meses: mejoré cómo me presento al examen.'),
  (5,'44444444-0000-4000-8000-000000000001','ea000001-0000-4000-8000-000000000003','completed', 18, null,null),
  (6,'44444444-0000-4000-8000-000000000002','ea000001-0000-4000-8000-000000000001','completed', 12, 5,'Puntual, claro y con paciencia. Le pregunté tres veces lo mismo y la tercera lo explicó mejor que la primera.'),
  (7,'44444444-0000-4000-8000-000000000003','ea000001-0000-4000-8000-000000000003','completed',  3, null,null),
  (8,'44444444-0000-4000-8000-000000000004','ea000001-0000-4000-8000-000000000001','confirmed', -2, null,null),
  (9,'44444444-0000-4000-8000-000000000001','ea000001-0000-4000-8000-000000000002','confirmed', -6, null,null),
  (12,'44444444-0000-4000-8000-000000000004','ea000001-0000-4000-8000-000000000003','cancelled',  9, null,null);

-- Las dos de aceptación manual van aparte: su antigüedad se mide en HORAS.
-- Una recién llegada (le quedan ~22 h de las 24, píldora negra) y una casi
-- vencida (~3 h, que es cuando G-05 la pone ROJA). Sin la segunda, el estado
-- urgente del diseño no se puede mirar.
insert into _ey_emilio_tutor values
  (10,'44444444-0000-4000-8000-000000000002','ea000001-0000-4000-8000-000000000004','pending_acceptance', 2/24.0, null,null),
  (11,'44444444-0000-4000-8000-000000000003','ea000001-0000-4000-8000-000000000004','pending_acceptance',21/24.0, null,null);

insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount,
  tier_split_pct, payee_country, payer_country,
  completed_at, cancelled_at, cancel_reason, created_at, updated_at
)
select
  ('ea000003-0000-4000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid,
  t.alumno, t.producto, p.tutor_id, t.estado, p.pricing_model, 1,
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
from _ey_emilio_tutor t
join public.products p  on p.id = t.producto
join public.profiles sp on sp.id = t.alumno
left join public.tutor_profiles tp on tp.profile_id = p.tutor_id
left join public.tutor_tiers    ti on ti.id = tp.tier_id
on conflict (id) do nothing;

-- El cobro. `provider = 'simulated'` aunque dev esté ruteado a Stripe: son
-- pagos de mentira y no deben aparecer nunca en el panel de Stripe.
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
where b.id::text like 'ea000003-0000-4000-8000-%'
  and b.status <> 'pending_acceptance'
on conflict (booking_id) do nothing;

-- Una sesión por reserva. Las pasadas a las 15:00 UTC (el seed grande usa las
-- 10:00, así que no se pisan); las futuras a las 15:00 del día que toque.
-- Una reserva por aceptar cuya clase ya pasó NO existe —el cron la cancela—,
-- así que las dos manuales llevan su sesión en el futuro.
insert into public.sessions (
  id, booking_id, tutor_id, student_id, sequence_no,
  start_at, end_at, status, completed_at, cancelled_at,
  access_opens_at, access_closes_at, created_at
)
select
  ('ea000005-0000-4000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid,
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
from _ey_emilio_tutor t
join public.bookings b
  on b.id = ('ea000003-0000-4000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid
join lateral (select
  case
    -- Las dos manuales: en el futuro, a días que ninguna otra ocupa.
    when t.estado = 'pending_acceptance'
      then date_trunc('day', now()) + make_interval(days => 10 + t.n, hours => 15)
    when t.dias < 0
      then date_trunc('day', now()) + make_interval(days => (-t.dias)::int, hours => 15)
    else date_trunc('day', now()) - make_interval(days => t.dias::int) + interval '15 hours'
  end as at) inicio on true
where not exists (select 1 from public.sessions s where s.booking_id = b.id);

-- Las reseñas que recibe. El trigger `reviews_refresh_rating` recalcula
-- rating_avg y rating_count solo: no se tocan a mano.
insert into public.reviews (
  id, booking_id, student_id, tutor_id, product_id, rating, comment, created_at
)
select
  ('ea000008-0000-4000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid,
  b.id, b.student_id, b.tutor_id, b.product_id, t.rating, t.comentario,
  b.completed_at + interval '1 day'
from _ey_emilio_tutor t
join public.bookings b
  on b.id = ('ea000003-0000-4000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid
where t.rating is not null
on conflict (booking_id) do nothing;

drop table _ey_emilio_tutor;


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · COBRO DEL TUTOR — preferencia, cuenta y un payout pagado
-- ════════════════════════════════════════════════════════════════════════════
-- 'banco' es lo que el tutor VE (dLocal y Wise leen la misma fila y él no elige
-- entre ellos). No es una clave de RIELES.
insert into public.tutor_payout_preferences (tutor_id, method)
values ('96b6e155-45c8-49f9-a8a0-6903d5272710', 'banco')
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
  '96b6e155-45c8-49f9-a8a0-6903d5272710', pb.country,
  'Emilio', 'Faim', 'PASS', 'PA1234567', pb.bank_code, '04001234567890'
from public.payout_banks pb
where pb.country = coalesce(
  (select payout_country from public.tutor_profiles
    where profile_id = '96b6e155-45c8-49f9-a8a0-6903d5272710'), 'PA')
order by pb.bank_code
limit 1
on conflict (tutor_id) do nothing;

-- Un payout ya pagado, para que «Ya cobrado» no salga vacío. NO lleva
-- `payout_items`: así no consume ninguno de los pagos de arriba y el saldo
-- disponible se queda entero (las completadas de hace más de 7 días).
insert into public.payouts (
  id, tutor_id, status, currency, amount, provider, funding_provider,
  payee_country, paid_at, created_at, updated_at
)
select
  'ea000006-0000-4000-8000-000000000001',
  '96b6e155-45c8-49f9-a8a0-6903d5272710', 'paid'::public.payout_status,
  'USD', 7200, 'simulated', 'simulated',
  coalesce(tp.payout_country, 'PA'),
  now() - interval '25 days', now() - interval '27 days', now() - interval '25 days'
from public.tutor_profiles tp
where tp.profile_id = '96b6e155-45c8-49f9-a8a0-6903d5272710'
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · EMILIO COMO ALUMNO — 8 reservas con 8 tutores distintos
-- ════════════════════════════════════════════════════════════════════════════
-- Las mentorías salen de dev-poblar.sql. Van por `join`, así que si ese seed no
-- está aplicado estas filas sencillamente no se crean.
--
-- DOS completadas se quedan SIN reseña a propósito: es el único modo de ver el
-- CTA «¿Cómo te fue? Deja tu reseña» en /reservas.
drop table if exists _ey_emilio_alumno;
create temporary table _ey_emilio_alumno (
  n int, producto uuid, estado public.booking_status,
  dias numeric, rating smallint, comentario text
);

insert into _ey_emilio_alumno values
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
  ('ea000004-0000-4000-8000-0000000000' || lpad(a.n::text, 2, '0'))::uuid,
  '96b6e155-45c8-49f9-a8a0-6903d5272710', a.producto, p.tutor_id, a.estado,
  p.pricing_model, 1, p.session_duration_min, p.currency,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  (case when p.pricing_model = 'per_hour'
        then round(p.price_amount * p.session_duration_min / 60.0)
        else p.price_amount end)::bigint,
  coalesce(ti.split_pct, 75.00),
  coalesce(tp.payout_country, 'VE'),
  -- Emilio está en America/Panama: aquí se ve el ruteo de cobro de PA de verdad.
  public.pais_de_cobro_por_zona('America/Panama'),
  case when a.estado = 'completed' then now() - make_interval(days => a.dias::int) end,
  case when a.estado = 'cancelled' then now() - make_interval(days => a.dias::int - 2) end,
  case when a.estado = 'cancelled' then 'Cancelada por el alumno: se solapaba con un viaje.' end,
  now() - make_interval(secs => a.dias * 86400 + 3 * 86400),
  now() - make_interval(secs => a.dias * 86400)
from _ey_emilio_alumno a
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
where b.id::text like 'ea000004-0000-4000-8000-%'
  and b.status <> 'pending_acceptance'
on conflict (booking_id) do nothing;

-- Sus sesiones van a las 17:00 UTC: los tutores del seed ya tienen las suyas a
-- las 10:00 y `sessions_sin_solape_por_tutor` mira el intervalo del TUTOR, que
-- aquí es otra persona en cada fila.
insert into public.sessions (
  id, booking_id, tutor_id, student_id, sequence_no,
  start_at, end_at, status, completed_at, cancelled_at,
  access_opens_at, access_closes_at, created_at
)
select
  ('ea000005-0000-4000-8000-0000000001' || lpad(a.n::text, 2, '0'))::uuid,
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
from _ey_emilio_alumno a
join public.bookings b
  on b.id = ('ea000004-0000-4000-8000-0000000000' || lpad(a.n::text, 2, '0'))::uuid
join lateral (select
  case
    when a.estado = 'pending_acceptance'
      then date_trunc('day', now()) + interval '7 days 17 hours'
    when a.dias < 0
      then date_trunc('day', now()) + make_interval(days => (-a.dias)::int, hours => 17)
    else date_trunc('day', now()) - make_interval(days => a.dias::int) + interval '17 hours'
  end as at) inicio on true
where not exists (select 1 from public.sessions s where s.booking_id = b.id);

-- Las dos reseñas que SÍ dejó. (Suben el rating de esos tutores: es dev.)
insert into public.reviews (
  id, booking_id, student_id, tutor_id, product_id, rating, comment, created_at
)
select
  ('ea000008-0000-4000-8000-0000000001' || lpad(a.n::text, 2, '0'))::uuid,
  b.id, b.student_id, b.tutor_id, b.product_id, a.rating, a.comentario,
  b.completed_at + interval '2 days'
from _ey_emilio_alumno a
join public.bookings b
  on b.id = ('ea000004-0000-4000-8000-0000000000' || lpad(a.n::text, 2, '0'))::uuid
where a.rating is not null
on conflict (booking_id) do nothing;

drop table _ey_emilio_alumno;


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · CHAT — tres hilos, en los dos sentidos
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ AQUÍ NO SE CREA NINGUNA CONVERSACIÓN, Y ES LO CORRECTO: desde M-12 toda
-- reserva abre su hilo sola por el trigger `bookings_ensure_conversation`
-- (`20260820180000`). O sea que al insertar las secciones 5 y 7 ya nacieron
-- doce hilos con id ALEATORIO, y un `insert` con id fijo choca contra
-- `conversations_pair_unique` — el par ya tiene el suyo. `on conflict do
-- nothing` se lo traga en silencio y los mensajes se quedan sin FK.
-- Así que el hilo se BUSCA por su par (alumno, tutor), que es su clave de
-- verdad, y si no existe la fila no se inserta.
--
-- ⚠️ `expires_at` va NULO Y ESCRITO A MANO. Omitir la columna NO da null: su
-- DEFAULT sigue siendo `now() + interval '30 days'` (EP-17), y desde
-- `20260817210000` el check `messages_caducidad_por_reserva` exige
-- `(booking_id is null) = (expires_at is null)`. O sea: un mensaje de hilo
-- libre —sin reserva detrás— NO caduca, y dejar que el default hable lo
-- rechaza la base.
insert into public.messages (id, conversation_id, sender_id, body, created_at, expires_at)
select v.id, c.id, v.sender, v.body, v.at, null
from (values
  -- Hilo 1 · Julián le escribe a Emilio (aquí Emilio es el TUTOR)
  ('ea000007-0000-4000-8000-000000000101'::uuid,
   '44444444-0000-4000-8000-000000000002'::uuid, '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   '44444444-0000-4000-8000-000000000002'::uuid,
   'Hola Emilio. Te pedí la mentoría de carrera. Trabajo en logística y quiero moverme a un rol de producto, ¿lo ves razonable?',
   now() - interval '3 hours'),
  ('ea000007-0000-4000-8000-000000000102'::uuid,
   '44444444-0000-4000-8000-000000000002'::uuid, '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   'Muy razonable, y el salto se hace mejor desde dentro de tu sector que desde fuera. Mándame el CV antes de la sesión y lo llevo leído.',
   now() - interval '2 hours 30 minutes'),
  ('ea000007-0000-4000-8000-000000000103'::uuid,
   '44444444-0000-4000-8000-000000000002'::uuid, '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   '44444444-0000-4000-8000-000000000002'::uuid,
   'Perfecto, te lo paso esta tarde. Gracias.',
   now() - interval '2 hours'),
  -- Hilo 2 · Rocío
  ('ea000007-0000-4000-8000-000000000201'::uuid,
   '44444444-0000-4000-8000-000000000003'::uuid, '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   '44444444-0000-4000-8000-000000000003'::uuid,
   '¿La sesión de Excel la damos sobre mis números o prefieres un caso tuyo? Los míos están un poco desordenados.',
   now() - interval '22 hours'),
  ('ea000007-0000-4000-8000-000000000202'::uuid,
   '44444444-0000-4000-8000-000000000003'::uuid, '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   'Sobre los tuyos, desordenados y todo. Ordenarlos es media clase y es la mitad que de verdad te sirve después.',
   now() - interval '20 hours'),
  -- Hilo 3 · Emilio escribe a Andrés (aquí Emilio es el ALUMNO)
  ('ea000007-0000-4000-8000-000000000301'::uuid,
   '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid, '11111111-0000-4000-8000-000000000006'::uuid,
   '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid,
   'Hola Andrés, tengo el IELTS en seis semanas y voy justo de writing. ¿Da tiempo?',
   now() - interval '2 days'),
  ('ea000007-0000-4000-8000-000000000302'::uuid,
   '96b6e155-45c8-49f9-a8a0-6903d5272710'::uuid, '11111111-0000-4000-8000-000000000006'::uuid,
   '11111111-0000-4000-8000-000000000006'::uuid,
   'Da tiempo de sobra si trabajamos con la rúbrica delante desde la primera sesión. Mándame un Task 2 tuyo tal cual, sin retocarlo.',
   now() - interval '1 day')
) as v(id, alumno, tutor, sender, body, at)
join public.conversations c
  on c.student_id = v.alumno and c.tutor_id = v.tutor
on conflict (id) do nothing;

-- La bandeja ordena por `last_message_at` y el trigger de la reserva lo deja
-- nulo: sin esto los tres hilos con texto caen al fondo de la lista.
update public.conversations c
   set last_message_at = m.ultimo
  from (select conversation_id, max(created_at) as ultimo
          from public.messages
         where id::text like 'ea000007-0000-4000-8000-%'
         group by conversation_id) m
 where c.id = m.conversation_id;


-- ════════════════════════════════════════════════════════════════════════════
-- 9 · AVISOS DE CAMPANA — tres sin leer, tres leídos
-- ════════════════════════════════════════════════════════════════════════════
-- `channel = 'in_app'` para que el job de correo NO los recoja: Resend está
-- verificado y emilio@faimlab.com es un buzón REAL.
insert into public.notifications (
  id, recipient_id, type, template, channel, status, payload, idempotency_key,
  read_at, sent_at, created_at
)
values
  ('ea000009-0000-4000-8000-000000000001','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'NTF-07','booking_new_tutor','in_app','sent'::public.notification_status,
   '{"booking_id":"ea000003-0000-4000-8000-000000000010"}'::jsonb, 'ey-emilio:ntf07:booking:10',
   null, now() - interval '2 hours', now() - interval '2 hours'),
  ('ea000009-0000-4000-8000-000000000002','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'NTF-08','booking_expiring_tutor','in_app','sent'::public.notification_status,
   '{"booking_id":"ea000003-0000-4000-8000-000000000011"}'::jsonb, 'ey-emilio:ntf08:booking:11',
   null, now() - interval '1 hour', now() - interval '1 hour'),
  ('ea000009-0000-4000-8000-000000000003','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'NTF-16','review_received_tutor','in_app','sent'::public.notification_status,
   '{}'::jsonb, 'ey-emilio:ntf16:review',
   null, now() - interval '11 days', now() - interval '11 days'),
  ('ea000009-0000-4000-8000-000000000004','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'NTF-13','payout_paid','in_app','sent'::public.notification_status,
   '{"payout_id":"ea000006-0000-4000-8000-000000000001"}'::jsonb, 'ey-emilio:ntf13:payout:01',
   now() - interval '24 days', now() - interval '25 days', now() - interval '25 days'),
  ('ea000009-0000-4000-8000-000000000005','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'NTF-12','review_request','in_app','sent'::public.notification_status,
   '{"booking_id":"ea000004-0000-4000-8000-000000000004"}'::jsonb, 'ey-emilio:ntf12:review-request:04',
   now() - interval '5 days', now() - interval '5 days', now() - interval '5 days'),
  ('ea000009-0000-4000-8000-000000000006','96b6e155-45c8-49f9-a8a0-6903d5272710',
   'NTF-03','tutor_review_result','in_app','sent'::public.notification_status,
   '{}'::jsonb, 'ey-emilio:ntf03:tutor-approved',
   now() - interval '59 days', now() - interval '60 days', now() - interval '60 days')
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — CÓRRELA APARTE, EN OTRA PESTAÑA
-- ════════════════════════════════════════════════════════════════════════════
-- Va comentada a propósito: un `select` al final de este archivo es justo lo
-- que enmascara un error veinte sentencias más arriba (ver la cabecera).
--
-- ── 1. Que sus mentorías se puedan reservar de verdad ──────────────────────
--   select p.title, p.status, p.session_duration_min as dur,
--          (select count(*) from public.get_available_slots(p.id, current_date, current_date + 21)) as slots
--     from public.products p
--    where p.tutor_id = '96b6e155-45c8-49f9-a8a0-6903d5272710'
--    order by slots asc;
--   Se esperan 7 filas; las 5 'active' con slots > 0 (draft y paused, en 0).
--
-- ── 2. Los dos paneles, de un vistazo ──────────────────────────────────────
--   select
--     (select count(*) from public.bookings where tutor_id   = '96b6e155-45c8-49f9-a8a0-6903d5272710') as reservas_como_tutor,
--     (select count(*) from public.bookings where student_id = '96b6e155-45c8-49f9-a8a0-6903d5272710') as reservas_como_alumno,
--     (select count(*) from public.reviews  where tutor_id   = '96b6e155-45c8-49f9-a8a0-6903d5272710') as resenas_recibidas,
--     (select rating_avg from public.tutor_profiles where profile_id = '96b6e155-45c8-49f9-a8a0-6903d5272710') as rating,
--     (select count(*) from public.user_roles where user_id = '96b6e155-45c8-49f9-a8a0-6903d5272710') as roles;
--   Se espera 12 / 8 / 5 / ~4.8 / 2.
--
-- ── 3. El saldo que verá en /tutor/payouts ─────────────────────────────────
-- No se llama a `tutor_balance()`: es SECURITY DEFINER y lee `auth.uid()`, que
-- aquí es null. Se repite su misma cuenta a mano.
--   select
--     sum(pay.tutor_net_amount) filter (where b.completed_at <= now() - interval '7 days') as disponible,
--     sum(pay.tutor_net_amount) filter (where b.completed_at >  now() - interval '7 days') as en_retencion
--   from public.bookings b
--   join public.payments pay on pay.booking_id = b.id
--   where b.tutor_id = '96b6e155-45c8-49f9-a8a0-6903d5272710'
--     and b.status = 'completed';
--   Se esperan las dos con cifra: la reserva de hace 3 días cae en retención.
