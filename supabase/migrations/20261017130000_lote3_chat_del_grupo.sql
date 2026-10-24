-- ============================================================================
-- Enséñame Ya — Lote 3 del sondeo de grupales: el chat del grupo
-- (docs/SONDEO-GRUPALES-LOTES.md, «Lote 3 · Chat del grupo»)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `20261009110000_el_chat_grupal.sql` creó el hilo de cada clase grupal y dejó
-- escrito que la bandeja, el aviso por correo y el reporte quedaban para
-- después. El sondeo encontró lo que costaba ese «después»:
--
--   B3  · `my_conversations` no filtraba `kind`: el hilo del grupo (alumno
--         NULL) le salía a la tutora como un par con «tu alumno · Sin mentoría
--         reservada», y la página del chat lo tomaba por una consulta previa
--         de solo lectura con el tope de 5 mensajes.
--   B4  · `notify_new_message` salía en `if v_student is null`: los mensajes
--         del grupo no avisaban a nadie. Y el hilo no aparecía en la bandeja
--         del alumno.
--   M7  · `report_conversation` exigía ser alumno o tutor del PAR: en un chat
--         de hasta 11 desconocidos nadie podía reportar. Y la bandeja de
--         moderación cruzaba nulos con un reporte de grupo.
--   P12 · Quien se dio de baja y abre el enlace del chat recibía un 404 seco.
--         La pantalla necesita saber, sin confirmar hilos ajenos, a qué
--         reserva propia mandarlo.
--   P29 · El hilo nace con el apartado del pago, no con el primer pago: la
--         tutora veía «Abrir chat» con cero inscritos.
--   P46 · Una clase cancelada conservaba su chat 30 días después de una fecha
--         que ya no iba a ocurrir.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Funciones que REEMPLAZAN a su versión VIVA de dev (`pg_get_functiondef`,
--   16-oct; coincide con la del repo, nadie las redefinió en la otra rama),
--   con los cambios marcados «L3 ·»:
--     my_conversations           · 20260820180000:368-451. Cambia el tipo de
--                                  vuelta (dos columnas más al final), así que
--                                  es `drop` + `create` y se reponen los
--                                  grants (regla 12).
--     notify_new_message         · 20260826160000:124-196. Rama de grupo; el
--                                  bloque por destinatario pasa a un helper.
--     report_conversation        · 20260817210000:986-1025. Pertenencia con
--                                  `puede_ver_conversacion`.
--     hilo_grupal_caducado       · 20261009110000:71-87.
--     admin_conversation_reports · 20260826200000. Tolera hilos de grupo.
-- · Nuevas: `avisar_mensaje_nuevo` (privada, la lógica NTF-21 por persona) y
--   `reserva_tras_salir_del_grupo` (P12).
-- · El CONTRATO de `my_conversations` para las pantallas: las 14 columnas de
--   antes en el mismo orden y, al final, `kind` ('pair' | 'group') y
--   `group_product_id`. En las filas de grupo: `other_id` = tutor,
--   `other_name` = título de la clase, `has_booking` = `can_chat` = true,
--   recuentos a 0, `last_booking_id` = la reserva pagada del que mira (null
--   para el tutor). Solo salen hilos de grupo con al menos una reserva
--   confirmed / in_progress / completed (P29).
-- · NO se toca, a propósito (decisiones pendientes, regla 8):
--     M8  · los hilos privados vacíos que la tutora recibe por cada inscrito.
--     M7 (sub-nota) · el alumno sacado con el ciclo empezado queda `completed`
--           y `puede_ver_conversacion` lo sigue dejando entrar. Se decide con
--           M2; aquí se usa la pertenencia tal como está.
-- · `purge_expired_messages` (pg_cron, `purge-expired-messages`) llama a
--   `hilo_grupal_caducado`: tras aplicar, se mira su última corrida en
--   `cron.job_run_details` (regla 11).
-- ============================================================================


