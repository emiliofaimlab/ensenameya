-- ============================================================================
-- Enséñame Ya — Clasificados · fases 2 y 3: el alumno publica, los tutores
-- de la categoría postulan con una propuesta de clase lista para pagar.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `Clasificados-EnsenameYa-v1.pdf` (opción D). Emilio, vía Verónica (24-nov),
-- autorizó construirlo SIN esperar las diez preguntas a Néstor: se responden
-- abajo con valores por defecto, cada uno en un solo sitio para cambiarlo.
--
-- ── LA PIEZA CLAVE: UNA POSTULACIÓN ES UNA PROPUESTA ───────────────────────
-- No hay tabla de postulaciones. Postular = crear una `class_proposals`
-- (20261124140000) con `request_id` y `note`. Así el pago, la confirmación sin
-- `pending_acceptance`, el chat y la tarjeta ya existen. Lo nuevo:
--   · `class_requests` — el clasificado. Nadie la lee entera salvo su dueño y
--     el admin; el público y los tutores la ven por `clasificados_publicos`,
--     que NO devuelve al alumno («público sin datos personales»).
--   · Pagar una postulación (trigger `propuesta_pagada`) deja el clasificado
--     `reserved` y retira las demás postulaciones avisando a sus tutores.
--
-- ── DECISIONES POR DEFECTO (las diez de Néstor) ────────────────────────────
--   1. Vigencia sin fecha límite: 14 días (`clasificado_vigencia()`). Fecha
--      límite como mucho a 90 días.
--   2. Máximo 10 tutores postulados por clasificado (`clasificado_max_postulaciones()`).
--   3. La postulación NO gasta los 5 mensajes previos (ya así en la fase 1).
--   4. Aviso a los tutores de la categoría: al instante (NTF-57).
--   5. El listado lo ve cualquiera, sin registro, sin datos del alumno.
--   6. No se pide presupuesto: el precio sale de la oferta.
--   7. Solo horarios de la agenda publicada del tutor.
--   8. Solo ofertas 1:1 de una sesión, sin academias.
--   9. El admin no publica en nombre de alumnos (no en este corte).
--  10. Términos y Privacidad: los redacta el cliente; no se tocan aquí.
--   Además: 3 clasificados activos por alumno, 30 postulaciones por tutor/día.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Job nuevo de pg_cron `caducar-clasificados` (cada hora). Tras aplicar,
--   mirar su última corrida (regla de oro 11).
-- · Avisos NTF-57…60 (plantillas request_*), encolados con literales.
-- · `class_requests` tiene PK propia: no es tabla puente (regla de oro 10).
-- ============================================================================

-- ── 0 · Valores por defecto, en un solo sitio ───────────────────────────────
create or replace function public.clasificado_vigencia()
returns interval language sql immutable set search_path = '' as $$ select interval '14 days' $$;
create or replace function public.clasificado_max_postulaciones()
returns int language sql immutable set search_path = '' as $$ select 10 $$;
revoke execute on function public.clasificado_vigencia() from public, anon, authenticated;
revoke execute on function public.clasificado_max_postulaciones() from public, anon, authenticated;

-- «Sin teléfonos ni correos»: correo, 8+ dígitos seguidos (con separadores) o
-- enlaces de mensajería. Es un freno, no una garantía: el reporte del chat sigue.
create or replace function public.texto_con_contacto(p text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p, '') ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
      or coalesce(p, '') ~ '\+?\d[\d\s().-]{6,}\d'
      or coalesce(p, '') ~* '(wa\.me|whatsapp|t\.me/|telegram)'
$$;
revoke execute on function public.texto_con_contacto(text) from public, anon, authenticated;

