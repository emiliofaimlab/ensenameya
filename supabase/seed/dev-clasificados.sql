-- ============================================================================
-- Enséñame Ya — CLASIFICADOS DE DEMO.  ⚠️  SOLO DEV — NO aplicar a producción.
--
-- Vive fuera de supabase/migrations/: el CI no lo despliega nunca. Además:
--   · `npm run db:seed:clasificados` aborta si el proyecto enlazado no es dev;
--   · el bloque 0 de abajo aborta si no están las cuentas de `dev-poblar.sql`
--     (en producción no existen).
--
-- Qué deja (27-nov, para la demo con el cliente):
--   · 6 clasificados activos en áreas variadas, de los 4 alumnos de dev-poblar;
--   · en el de MATEMÁTICAS (de Marina Gómez), 4 postulaciones de 4 tutores
--     distintos, para ver cómo elige el alumno;
--   · 2 mentorías de matemáticas extra (Diego y Lucía) para que haya 4
--     tutores elegibles en esa categoría. Los cuatro ya tienen
--     `availability_rules` de dev-poblar, así que no sale «sin horarios libres».
--
-- Las postulaciones van por la RPC REAL (`postular_a_clasificado`), suplantando
-- al tutor: crean la conversación, la tarjeta en el chat y el aviso NTF-58 a la
-- alumna (campana + correo a marina.gomez@ensenameya.dev), igual que en la vida
-- real. Los clasificados se insertan directos para NO disparar NTF-57 a todos
-- los tutores de la categoría.
--
-- Se revierte con `npm run db:seed:clasificados:revertir`
-- (supabase/seed/dev-clasificados-revertir.sql).
--
-- Idempotente: UUIDs fijos, `on conflict` y no repostula si ya hay postulación.
--   99999999-… clasificados · 77777777-… mentorías extra
-- ============================================================================

-- ── 0 · Guarda: solo donde existen las cuentas de dev-poblar ────────────────
do $$
begin
  if not exists (select 1 from auth.users where email = 'marina.gomez@ensenameya.dev')
     or not exists (select 1 from auth.users where email = 'val.rios@ensenameya.dev') then
    raise exception 'dev-clasificados: faltan las cuentas de dev-poblar.sql — ¿no es dev? Abortado.';
  end if;
end $$;

-- ── 1 · Dos mentorías de matemáticas más (Diego y Lucía; los de academia no pueden tener propias) ───────────────────
insert into public.products (
  id, tutor_id, title, outcome, description, pricing_model, price_amount,
  currency, session_duration_min, status, level, language, auto_accept_bookings
)
values
  ('77777777-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000004',
   'Matemáticas de bachillerato sin miedo',
   'Resolver con soltura los ejercicios de funciones, límites y derivadas del examen.',
   'Repasamos la teoría justa y hacemos ejercicios tipo examen, de menos a más.',
   'per_session', 2000, 'USD', 60, 'active', 'intermedio', 'es', true),
  ('77777777-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000005',
   'Cálculo para primer año de ingeniería',
   'Aprobar Cálculo I entendiendo lo que haces, no memorizando.',
   'Sesiones prácticas sobre tus guías de ejercicios y parciales anteriores.',
   'per_session', 2500, 'USD', 60, 'active', 'avanzado', 'es', false)
on conflict (id) do nothing;

insert into public.product_categories (product_id, category_id)
select v.id, c.id
  from (values ('77777777-0000-4000-8000-000000000001'::uuid),
               ('77777777-0000-4000-8000-000000000002'::uuid)) as v(id)
  join public.categories c on c.slug = 'matematicas'
on conflict do nothing;

-- ── 2 · Seis clasificados ───────────────────────────────────────────────────
-- Franjas en la hora de cada alumna/o: [{"dia":0-6 (0=domingo),"desde","hasta"}].
-- La de matemáticas es amplia (todos los días 07-22) para que casen los cuatro
-- tutores. Vencen a los 14 días (`clasificado_vigencia`) o al acabar `needed_by`.
insert into public.class_requests
  (id, student_id, category_id, goal, detail, slots, timezone, needed_by, expires_at)