-- ── 1 · La bandeja: pares como siempre y, aparte, los hilos de grupo ────────
-- L3 · B3 + B4 + P29. Dos ramas unidas con `union all` en vez de `case` por
-- columna: así `pair_booking_stats` y `pair_can_chat` nunca se llaman con un
-- alumno NULL, y la rama de par queda copiada tal cual con un `kind = 'pair'`.
drop function if exists public.my_conversations();

create function public.my_conversations()
returns table (
  id                 uuid,
  other_id           uuid,
  other_name         text,
  other_avatar_path  text,
  other_is_tutor     boolean,
  last_message_at    timestamptz,
  has_booking        boolean,
  can_chat           boolean,
  product_count      integer,
  session_count      integer,
  blocked_at         timestamptz,
  last_booking_id    uuid,
  last_product_title text,
  kind               text,   -- L3 · 'pair' | 'group'
  group_product_id   uuid    -- L3 · la clase del hilo de grupo; null en un par
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.other_id, t.other_name, t.other_avatar_path, t.other_is_tutor,
    t.last_message_at, t.has_booking, t.can_chat, t.product_count,
    t.session_count, t.blocked_at, t.last_booking_id, t.last_product_title,
    t.kind, t.group_product_id
  from (
    select
      c.id,
      case when c.student_id = (select auth.uid()) then c.tutor_id else c.student_id end as other_id,
      -- El nombre del tutor sale de `tutor_profiles.display_name` (la copia
      -- publicable, DD-01) y el del alumno de `profiles.full_name`. Son dos
      -- caminos distintos porque son dos datos distintos: uno es público de
      -- catálogo y el otro es privado y solo lo ve quien comparte hilo.
      case when c.student_id = (select auth.uid())
           then (select tp.display_name from public.tutor_profiles tp where tp.profile_id = c.tutor_id)
           else (select p.full_name     from public.profiles       p  where p.id         = c.student_id)
      end as other_name,
      case when c.student_id = (select auth.uid())
           then (select tp.avatar_path from public.tutor_profiles tp where tp.profile_id = c.tutor_id)
           else (select p.avatar_path  from public.profiles       p  where p.id         = c.student_id)
      end as other_avatar_path,
      c.student_id = (select auth.uid()) as other_is_tutor,
      c.last_message_at,
      -- `has_booking` sale del MISMO agregado que los dos recuentos
      -- (`pair_booking_stats`): es el resultado idéntico con una llamada por fila
      -- en vez de dos, y garantiza que «tiene reserva» y «tiene 2 mentorías» no
      -- puedan contradecirse.
      st.has_booking,
      -- MN-06 · la misma función que rechaza en el servidor. Si algún día las dos
      -- respuestas se separan, la culpa será de haber escrito el criterio dos
      -- veces — por eso aquí no se escribe, se llama.
      public.pair_can_chat(c.student_id, c.tutor_id) as can_chat,
      st.product_count,
      st.session_count,
      c.blocked_at,
      ultima.id    as last_booking_id,
      ultima.title as last_product_title,
      'pair'::text as kind,
      null::uuid   as group_product_id,
      c.created_at
    from public.conversations c
    left join lateral (
      select b.id, pr.title
        from public.bookings b
        join public.products pr on pr.id = b.product_id
       where b.student_id = c.student_id
         and b.tutor_id   = c.tutor_id
       order by b.created_at desc
       limit 1
    ) ultima on true
    -- Lateral hermano del de arriba (MN-08). Siempre devuelve exactamente una
    -- fila —es un agregado sin `group by`—, así que el `left join` nunca añade
    -- nulos y `has_booking` sigue sin poder ser null.
    left join lateral public.pair_booking_stats(c.student_id, c.tutor_id) st on true
    -- El filtro de participación, a mano y explícito: es DEFINER, así que la RLS
    -- de `conversations` no está mirando. Es LA línea que no se puede tocar.
    -- L3 · B3: solo pares. Sin esto el hilo del grupo (alumno NULL) le salía al
    -- tutor como un par con «tu alumno».
    where c.kind = 'pair'
      and (select auth.uid()) in (c.student_id, c.tutor_id)

    union all

    -- L3 · B4: el hilo de cada clase grupal, con su título como nombre.
    select
      c.id,
      c.tutor_id,
      pr.title,
      (select tp.avatar_path from public.tutor_profiles tp where tp.profile_id = c.tutor_id),
      c.tutor_id <> (select auth.uid()),
      c.last_message_at,
      -- La pertenencia YA es la puerta (RG-13): ni MN-06 ni los recuentos del
      -- par significan nada con 10 alumnos.
      true,
      true,
      0,
      0,
      c.blocked_at,
      mia.id,
      pr.title,
      'group'::text,
      c.group_product_id,
      c.created_at
    from public.conversations c
    left join public.products pr on pr.id = c.group_product_id
    -- La reserva pagada del que mira, para el enlace «Ver mi reserva». El tutor
    -- no tiene: null.
    left join lateral (
      select b.id
        from public.bookings b
       where b.product_id = c.group_product_id
         and b.student_id = (select auth.uid())
         and b.status in ('confirmed', 'in_progress', 'completed')
       order by b.created_at desc
       limit 1
    ) mia on true
    -- LA línea de participación del grupo, explícita por lo mismo de arriba.
    -- L3 · P29: y solo con al menos un pago. El hilo nace con el apartado; sin
    -- un solo inscrito pagado el tutor no tiene con quién hablar.
    where c.kind = 'group'
      and public.puede_ver_conversacion(c.id)
      and exists (
        select 1 from public.bookings b
         where b.product_id = c.group_product_id
           and b.status in ('confirmed', 'in_progress', 'completed'))
  ) t
  order by t.last_message_at desc nulls last, t.created_at desc;
$$;

comment on function public.my_conversations() is
  'M-12 + MN-08 + MN-06 + L3: la bandeja. Por cada hilo del usuario, con quién habla (nombre y foto), si ya hubo compra (`has_booking`), si se puede escribir (`can_chat`, que añade el checkout en curso), cuántas mentorías (`product_count`) y cuántas clases (`session_count`) hay detrás, y de qué mentoría fue la última reserva. Con `kind` = ''group'' (L3, B3/B4) es el hilo de una clase grupal: `other_name` es el título de la clase, `other_id` el tutor, `has_booking` = `can_chat` = true, recuentos a 0 y `last_booking_id` la reserva pagada del que mira (null para el tutor); solo sale si la clase tiene al menos una reserva pagada (P29). SECURITY DEFINER acotada por participación en la conversación (par: alumno o tutor; grupo: `puede_ver_conversacion`).';

revoke execute on function public.my_conversations() from public;
revoke execute on function public.my_conversations() from anon;
grant  execute on function public.my_conversations() to authenticated;


-- ── 2 · El aviso NTF-21, ahora también para el grupo ─────────────────────────
-- L3 · B4. El bloque por destinatario de la versión viva, sacado tal cual a un
-- helper para que el par (un destinatario) y el grupo (N) no lo dupliquen.
-- Privado: recibe el destinatario por parámetro y no mira `auth.uid()`, así que
-- publicarlo dejaría encolar correos a cualquiera (la lección de
-- `pair_can_chat`). Su único llamante es el trigger, que es DEFINER.
create or replace function public.avisar_mensaje_nuevo(
  p_conversation uuid,
  p_dest         uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ultimo  timestamptz;   -- último NTF-21 de este hilo a esta persona
  v_leido   timestamptz;   -- hasta dónde tiene leído el destinatario
begin
  select max(n.created_at)
    into v_ultimo
    from public.notifications n
   where n.recipient_id = p_dest
     and n.type = 'NTF-21'
     and n.payload ->> 'conversation_id' = p_conversation::text;

  select r.last_read_at
    into v_leido
    from public.conversation_reads r
   where r.conversation_id = p_conversation
     and r.user_id = p_dest;

  -- Las tres condiciones de 20260826160000 (a, b, c). `-infinity` para el que
  -- nunca abrió el hilo: no ha leído nada, así que (c) no se cumple.
  if not (
       v_ultimo is null
       or v_ultimo < now() - interval '24 hours'
       or (coalesce(v_leido, '-infinity'::timestamptz) > v_ultimo
           and v_ultimo < now() - interval '1 hour')
     ) then
    return;
  end if;

  perform public.enqueue_notification(
    p_dest,
    'NTF-21',
    'email',
    'new_message',
    -- Solo el hilo. Ni cuerpo, ni remitente, ni `booking_id` (que además
    -- mandaría el enlace del correo a la reserva en vez de al chat).
    jsonb_build_object('conversation_id', p_conversation),
    -- hilo + destinatario + hora UTC (RN-01/02: la BD siempre en UTC).
    'NTF-21:conv:' || p_conversation || ':' || p_dest || ':' ||
      to_char(now() at time zone 'utc', 'YYYYMMDDHH24')
  );
end;
$$;

comment on function public.avisar_mensaje_nuevo(uuid, uuid) is
  'L3 · NTF-21 para UNA persona de UN hilo: las tres condiciones de agrupado de 20260826160000 y el encolado con dedupe por hora UTC. La llama solo `notify_new_message`, una vez en un par y una por miembro en un grupo. Sin grant a ningún rol de la API: recibe el destinatario por parámetro.';

revoke execute on function public.avisar_mensaje_nuevo(uuid, uuid) from public, anon, authenticated;

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_tutor   uuid;
  v_kind    text;
  v_product uuid;
  v_dest    uuid;
begin
  select c.student_id, c.tutor_id, c.kind, c.group_product_id
    into v_student, v_tutor, v_kind, v_product
    from public.conversations c
   where c.id = new.conversation_id;

  -- L3 · B4: en un hilo de grupo, todos los miembros menos el emisor. Los
  -- miembros salen de las reservas pagadas, igual que en
  -- `puede_ver_conversacion`: quien se dio de baja ya no recibe nada. El
  -- `union` quita el duplicado del alumno con dos reservas de la misma clase.
  if v_kind = 'group' then
    for v_dest in
      select v_tutor
      union
      select b.student_id
        from public.bookings b
       where b.product_id = v_product
         and b.status in ('confirmed', 'in_progress', 'completed')
    loop
      if v_dest is distinct from new.sender_id then
        perform public.avisar_mensaje_nuevo(new.conversation_id, v_dest);
      end if;
    end loop;
    return new;
  end if;

  -- Sin conversación no hay par y no hay a quién avisar. No debería pasar
  -- (`messages.conversation_id` es NOT NULL con FK), pero un `return` es más
  -- barato que un error dentro del INSERT de un mensaje.
  if v_student is null then
    return new;
  end if;

  v_dest := case
              when new.sender_id = v_student then v_tutor
              when new.sender_id = v_tutor   then v_student
            end;
  if v_dest is null then
    return new;   -- el emisor no es del par: no se adivina destinatario
  end if;

  perform public.avisar_mensaje_nuevo(new.conversation_id, v_dest);

  return new;
end;
$$;

comment on function public.notify_new_message() is
  'NTF-21 (EY-151): avisa por correo al OTRO participante de la conversación; en un hilo de grupo (L3, B4), a cada miembro con reserva pagada y al tutor, menos al emisor. Agrupa por hilo y persona — ver la migración 20260826160000 para las tres condiciones y por qué la dedupe_key va por hora. La lógica por persona vive en `avisar_mensaje_nuevo`.';

-- El trigger ya apunta a la función por nombre (`notifications_on_message`,
-- 20260826160000): `create or replace` no lo toca.


-- ── 3 · Reportar: también desde un grupo ─────────────────────────────────────
-- L3 · M7. La única línea que cambia es la pertenencia.
create or replace function public.report_conversation(
  p_conversation_id uuid,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_reason = '' then
    raise exception 'cuéntanos qué ha pasado' using errcode = 'check_violation';
  end if;

  -- L3 · M7: par o miembro del grupo. Misma respuesta para «no existe» y «no
  -- es tuya»: no se confirma la existencia de conversaciones ajenas.
  if not exists (
    select 1 from public.conversations
     where id = p_conversation_id
       and public.puede_ver_conversacion(id)
  ) then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  insert into public.conversation_reports (conversation_id, reporter_id, reason)
  values (p_conversation_id, v_uid, left(v_reason, 2000))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_conversation(uuid, text) is
  'M-12 + L3 (M7): levanta un reporte sobre una conversación de la que el usuario forma parte —par o miembro del grupo, por `puede_ver_conversacion`—. El reporte es lo que abre el hilo al admin (`admin_report_thread`).';

revoke execute on function public.report_conversation(uuid, text) from public;
revoke execute on function public.report_conversation(uuid, text) from anon;
grant  execute on function public.report_conversation(uuid, text) to authenticated;


-- ── 4 · Caducidad del hilo de grupo ──────────────────────────────────────────
-- L3 · P46. Antes contaba la última fecha AUNQUE estuviera cancelada: una clase
-- cancelada guardaba su chat hasta 30 días después de una fecha que ya no iba
-- a ocurrir. Ahora: la última fecha viva y, si se canceló todo, el día de la
-- cancelación (o la fecha, si no hay `cancelled_at`).
create or replace function public.hilo_grupal_caducado(p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    coalesce(
      (select max(g.end_at) from public.group_classes g
        where g.product_id = p_product and g.status <> 'cancelled'),
      (select max(coalesce(g.cancelled_at, g.end_at)) from public.group_classes g
        where g.product_id = p_product)
    ) < now() - interval '30 days',
    false)
$$;

comment on function public.hilo_grupal_caducado(uuid) is
  'RG-13 / S-G-07 + L3 (P46) · el hilo grupal de esta clase ya se puede borrar: su última fecha NO cancelada acabó hace más de 30 días o, si se canceló todo, el día de la cancelación quedó a más de 30 días. Sin fechas, nunca.';

revoke execute on function public.hilo_grupal_caducado(uuid) from public, anon, authenticated;


-- ── 5 · La bandeja de moderación con reportes de grupo ───────────────────────
-- L3 · M7. En un hilo de grupo `student_id` es NULL: el `case` de la versión
-- viva devolvía `reported_id` null para el alumno que reporta y el detalle del
-- admin cruzaba nulos. En un grupo no hay UN reportado: si reporta un alumno,
-- se señala al tutor (el responsable del grupo); si reporta el tutor, el
-- reportado es el grupo, con nombre pero sin id.
create or replace function public.admin_conversation_reports(
  p_pendientes boolean default true,
  p_limit      integer default 100
)
returns table (
  id                uuid,
  conversation_id   uuid,
  reason            text,
  created_at        timestamptz,
  handled_at        timestamptz,
  handled_by        uuid,
  handled_by_name   text,
  reporter_id       uuid,
  reporter_name     text,
  reported_id       uuid,
  reported_name     text,
  reporter_is_tutor boolean,
  blocked_at        timestamptz,
  blocked_reason    text,
  pair_bought       boolean,
  message_count     integer,
  last_message_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- LA barrera. `has_role` mira `auth.uid()` por dentro y devuelve false sin
  -- sesión, así que esta línea cubre también la llamada sin autenticar. Misma
  -- forma y mismo `errcode` que `set_conversation_blocked`.
  if not public.has_role('admin') then
    raise exception 'solo un administrador puede ver los reportes'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.conversation_id,
    r.reason,
    r.created_at,
    r.handled_at,
    r.handled_by,
    (select p.full_name from public.profiles p where p.id = r.handled_by),
    r.reporter_id,
    -- El nombre del que reporta sale siempre de `profiles`: puede ser el alumno
    -- o el tutor, y `profiles.full_name` es el dato que tienen los dos.
    (select p.full_name from public.profiles p where p.id = r.reporter_id),
    case
      -- L3 · M7: grupo → el tutor, salvo que reporte él (entonces, nadie).
      when c.kind = 'group'
        then case when c.tutor_id = r.reporter_id then null else c.tutor_id end
      when c.student_id = r.reporter_id then c.tutor_id
      else c.student_id
    end,
    -- ⚠️ Del tutor se prefiere `tutor_profiles.display_name` (la copia
    -- publicable, DD-01) igual que en `my_conversations`, pero con `coalesce` a
    -- `profiles.full_name`: allí el destinatario era el alumno, que solo ve el
    -- nombre de catálogo; aquí es el admin, que necesita identificar a UNA
    -- PERSONA aunque su ficha pública esté a medias. Un reporte sin nombre es
    -- un reporte que no se puede triar.
    case
      -- L3 · M7: en un grupo reportado por el tutor, el nombre es el del grupo.
      when c.kind = 'group' and c.tutor_id = r.reporter_id
        then 'Grupo «' || coalesce(
               (select pr.title from public.products pr where pr.id = c.group_product_id),
               'sin título') || '»'
      when c.kind = 'group' or c.student_id = r.reporter_id
        then coalesce(
               (select tp.display_name from public.tutor_profiles tp where tp.profile_id = c.tutor_id),
               (select p.full_name     from public.profiles       p  where p.id         = c.tutor_id)
             )
      else (select p.full_name from public.profiles p where p.id = c.student_id)
    end,
    c.tutor_id = r.reporter_id,
    c.blocked_at,
    c.blocked_reason,
    -- L3 · M7: un hilo de grupo solo existe para quien pagó la clase.
    case when c.kind = 'group' then true
         else public.pair_has_booking(c.student_id, c.tutor_id)
    end,
    (select count(*)::integer from public.messages m where m.conversation_id = c.id),
    c.last_message_at
  from public.conversation_reports r
  join public.conversations c on c.id = r.conversation_id
  -- `p_pendientes` = solo lo que pide acción. Con `false` sale la cola entera,
  -- que es como se revisa lo ya atendido sin necesitar una segunda función.
  where (not p_pendientes or r.handled_at is null)
  -- Pendientes primero y dentro de cada grupo lo más reciente arriba. Es el
  -- orden del índice parcial de M-12 (`conversation_reports_pendientes_idx`,
  -- `created_at desc where handled_at is null`), así que la vista por defecto
  -- de la bandeja lo usa tal cual.
  order by (r.handled_at is null) desc, r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

comment on function public.admin_conversation_reports(boolean, integer) is
  'EY-189 + L3 (M7): la cola de moderación. Cada reporte con su contexto — quién reporta, a quién, si el hilo está bloqueado y si el par compró. En un hilo de grupo el reportado es el tutor (si reporta un alumno) o el grupo, con nombre «Grupo «título»» y sin id (si reporta el tutor), y `pair_bought` es true. SECURITY DEFINER porque el admin NO puede leer `conversations` (decisión de M-12) y sin el otro participante un reporte no se puede triar.';

revoke execute on function public.admin_conversation_reports(boolean, integer) from public;
revoke execute on function public.admin_conversation_reports(boolean, integer) from anon;
grant  execute on function public.admin_conversation_reports(boolean, integer) to authenticated;


-- ── 6 · Quien se fue del grupo: a qué reserva mandarlo ───────────────────────
-- L3 · P12. La pantalla del chat da 404 a quien ya no es miembro, y está bien
-- que no le enseñe el hilo; lo que faltaba era decirle «ya no formas parte de
-- este grupo» con un enlace a SU reserva. Esta función solo contesta con una
-- reserva PROPIA y solo cuando el hilo es de grupo y el que pregunta ya no lo
-- ve: a un desconocido le da null igual que a un id inventado, así que no
-- confirma la existencia de hilos ajenos.
create or replace function public.reserva_tras_salir_del_grupo(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select b.id
      from public.bookings b
     where b.product_id = c.group_product_id
       and b.student_id = (select auth.uid())
     order by b.created_at desc
     limit 1
  )
  from public.conversations c
  where c.id = p_conversation_id
    and c.kind = 'group'
    and not public.puede_ver_conversacion(c.id)
$$;

comment on function public.reserva_tras_salir_del_grupo(uuid) is
  'L3 · P12: para quien abre el chat de un grupo del que ya salió (baja, reserva cancelada), el id de SU reserva más reciente de esa clase, en cualquier estado, para pintar «Ya no formas parte de este grupo» con un enlace a ella. Null si el hilo no es de grupo, si aún es miembro o si nunca reservó esa clase: solo enseña una reserva propia y no confirma hilos ajenos.';

revoke execute on function public.reserva_tras_salir_del_grupo(uuid) from public, anon;
grant  execute on function public.reserva_tras_salir_del_grupo(uuid) to authenticated;


-- ── L3 · purge_expired_messages: el grupo con las guardas del par ─────────
-- Vigente: 20261009110000:259 (cuerpo vivo en dev idéntico). Único cambio: la
-- rama de grupo, en los dos pasos, respeta (a) el bloqueo y (c) el reporte sin
-- atender. Antes del lote un grupo no se podía reportar; ahora sí (M7), y la
-- cascada de `conversation_reports` borraba el caso de la cola del admin.
-- Corre por pg_cron (`purge-expired-messages`): tras aplicar, su última corrida.
create or replace function public.purge_expired_messages()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted  int;
  v_objects  int;
  v_consultas int;
begin
  -- 1 · MENSAJES DE RESERVA: 30 días desde CADA mensaje. Sin cambios (AB-01
  --     sigue abierto). Los nulos —lo pre-compra— quedan fuera solos.
  with gone as (
    delete from public.messages
     where expires_at < now()
        -- G · RG-13 (S-G-07): los de un hilo grupal, 30 días después de su
        -- última fecha. Se calcula aquí y no en `expires_at`: una reagenda
        -- movería la fecha y dejaría la caducidad escrita mintiendo.
        or conversation_id in (select c.id from public.conversations c
                                where c.kind = 'group'
                                  and public.hilo_grupal_caducado(c.group_product_id)
                                  -- L3 · M7 ya deja reportar un grupo: bloqueado o con un
                                  -- reporte sin atender, el admin necesita leerlo.
                                  and c.blocked_at is null
                                  and not exists (select 1 from public.conversation_reports r
                                                   where r.conversation_id = c.id and r.handled_at is null))
    returning attachment_path
  ),
  -- ⚠️ ENCOLAR, NO BORRAR. Ver la cabecera: `delete from storage.objects`
  --    está prohibido y tumba la transacción entera, con lo que los MENSAJES
  --    tampoco se borraban. Aquí solo se apunta la ruta; el fichero lo retira
  --    después el job HTTP con la Storage API, que es el único camino que
  --    Supabase admite. `on conflict do nothing` porque la misma ruta puede
  --    reencolarse si un barrido anterior la dejó a medias.
  dropped as (
    insert into public.storage_purge_queue (bucket_id, path)
    select 'chat-attachments', g.attachment_path
      from gone g
     where g.attachment_path is not null
    on conflict (bucket_id, path) do nothing
    returning 1
  )
  select
    (select count(*) from gone),
    (select count(*) from dropped)
  into v_deleted, v_objects;

  -- 2 · CONSULTAS QUE NO LLEGARON A NADA: la conversación entera, de una
  --     pieza, a los 30 días sin actividad y solo si el par NUNCA compró.
  --     El `coalesce` es L1-4: sin él, un hilo abierto y nunca usado
  --     (`last_message_at is null`) era inmortal.
  with idas as (
    delete from public.conversations c
     where (
             -- G · el hilo grupal se va entero con sus mensajes
             -- L3 · con las guardas (a) y (c) del par: la cascada se llevaba el
             -- reporte de un grupo (M7 ya los admite) y el admin no lo veía nunca.
             (c.kind = 'group' and public.hilo_grupal_caducado(c.group_product_id)
              and c.blocked_at is null
              and not exists (select 1 from public.conversation_reports r
                               where r.conversation_id = c.id and r.handled_at is null))
             or (
       c.kind = 'pair'   -- G · sin esto un hilo grupal (sin alumno) caía aquí a los 30 días
       and coalesce(c.last_message_at, c.created_at) < now() - interval '30 days'
       and not public.pair_has_booking(c.student_id, c.tutor_id)
       -- (a) Un hilo bajo moderación no es un hilo abandonado. `blocked_at` y
       --     `blocked_reason` viven SOLO en esta fila —`set_conversation_blocked`
       --     hace un `update` y no copia nada a ninguna auditoría—, así que
       --     borrarla desbloquea al par en silencio: `conversations_pair_unique`
       --     era lo único que impedía duplicar el hilo, y `open_conversation`
       --     devolvería uno nuevo, sin bloqueo y con los contadores anti-spam de
       --     `send_conversation_message` (5 seguidos / 20 totales, que cuentan
       --     `messages` del hilo) a cero. Bloquear a alguien que no ha comprado
       --     tenía, por construcción, fecha de caducidad.
       and c.blocked_at is null
       -- (b) Cinturón: el `coalesce` de arriba se fía de que `last_message_at`
       --     esté al día, y no siempre lo estuvo — el sembrado de M-12 creó las
       --     filas sin rellenarla (lo repara `20260820140000`). Mientras esa
       --     reparación no haya corrido, un hilo CON mensajes reales y
       --     `last_message_at is null` heredaría un `created_at` viejo y se
       --     borraría con sus mensajes por cascada. Esta condición mira los
       --     mensajes de verdad, así que la purga es correcta ANTES y DESPUÉS
       --     del backfill y deja de depender del orden de las migraciones.
       --     Solo puede impedir borrados, nunca provocarlos.
       and not exists (
         select 1
           from public.messages m
          where m.conversation_id = c.id
            and m.created_at >= now() - interval '30 days'
       )
       -- (c) EY-189 · Un hilo con un reporte SIN ATENDER tampoco es un hilo
       --     abandonado: es el siguiente de la cola del admin. Sin esta línea la
       --     bandeja pierde casos sola y nadie se entera — la cascada borra el
       --     reporte y no queda ni el hueco. Se limita a los pendientes a
       --     propósito: cerrado el reporte, la retención de 30 días vuelve a
       --     mandar. Como (a) y (b), solo puede impedir borrados.
       and not exists (
         select 1
           from public.conversation_reports r
          where r.conversation_id = c.id
            and r.handled_at is null
       )
             )
           )
    returning 1
  )
  select count(*) into v_consultas from idas;

  return jsonb_build_object(
    'estado',              'activa',
    'retencion_dias',      30,
    'messages_purged',     v_deleted,
    'attachments_purged',  v_objects,
    -- Consultas previas a la compra que caducaron enteras (M-12). Desde L1-4
    -- también cuenta las que nunca tuvieron un mensaje.
    'consultas_purgadas',  v_consultas
  );
end;
$function$;