-- ── 1 · El clasificado ───────────────────────────────────────────────────────
create table if not exists public.class_requests (
  id          uuid        primary key default gen_random_uuid(),
  student_id  uuid        not null references public.profiles (id) on delete cascade,
  category_id uuid        not null references public.categories (id) on delete restrict,
  goal        text        not null check (char_length(btrim(goal)) between 3 and 120),
  detail      text        check (detail is null or char_length(detail) <= 1000),
  slots       jsonb       not null,
  timezone    text        not null,
  needed_by   date,
  status      text        not null default 'active'
              check (status in ('active', 'reserved', 'expired', 'closed', 'removed')),
  expires_at  timestamptz not null,
  closed_at   timestamptz,
  removed_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.class_requests is
  'Clasificados: lo que un alumno quiere lograr, en qué categoría y en qué franjas puede. Lo escriben solo las funciones de este fichero. El público y los tutores lo leen por clasificados_publicos(), sin el alumno.';
comment on column public.class_requests.slots is
  'Franjas semanales en la HORA DEL ALUMNO (`timezone`): [{"dia":0-6 (0=domingo),"desde":"HH:MM","hasta":"HH:MM"}]. Se guardan con su zona y no en UTC porque una franja semanal no es un instante; quien la pinta la convierte.';
comment on column public.class_requests.timezone is 'Zona IANA del alumno al publicar (profiles.timezone).';
comment on column public.class_requests.needed_by is 'Para cuándo lo necesita, en su calendario. Si viene, el clasificado vence al acabar ese día.';
comment on column public.class_requests.status is
  'active → reserved (pagó una postulación) | expired (venció; se puede republicar) | closed (ya no lo necesita) | removed (lo retiró el admin).';

create index if not exists class_requests_activos_idx
  on public.class_requests (category_id, created_at desc) where status = 'active';
create index if not exists class_requests_alumno_idx on public.class_requests (student_id, created_at desc);

drop trigger if exists class_requests_set_updated_at on public.class_requests;
create trigger class_requests_set_updated_at
  before update on public.class_requests
  for each row execute function public.set_updated_at();

alter table public.class_requests enable row level security;

drop policy if exists "class_requests_select_own" on public.class_requests;
create policy "class_requests_select_own"
  on public.class_requests for select
  using ( (select auth.uid()) = student_id );

drop policy if exists "class_requests_select_admin" on public.class_requests;
create policy "class_requests_select_admin"
  on public.class_requests for select
  using ( public.has_role('admin') );

grant select on public.class_requests to authenticated;
grant select on public.class_requests to service_role;

-- ── 2 · La postulación vive en la propuesta ──────────────────────────────────
alter table public.class_proposals
  add column if not exists request_id uuid references public.class_requests (id) on delete set null,
  add column if not exists note text check (note is null or char_length(note) <= 200);

comment on column public.class_proposals.request_id is
  'Si no es null, esta propuesta ES una postulación a ese clasificado.';
comment on column public.class_proposals.note is
  'El mensaje corto de la postulación (≤ 200, sin contacto). Va también como cuerpo del mensaje del chat.';

create index if not exists class_proposals_request_idx
  on public.class_proposals (request_id) where request_id is not null;

-- El alumno ve las postulaciones de SUS clasificados (ya las ve por ser el par,
-- pero esto deja claro el porqué y cubre a un tercero si un día se comparte).
-- No hace falta política nueva: student_id de la propuesta = dueño del clasificado.

-- ── 3 · Franjas: validar y contener ──────────────────────────────────────────
create or replace function public.franjas_validas(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p) < 1 or jsonb_array_length(p) > 21 then return false; end if;
  for f in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(f) is distinct from 'object'
       or (f->>'dia') !~ '^[0-6]$'
       or (f->>'desde') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or (f->>'hasta') !~ '^(([01]\d|2[0-3]):[0-5]\d|24:00)$'
       or (f->>'desde')::time >= (f->>'hasta')::time then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke execute on function public.franjas_validas(jsonb) from public, anon, authenticated;

-- ¿Una clase que empieza en p_start y dura p_dur cabe ENTERA en una franja?
create or replace function public.clasificado_admite(p_req uuid, p_start timestamptz, p_dur int)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.class_requests r
      cross join lateral jsonb_array_elements(r.slots) f
     where r.id = p_req
       and extract(dow from (p_start at time zone r.timezone))::int = (f->>'dia')::int
       and (p_start at time zone r.timezone)::time >= (f->>'desde')::time
       -- Sin cruzar la medianoche: `time + interval` da la vuelta.
       and ((p_start + make_interval(mins => p_dur)) at time zone r.timezone)::date
           = (p_start at time zone r.timezone)::date
       and ((p_start + make_interval(mins => p_dur)) at time zone r.timezone)::time
           <= (f->>'hasta')::time
  )
  -- '24:00' compara bien con `time`; el caso «acaba justo a medianoche» lo
  -- cubre la fecha del día siguiente, que se rechaza arriba. Techo aceptado.