select v.id, v.alumno, c.id, v.goal, v.detail, v.slots::jsonb, p.timezone, v.para,
       least(now() + interval '14 days',
             coalesce(((v.para + 1)::timestamp at time zone p.timezone), now() + interval '14 days'))
  from (values
    ('99999999-0000-4000-8000-000000000001'::uuid, '44444444-0000-4000-8000-000000000001'::uuid, 'matematicas',
     'Aprobar el examen final de Cálculo I',
     'Tengo el final de Cálculo I a mediados de diciembre y me cuestan los límites y las derivadas. Busco alguien que me explique con paciencia y me ponga ejercicios tipo examen.',
     '[{"dia":0,"desde":"07:00","hasta":"22:00"},{"dia":1,"desde":"07:00","hasta":"22:00"},{"dia":2,"desde":"07:00","hasta":"22:00"},{"dia":3,"desde":"07:00","hasta":"22:00"},{"dia":4,"desde":"07:00","hasta":"22:00"},{"dia":5,"desde":"07:00","hasta":"22:00"},{"dia":6,"desde":"07:00","hasta":"22:00"}]',
     (current_date + 12)),
    ('99999999-0000-4000-8000-000000000002'::uuid, '44444444-0000-4000-8000-000000000002'::uuid, 'ciencias',
     'Entender la química orgánica del colegio',
     'Estoy en último año y no logro ver la lógica de las reacciones orgánicas. Quiero un par de sesiones para ordenar los temas antes de las pruebas.',
     '[{"dia":2,"desde":"16:00","hasta":"20:00"},{"dia":4,"desde":"16:00","hasta":"20:00"},{"dia":6,"desde":"09:00","hasta":"13:00"}]',
     null),
    ('99999999-0000-4000-8000-000000000003'::uuid, '44444444-0000-4000-8000-000000000003'::uuid, 'idiomas',
     'Soltarme hablando inglés en reuniones de trabajo',
     'Leo y escribo bien, pero en las reuniones con clientes me bloqueo. Busco conversación guiada con vocabulario de negocios.',
     '[{"dia":1,"desde":"18:00","hasta":"21:00"},{"dia":3,"desde":"18:00","hasta":"21:00"}]',
     null),
    ('99999999-0000-4000-8000-000000000004'::uuid, '44444444-0000-4000-8000-000000000004'::uuid, 'programacion',
     'Terminar mi primera app en React',
     'Hice un curso online y tengo una app de tareas a medias. Necesito a alguien que revise mi código y me ayude a desplegarla.',
     '[{"dia":2,"desde":"19:00","hasta":"22:00"},{"dia":4,"desde":"19:00","hasta":"22:00"},{"dia":6,"desde":"10:00","hasta":"14:00"}]',
     (current_date + 10)),
    ('99999999-0000-4000-8000-000000000005'::uuid, '44444444-0000-4000-8000-000000000001'::uuid, 'musica',
     'Tocar mis primeras canciones en guitarra',
     'Tengo guitarra acústica y sé dos acordes. Me gustaría poder acompañar canciones sencillas para Navidad.',
     '[{"dia":5,"desde":"15:00","hasta":"19:00"},{"dia":6,"desde":"10:00","hasta":"14:00"}]',
     (current_date + 13)),
    ('99999999-0000-4000-8000-000000000006'::uuid, '44444444-0000-4000-8000-000000000002'::uuid, 'preparacion-examenes',
     'Sacar 7 en el IELTS Academic',
     'Necesito un 7 para postular a una maestría. Mi punto débil es writing task 2. Busco estrategia y corrección de ensayos.',
     '[{"dia":1,"desde":"07:00","hasta":"10:00"},{"dia":3,"desde":"07:00","hasta":"10:00"},{"dia":5,"desde":"07:00","hasta":"10:00"}]',
     null)
  ) as v(id, alumno, slug, goal, detail, slots, para)
  join public.categories c on c.slug = v.slug
  join public.profiles p on p.id = v.alumno
on conflict (id) do nothing;

-- ── 3 · Cuatro postulaciones al de matemáticas, por la RPC real ─────────────
do $$
declare
  v_req   constant uuid := '99999999-0000-4000-8000-000000000001';
  v_exp   timestamptz;
  v_t     record;
  v_start timestamptz;
begin
  select expires_at into v_exp from public.class_requests where id = v_req;

  for v_t in
    select * from (values
      ('11111111-0000-4000-8000-000000000001'::uuid, '22222222-0000-4000-8000-000000000001'::uuid,
       'Doy Cálculo desde hace 6 años. Empezamos por límites con ejercicios de tu guía y llegamos a derivadas en dos sesiones.'),
      ('c1000000-0000-4000-8000-000000000001'::uuid, 'c2000000-0000-4000-8000-000000000001'::uuid,
       'Te preparo un simulacro del final y lo corregimos juntos: así ves qué temas repasar primero.'),
      ('11111111-0000-4000-8000-000000000004'::uuid, '77777777-0000-4000-8000-000000000001'::uuid,
       'Explico paso a paso y con dibujos. Ideal si los límites te parecen magia: en la primera clase dejan de serlo.'),
      ('11111111-0000-4000-8000-000000000005'::uuid, '77777777-0000-4000-8000-000000000002'::uuid,
       'Soy ingeniera y doy Cálculo I a primer año. Trae tus parciales anteriores y trabajamos sobre ellos.')
    ) as t(tutor, producto, nota)
  loop
    -- Idempotente: si este tutor ya postuló, no se repostula (crearía otra tarjeta).
    continue when exists (select 1 from public.class_proposals
                           where request_id = v_req and tutor_id = v_t.tutor
                             and status in ('pending', 'paid'));

    select s.slot_start into v_start
      from public.get_available_slots(v_t.producto, current_date, current_date + 20) s
     where s.slot_start > now() + interval '3 hours'
       and s.slot_start < v_exp
       and public.clasificado_admite(v_req, s.slot_start, 60)
     order by s.slot_start
     limit 1;

    if v_start is null then
      raise warning 'dev-clasificados: % no tiene hueco dentro de las franjas; se salta', v_t.tutor;
      continue;
    end if;

    -- Suplanta al tutor para que `auth.uid()` sea él (como lo haría su sesión).
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_t.tutor, 'role', 'authenticated')::text, true);
    perform public.postular_a_clasificado(v_req, v_t.producto, v_start, v_t.nota);
  end loop;

  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── 4 · Resumen ─────────────────────────────────────────────────────────────
select r.goal, r.status, r.expires_at,
       (select count(*) from public.class_proposals cp
         where cp.request_id = r.id and cp.status = 'pending') as postulaciones
  from public.class_requests r
 where r.id::text like '99999999-0000-4000-8000-%'
 order by r.id;