$$;
revoke execute on function public.clasificado_admite(uuid, timestamptz, int) from public, anon, authenticated;

-- ── 4 · Crear una propuesta (núcleo compartido) ──────────────────────────────
-- Lo que hacía `proponer_clase` tras sus comprobaciones de identidad, para que
-- `postular_a_clasificado` no lo duplique. Sin grant: la llaman dos DEFINER.
create or replace function public.crear_propuesta(
  p_conversation uuid,
  p_tutor        uuid,
  p_student      uuid,
  p_product      uuid,
  p_title        text,
  p_start        timestamptz,
  p_request      uuid,
  p_note         text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n  int;
  v_id uuid;
begin
  if not exists (
    select 1 from public.get_available_slots(p_product, current_date, current_date + 30) g
     where g.slot_start = p_start
  ) then
    raise exception 'ese horario ya no está libre en tu agenda; elige otro' using errcode = 'check_violation';
  end if;

  select count(*) into v_n
    from public.class_proposals
   where conversation_id = p_conversation and created_at > now() - interval '24 hours';
  if v_n >= 5 then
    raise exception 'ya enviaste 5 propuestas en este chat hoy; espera la respuesta del alumno'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
      from public.class_proposals cp
      join public.bookings b
        on b.student_id = cp.student_id and b.product_id = cp.product_id
       and b.status = 'pending_payment'
      join public.sessions s on s.booking_id = b.id and s.start_at = cp.start_at
     where cp.conversation_id = p_conversation and cp.status = 'pending'
  ) then
    raise exception 'el alumno está pagando tu propuesta en este momento; espera unos minutos'
      using errcode = 'check_violation';
  end if;

  update public.class_proposals
     set status = 'withdrawn'
   where conversation_id = p_conversation and status = 'pending';

  insert into public.class_proposals
    (conversation_id, tutor_id, student_id, product_id, start_at, request_id, note)
  values (p_conversation, p_tutor, p_student, p_product, p_start, p_request, p_note)
  returning id into v_id;

  insert into public.messages (conversation_id, booking_id, sender_id, body, expires_at, proposal_id)
  values (p_conversation, null, p_tutor,
          coalesce(nullif(btrim(p_note), ''),
                   'Te propuse una clase: «' || p_title || '». Revisa el horario y págala desde aquí.'),
          null, v_id);

  update public.conversations set last_message_at = now() where id = p_conversation;
  return v_id;
end;
$$;
revoke execute on function public.crear_propuesta(uuid, uuid, uuid, uuid, text, timestamptz, uuid, text)
  from public, anon, authenticated;

-- `proponer_clase` (misma firma) pasa a delegar en el núcleo.
create or replace function public.proponer_clase(
  p_conversation_id uuid,
  p_product_id      uuid,
  p_start           timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c   record;
  v_p   record;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select c.id, c.student_id, c.tutor_id, c.kind, c.blocked_at
    into v_c
    from public.conversations c
   where c.id = p_conversation_id
     for update;

  if v_c.id is null or v_c.kind <> 'pair' or v_c.student_id is null
     or v_c.tutor_id is distinct from v_uid then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;
  if v_c.blocked_at is not null then
    raise exception 'esta conversación está bloqueada por moderación' using errcode = 'check_violation';
  end if;

  select p.id, p.title into v_p
    from public.products p
    join public.tutor_profiles tp
      on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
   where p.id = p_product_id and p.tutor_id = v_uid and p.status = 'active'
     and p.visibility = 'public' and p.pricing_model in ('per_session', 'per_hour')
     and p.academy_id is null and p.group_template_id is null;
  if v_p.id is null then
    raise exception 'esa mentoría no se puede proponer: tiene que ser tuya, estar activa y ser de una sola sesión'
      using errcode = 'check_violation';
  end if;

  return public.crear_propuesta(v_c.id, v_uid, v_c.student_id, v_p.id, v_p.title,
                                p_start, null, null);
end;
$$;
revoke execute on function public.proponer_clase(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.proponer_clase(uuid, uuid, timestamptz) to authenticated;

-- ── 5 · Publicar ─────────────────────────────────────────────────────────────
drop function if exists public.publicar_clasificado(uuid, text, text, jsonb, date);
create function public.publicar_clasificado(
  p_category  uuid,
  p_goal      text,
  p_detail    text,
  p_slots     jsonb,
  p_needed_by date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_tz     text;
  v_goal   text := btrim(coalesce(p_goal, ''));
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_hoy    date;
  v_vence  timestamptz;
  v_id     uuid;
  v_cat    record;
  v_t      uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select name, slug into v_cat from public.categories where id = p_category and is_active;
  if v_cat.name is null then
    raise exception 'elige una categoría' using errcode = 'check_violation';
  end if;
  if char_length(v_goal) < 3 or char_length(v_goal) > 120 then
    raise exception 'cuéntanos en una línea qué quieres lograr (entre 3 y 120 caracteres)' using errcode = 'check_violation';
  end if;
  if v_detail is not null and char_length(v_detail) > 1000 then
    raise exception 'el detalle admite hasta 1000 caracteres' using errcode = 'check_violation';
  end if;
  if public.texto_con_contacto(v_goal) or public.texto_con_contacto(v_detail) then
    raise exception 'quita teléfonos, correos o enlaces de mensajería: el contacto va por el chat de la plataforma'
      using errcode = 'check_violation';
  end if;
  if not public.franjas_validas(p_slots) then
    raise exception 'indica al menos un horario en que puedes (día, desde y hasta)' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.class_requests
       where student_id = v_uid and status = 'active') >= 3 then
    raise exception 'ya tienes 3 clasificados activos; cierra uno para publicar otro' using errcode = 'check_violation';
  end if;

  select coalesce(nullif(timezone, ''), 'UTC') into v_tz from public.profiles where id = v_uid;
  v_tz := coalesce(v_tz, 'UTC');
  v_hoy := (now() at time zone v_tz)::date;

  if p_needed_by is not null then
    if p_needed_by < v_hoy or p_needed_by > v_hoy + 90 then
      raise exception 'la fecha límite tiene que estar entre hoy y dentro de 90 días' using errcode = 'check_violation';
    end if;
    v_vence := ((p_needed_by + 1)::timestamp at time zone v_tz);
  else
    v_vence := now() + public.clasificado_vigencia();
  end if;

  insert into public.class_requests
    (student_id, category_id, goal, detail, slots, timezone, needed_by, expires_at)
  values (v_uid, p_category, v_goal, v_detail, p_slots, v_tz, p_needed_by, v_vence)
  returning id into v_id;

  -- NTF-57 · a los tutores que PUEDEN postular: aprobados con una oferta 1:1
  -- activa y pública en la categoría (la misma condición que postular).
  for v_t in
    select distinct p.tutor_id
      from public.products p
      join public.product_categories pc on pc.product_id = p.id and pc.category_id = p_category
      join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
     where p.status = 'active' and p.visibility = 'public'
       and p.pricing_model in ('per_session', 'per_hour')
       and p.academy_id is null and p.group_template_id is null
       and p.tutor_id <> v_uid
  loop
    perform public.enqueue_notification(v_t, 'NTF-57', 'email', 'request_new_tutor',
      jsonb_build_object('request_id', v_id, 'objetivo', v_goal, 'categoria', v_cat.name),
      'NTF-57:request:' || v_id || ':' || v_t);
  end loop;

  return v_id;
end;
$$;
comment on function public.publicar_clasificado(uuid, text, text, jsonb, date) is
  'Clasificados · el alumno publica qué quiere lograr. Valida categoría, textos sin contacto, franjas y el tope de 3 activos; vence al acabar needed_by o a los 14 días. Avisa (NTF-57) a los tutores que pueden postular.';
revoke execute on function public.publicar_clasificado(uuid, text, text, jsonb, date) from public, anon;
grant  execute on function public.publicar_clasificado(uuid, text, text, jsonb, date) to authenticated;

-- ── 6 · Leer sin el alumno ───────────────────────────────────────────────────
drop function if exists public.clasificados_publicos(uuid, uuid, int);
create function public.clasificados_publicos(
  p_id       uuid default null,
  p_category uuid default null,
  p_limit    int  default 60
)
returns table (
  id uuid, category_id uuid, category_name text, category_slug text,
  goal text, detail text, slots jsonb, timezone text, needed_by date,
  created_at timestamptz, expires_at timestamptz, postulaciones int
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.category_id, c.name, c.slug,
         r.goal, r.detail, r.slots, r.timezone, r.needed_by,
         r.created_at, r.expires_at,
         (select count(distinct cp.tutor_id)::int from public.class_proposals cp
           where cp.request_id = r.id and cp.status in ('pending', 'paid'))
    from public.class_requests r
    join public.categories c on c.id = r.category_id
   where r.status = 'active' and r.expires_at > now()
     and (p_id is null or r.id = p_id)
     and (p_category is null or r.category_id = p_category)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 60), 1), 200)
$$;
comment on function public.clasificados_publicos(uuid, uuid, int) is
  'Clasificados · listado público (anon incluido) de los activos y no vencidos, SIN el alumno: columnas explícitas. Con p_id, uno solo.';
revoke execute on function public.clasificados_publicos(uuid, uuid, int) from public;
grant  execute on function public.clasificados_publicos(uuid, uuid, int) to anon, authenticated;

-- ── 7 · Postular ─────────────────────────────────────────────────────────────
drop function if exists public.postular_a_clasificado(uuid, uuid, timestamptz, text);
create function public.postular_a_clasificado(
  p_request uuid,
  p_product uuid,
  p_start   timestamptz,
  p_note    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_r    record;
  v_p    record;
  v_note text := btrim(coalesce(p_note, ''));
  v_conv uuid;
  v_blq  timestamptz;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select r.id, r.student_id, r.category_id, r.goal, r.status, r.expires_at
    into v_r
    from public.class_requests r
   where r.id = p_request
     for update;
  if v_r.id is null or v_r.status <> 'active' or v_r.expires_at <= now() then
    raise exception 'este clasificado ya no recibe postulaciones' using errcode = 'check_violation';
  end if;
  if v_r.student_id = v_uid then
    raise exception 'no puedes postular a tu propio clasificado' using errcode = 'check_violation';
  end if;

  select p.id, p.title, p.session_duration_min into v_p
    from public.products p
    join public.tutor_profiles tp
      on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
    join public.product_categories pc
      on pc.product_id = p.id and pc.category_id = v_r.category_id
   where p.id = p_product and p.tutor_id = v_uid and p.status = 'active'
     and p.visibility = 'public' and p.pricing_model in ('per_session', 'per_hour')
     and p.academy_id is null and p.group_template_id is null;
  if v_p.id is null then
    raise exception 'necesitas una mentoría tuya 1:1, activa y de esta categoría para postular'
      using errcode = 'check_violation';
  end if;

  if char_length(v_note) < 1 or char_length(v_note) > 200 then
    raise exception 'escribe un mensaje corto para el alumno (hasta 200 caracteres)' using errcode = 'check_violation';
  end if;
  if public.texto_con_contacto(v_note) then
    raise exception 'quita teléfonos, correos o enlaces de mensajería: el contacto va por el chat de la plataforma'
      using errcode = 'check_violation';
  end if;

  if p_start >= v_r.expires_at
     or not public.clasificado_admite(v_r.id, p_start, coalesce(v_p.session_duration_min, 60)) then
    raise exception 'elige un horario dentro de las franjas que indicó el alumno' using errcode = 'check_violation';
  end if;

  -- Tope por clasificado: tutores distintos con postulación viva o pagada.
  if not exists (select 1 from public.class_proposals
                  where request_id = v_r.id and tutor_id = v_uid and status = 'pending')
     and (select count(distinct tutor_id) from public.class_proposals
           where request_id = v_r.id and status in ('pending', 'paid'))
         >= public.clasificado_max_postulaciones() then
    raise exception 'este clasificado ya tiene el máximo de postulaciones' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.class_proposals
       where tutor_id = v_uid and request_id is not null
         and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'llegaste al máximo de postulaciones de hoy; vuelve mañana' using errcode = 'check_violation';
  end if;

  -- El hilo del par: lo abre el TUTOR (open_conversation es solo del alumno).
  insert into public.conversations (student_id, tutor_id)
  values (v_r.student_id, v_uid)
  on conflict (student_id, tutor_id) do update set updated_at = now()
  returning id, blocked_at into v_conv, v_blq;
  if v_blq is not null then
    raise exception 'esta conversación está bloqueada por moderación' using errcode = 'check_violation';
  end if;
  perform 1 from public.conversations where id = v_conv for update;

  v_id := public.crear_propuesta(v_conv, v_uid, v_r.student_id, v_p.id, v_p.title,
                                 p_start, v_r.id, v_note);

  perform public.enqueue_notification(v_r.student_id, 'NTF-58', 'email', 'request_application_student',
    jsonb_build_object('request_id', v_r.id, 'objetivo', v_r.goal, 'proposal_id', v_id),
    'NTF-58:proposal:' || v_id);

  return v_id;
end;
$$;
comment on function public.postular_a_clasificado(uuid, uuid, timestamptz, text) is
  'Clasificados · un tutor aprobado con oferta 1:1 en la categoría postula: mensaje ≤ 200 sin contacto + oferta + hora libre dentro de las franjas del alumno. Abre (o recupera) el hilo del par y crea la propuesta con request_id. Una viva por tutor y clasificado (sustituye); máximo 10 tutores por clasificado.';
revoke execute on function public.postular_a_clasificado(uuid, uuid, timestamptz, text) from public, anon;
grant  execute on function public.postular_a_clasificado(uuid, uuid, timestamptz, text) to authenticated;

-- ── 8 · Cerrar las postulaciones de un clasificado (núcleo) ──────────────────
create or replace function public.retirar_postulaciones(p_request uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_x record;
begin
  for v_x in
    update public.class_proposals cp
       set status = 'withdrawn'
     where cp.request_id = p_request and cp.status = 'pending'
    returning cp.id, cp.tutor_id
  loop
    perform public.enqueue_notification(v_x.tutor_id, 'NTF-59', 'email', 'request_closed_tutor',
      jsonb_build_object('request_id', p_request, 'motivo', p_motivo,
                         'objetivo', (select goal from public.class_requests where id = p_request)),
      'NTF-59:proposal:' || v_x.id);
  end loop;
end;
$$;
revoke execute on function public.retirar_postulaciones(uuid, text) from public, anon, authenticated;

-- ── 9 · El alumno cierra o republica ─────────────────────────────────────────
drop function if exists public.cerrar_clasificado(uuid);
create function public.cerrar_clasificado(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.class_requests set status = 'closed', closed_at = now()
   where id = p_id and student_id = (select auth.uid()) and status in ('active', 'expired');
  if not found then
    raise exception 'este clasificado ya no se puede cerrar' using errcode = 'check_violation';
  end if;
  perform public.retirar_postulaciones(p_id, 'cerrado');
end;
$$;
revoke execute on function public.cerrar_clasificado(uuid) from public, anon;
grant  execute on function public.cerrar_clasificado(uuid) to authenticated;

drop function if exists public.republicar_clasificado(uuid);
create function public.republicar_clasificado(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.class_requests
       where student_id = (select auth.uid()) and status = 'active') >= 3 then
    raise exception 'ya tienes 3 clasificados activos; cierra uno para republicar' using errcode = 'check_violation';
  end if;
  update public.class_requests
     set status = 'active', needed_by = null, closed_at = null,
         expires_at = now() + public.clasificado_vigencia()
   where id = p_id and student_id = (select auth.uid()) and status = 'expired';
  if not found then
    raise exception 'solo se republica un clasificado vencido' using errcode = 'check_violation';
  end if;
end;
$$;
revoke execute on function public.republicar_clasificado(uuid) from public, anon;
grant  execute on function public.republicar_clasificado(uuid) to authenticated;

-- ── 10 · El admin retira ─────────────────────────────────────────────────────
drop function if exists public.admin_retirar_clasificado(uuid, text);
create function public.admin_retirar_clasificado(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then
    raise exception 'solo el admin' using errcode = 'insufficient_privilege';
  end if;
  update public.class_requests
     set status = 'removed', closed_at = now(),
         removed_reason = nullif(left(btrim(coalesce(p_motivo, '')), 500), '')
   where id = p_id and status in ('active', 'expired');
  if not found then
    raise exception 'ese clasificado ya no está activo' using errcode = 'check_violation';
  end if;
  perform public.retirar_postulaciones(p_id, 'retirado');
end;
$$;
revoke execute on function public.admin_retirar_clasificado(uuid, text) from public, anon;
grant  execute on function public.admin_retirar_clasificado(uuid, text) to authenticated;

-- Lo que ve Néstor: demanda por categoría.
drop function if exists public.admin_clasificados_resumen();
create function public.admin_clasificados_resumen()
returns table (
  category_id uuid, category_name text,
  publicados int, activos int, activos_sin_postulacion int, con_postulacion int,
  reservados int, vencidos_sin_postulacion int, horas_hasta_primera numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then
    raise exception 'solo el admin' using errcode = 'insufficient_privilege';
  end if;
  return query
  with r as (
    select r.*,
           (select min(cp.created_at) from public.class_proposals cp where cp.request_id = r.id) as primera
      from public.class_requests r
  )
  select c.id, c.name,
         count(r.id)::int,
         count(*) filter (where r.status = 'active' and r.expires_at > now())::int,
         count(*) filter (where r.status = 'active' and r.expires_at > now() and r.primera is null)::int,
         count(*) filter (where r.primera is not null)::int,
         count(*) filter (where r.status = 'reserved')::int,
         count(*) filter (where r.status = 'expired' and r.primera is null)::int,
         round((avg(extract(epoch from (r.primera - r.created_at)) / 3600)
                filter (where r.primera is not null))::numeric, 1)
    from public.categories c
    join r on r.category_id = c.id
   group by c.id, c.name
   order by count(*) filter (where r.status = 'active' and r.expires_at > now() and r.primera is null) desc,
            count(r.id) desc;
end;
$$;
revoke execute on function public.admin_clasificados_resumen() from public, anon;
grant  execute on function public.admin_clasificados_resumen() to authenticated;

-- ── 11 · Vencer ──────────────────────────────────────────────────────────────
create or replace function public.caducar_clasificados()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_r record;
  v_n int := 0;
begin
  for v_r in
    update public.class_requests set status = 'expired'
     where status = 'active' and expires_at <= now()
    returning id, student_id, goal
  loop
    v_n := v_n + 1;
    perform public.retirar_postulaciones(v_r.id, 'vencido');
    perform public.enqueue_notification(v_r.student_id, 'NTF-60', 'email', 'request_expired_student',
      jsonb_build_object('request_id', v_r.id, 'objetivo', v_r.goal),
      'NTF-60:request:' || v_r.id || ':' || to_char(now(), 'YYYYMMDD'));
  end loop;
  return v_n;
end;
$$;
comment on function public.caducar_clasificados() is
  'Clasificados · pg_cron cada hora: activos vencidos → expired, retira sus postulaciones (NTF-59) y avisa al alumno para republicar (NTF-60).';
revoke execute on function public.caducar_clasificados() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'caducar-clasificados') then
    perform cron.unschedule('caducar-clasificados');
  end if;
end
$cron$;
select cron.schedule('caducar-clasificados', '23 * * * *', $cron$ select public.caducar_clasificados() $cron$);

-- ── 12 · Pagar una postulación reserva el clasificado ────────────────────────
-- Misma función de 20261124140000 + el bloque «C ·». Sigue sin poder abortar:
-- todo va dentro del mismo bloque con `exception when others`.
create or replace function public.propuesta_pagada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok  boolean := false;
  v_req uuid;
begin
  if old.status is distinct from 'pending_payment'
     or new.status not in ('pending_acceptance', 'confirmed')
     or new.pricing_model not in ('per_session', 'per_hour') then
    return new;
  end if;

  begin
    update public.class_proposals cp
       set status = 'paid', booking_id = new.id
     where cp.status = 'pending'
       and cp.student_id = new.student_id
       and cp.product_id = new.product_id
       and exists (
         select 1 from public.sessions s
          where s.booking_id = new.id
            and s.start_at = cp.start_at
            and s.status <> 'cancelled')
    returning cp.request_id into v_req;
    v_ok := found;

    -- C · si era una postulación, el clasificado queda reservado y las demás
    -- postulaciones se retiran avisando a sus tutores.
    if v_ok and v_req is not null then
      update public.class_requests
         set status = 'reserved', closed_at = now()
       where id = v_req and status in ('active', 'expired');
      perform public.retirar_postulaciones(v_req, 'reservado');
    end if;
  exception when others then
    raise warning 'propuesta_pagada(%): %', new.id, sqlerrm;
    return new;
  end;

  if v_ok and new.status = 'pending_acceptance' then
    new.status := 'confirmed';
  end if;

  return new;
end;
$$;
