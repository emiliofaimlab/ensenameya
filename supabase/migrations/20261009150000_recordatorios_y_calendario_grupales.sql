-- ============================================================================
-- Enséñame Ya — recordatorios y calendario de las clases grupales (Fase C)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2. Todo esto trabajaba SESIÓN A
-- SESIÓN, y en una grupal el tutor tiene una sesión por alumno en la misma
-- hora. Tres cosas salían mal para el TUTOR (al alumno no le cambia nada):
--   · Recordatorios NTF-11 (24 h) y NTF-08 (empieza ya): N correos de la
--     misma clase. Ahora uno por fecha: clave 'NTF-xx:group_class:<id>:tutor'.
--   · Google Calendar: N eventos, y —peor— el estado de cada uno salía de la
--     reserva de ESE alumno, así que una baja le cancelaba la clase en su
--     calendario. Ahora un evento por fecha, con el id de la fecha y su estado.
--     Y existe aunque no haya inscritos: publicar ya le ocupa la hora.
--   · Feed ICS: lo mismo que Google, una entrada por fecha.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · REEMPLAZAN a su versión VIVA de dev (`pg_get_functiondef`, 9-oct),
--   cambios marcados «G ·»: avisar_clases_de_manana y
--   avisar_clases_que_empiezan (`20260911210000`), google_calendar_eventos y
--   avisar_google_calendar (`20260925180000`), calendar_feed
--   (`20260826210000`). Firmas y tipos de vuelta intactos.
-- · `reagendar_clase_grupal` (`20261008200000`) aparta también la clave
--   NTF-08 nueva del tutor.
-- · `google_calendar_eventos` devuelve `booking_id` NULL en el evento del
--   tutor de una grupal (no es de una reserva): `lib/google-calendar.ts` ya lo
--   sabe. El enlace a la sala de ese evento es `/room/<id de la fecha>`, que
--   la ruta de la sala aprende en G3.
-- · Trigger nuevo en `group_classes` → mismo `avisar_google_calendar`
--   (pg_net, no reintenta, igual que los de sessions/bookings).
-- · ⚠️ Regla 11: los dos avisos corren por pg_cron (`avisar-clases-de-manana`,
--   `avisar-clases-que-empiezan`). Mirar su corrida tras aplicar.
-- · El TEXTO de los correos al tutor de una grupal («tu clase con X») se
--   rehace en G4 con sus plantillas; el payload ya lleva `group_class_id`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.avisar_clases_de_manana()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  for v_fila in
    select s.id as session_id, s.booking_id, s.student_id, s.tutor_id, s.group_class_id
      from public.sessions s
      join public.bookings b on b.id = s.booking_id
     where s.start_at between now() + interval '23 hours' and now() + interval '25 hours'
       and s.status = 'scheduled'::public.session_status
       -- `in_progress` está aquí por los paquetes: la reserva entra en curso al
       -- empezar la PRIMERA clase, y las siguientes siguen mereciendo su
       -- recordatorio. Filtrar solo por `confirmed` dejaría sin aviso a todas
       -- las clases de un paquete menos la primera.
       and b.status in ('confirmed'::public.booking_status,
                        'in_progress'::public.booking_status)
       -- Se mira la clave del alumno y vale por las dos: se encolan juntas en la
       -- misma transacción, así que una existe si y solo si existe la otra.
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-11:session:' || s.id || ':student'
       )
  loop
    -- A los dos, con el patrón de `notify_recording` (20260729230000:26-31): la
    -- clase es de los dos, y el tutor también organiza su día con esto.
    perform public.enqueue_notification(
      v_fila.student_id, 'NTF-11', 'email', 'booking_reminder_24h',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id),
      'NTF-11:session:' || v_fila.session_id || ':student'
    );
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-11', 'email', 'booking_reminder_24h',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id,
                         'group_class_id', v_fila.group_class_id),
      -- G · en una grupal, UNO por fecha al tutor, no uno por alumno: la clave
      -- es de la group_class y `enqueue_notification` ignora las repetidas.
      case when v_fila.group_class_id is null
           then 'NTF-11:session:' || v_fila.session_id || ':tutor'
           else 'NTF-11:group_class:' || v_fila.group_class_id || ':tutor' end
    );
    v_avisos := v_avisos + 2;
  end loop;

  return v_avisos;
end $function$;

CREATE OR REPLACE FUNCTION public.avisar_clases_que_empiezan()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  for v_fila in
    select s.id as session_id, s.booking_id, s.student_id, s.tutor_id, s.group_class_id
      from public.sessions s
      join public.bookings b on b.id = s.booking_id
     where s.start_at between now() and now() + interval '15 minutes'
       and s.status = 'scheduled'::public.session_status
       and b.status in ('confirmed'::public.booking_status,
                        'in_progress'::public.booking_status)
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-08:session:' || s.id || ':student'
       )
  loop
    perform public.enqueue_notification(
      v_fila.student_id, 'NTF-08', 'email', 'session_starting',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id),
      'NTF-08:session:' || v_fila.session_id || ':student'
    );
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-08', 'email', 'session_starting',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id,
                         'group_class_id', v_fila.group_class_id),
      -- G · en una grupal, UNO por fecha al tutor, no uno por alumno: la clave
      -- es de la group_class y `enqueue_notification` ignora las repetidas.
      case when v_fila.group_class_id is null
           then 'NTF-08:session:' || v_fila.session_id || ':tutor'
           else 'NTF-08:group_class:' || v_fila.group_class_id || ':tutor' end
    );
    v_avisos := v_avisos + 2;
  end loop;

  return v_avisos;
end $function$;

CREATE OR REPLACE FUNCTION public.google_calendar_eventos(p_sesiones uuid[], p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(session_id uuid, booking_id uuid, user_id uuid, soy_tutor boolean, refresh_token text, start_at timestamp with time zone, end_at timestamp with time zone, estado text, titulo text, con text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 1:1, y el ALUMNO de una grupal: una fila por sesión, como siempre.
  (select s.id,
         s.booking_id,
         g.user_id,
         g.user_id = s.tutor_id,
         g.refresh_token,
         s.start_at,
         s.end_at,
         case
           when s.status = 'cancelled'
             or b.status in ('cancelled', 'refunded', 'pending_payment') then 'cancelada'
           when b.status = 'pending_acceptance'                           then 'tentativa'
           else 'confirmada'
         end,
         pr.title,
         public.mask_person_name(
           case when g.user_id = s.tutor_id then stu.full_name else tut.full_name end
         )
    from public.sessions s
    join public.bookings b  on b.id  = s.booking_id
    join public.products pr on pr.id = b.product_id
    join public.google_calendar_connections g
      on g.user_id in (s.student_id, s.tutor_id)
    left join public.profiles tut on tut.id = s.tutor_id
    left join public.profiles stu on stu.id = s.student_id
   where (p_user is null or g.user_id = p_user)
     -- G · el tutor de una grupal va abajo, una vez por fecha
     and (s.group_class_id is null or g.user_id = s.student_id)
     and (
       s.id = any(p_sesiones)
       or (p_sesiones is null and p_user is not null and s.start_at > now())
     )
   limit 500)

  union all

  -- G · el TUTOR de una grupal: UN evento por fecha, con el id de la fecha.
  -- Su estado es el de la FECHA: la baja de un alumno no le cancela la clase.
  -- Existe aunque no haya inscritos: publicarla ya le ocupa la hora (RG-05).
  -- Llega por el id de la fecha (trigger de group_classes) o por el de la
  -- sesión de cualquier inscrito (triggers de sessions/bookings).
  (select gc.id,
         null::uuid,
         g.user_id,
         true,
         g.refresh_token,
         gc.start_at,
         gc.end_at,
         case when gc.status = 'cancelled' then 'cancelada' else 'confirmada' end,
         pr.title,
         null::text
    from public.group_classes gc
    join public.products pr on pr.id = gc.product_id
    join public.google_calendar_connections g on g.user_id = gc.tutor_id
   where (p_user is null or g.user_id = p_user)
     and (
       gc.id = any(p_sesiones)
       or exists (select 1 from public.sessions s
                   where s.group_class_id = gc.id and s.id = any(p_sesiones))
       or (p_sesiones is null and p_user is not null and gc.start_at > now())
     )
   limit 500)
$function$;

CREATE OR REPLACE FUNCTION public.avisar_google_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids    uuid[];
  v_url    text;
  v_secret text;
  v_bypass text;
  v_cab    jsonb;
begin
  if tg_table_name = 'group_classes' then
    -- G · la fecha grupal viaja con su propio id (ver google_calendar_eventos).
    if not exists (select 1 from public.google_calendar_connections g
                    where g.user_id = new.tutor_id) then
      return null;
    end if;
    v_ids := array[new.id];
  elsif tg_table_name = 'sessions' then
    v_ids := array[new.id];
  else
    select array_agg(s.id) into v_ids
      from public.sessions s where s.booking_id = new.id;
  end if;

  -- Sin nadie conectado no se llama a nadie: es el caso de casi todas las filas.
  if tg_table_name <> 'group_classes' then
  select array_agg(s.id) into v_ids
    from public.sessions s
   where s.id = any(v_ids)
     and exists (select 1 from public.google_calendar_connections g
                  where g.user_id in (s.student_id, s.tutor_id));
  end if;
  if v_ids is null then
    return null;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'ey_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ey_cron_secret';
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name = 'ey_vercel_bypass';
  if v_url is null or v_secret is null then
    raise warning 'avisar_google_calendar: falta ey_site_url o ey_cron_secret en el vault';
    return null;
  end if;

  v_cab := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                              'Content-Type',  'application/json');
  if v_bypass is not null then
    v_cab := v_cab || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  perform net.http_post(
    url     := v_url || '/api/calendario/google/sync',
    body    := jsonb_build_object('sesiones', v_ids),
    headers := v_cab,
    timeout_milliseconds := 30000
  );
  return null;
exception when others then
  -- ⚠️ Un calendario de terceros JAMÁS tumba una reserva, un pago o un
  -- reagendado: el fallo se queda en el log de Postgres y la sesión sigue.
  raise warning 'avisar_google_calendar: %', sqlerrm;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.calendar_feed(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user    uuid;
  v_tz      text;
  v_eventos jsonb;
begin
  -- Corte barato antes de tocar la tabla: el token real son 64 hex.
  if p_token is null or length(p_token) <> 64 then
    return null;
  end if;

  -- Se marca la lectura en el mismo golpe que se resuelve el dueño. Un token
  -- que no existe no coincide con ninguna fila, así que los intentos a ciegas
  -- no escriben nada.
  update public.calendar_feed_tokens
     set last_seen_at = now()
   where token = p_token
  returning user_id into v_user;

  if v_user is null then
    return null;
  end if;

  select coalesce(p.timezone, 'UTC') into v_tz
    from public.profiles p
   where p.id = v_user;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'session_id',   x.session_id,
               'start_at',     x.start_at,
               'end_at',       x.end_at,
               'created_at',   x.created_at,
               'updated_at',   x.updated_at,
               'estado',       x.estado,
               'secuencia',    x.secuencia,
               'titulo',       x.titulo,
               'con',          x.con,
               'session_ref',  x.session_ref,
               'sequence_no',  x.sequence_no,
               'num_sessions', x.num_sessions
             )
             order by x.start_at
           ),
           '[]'::jsonb)
    into v_eventos
    from (
      select s.id          as session_id,
             s.start_at,
             s.end_at,
             s.created_at,
             s.updated_at,
             s.session_ref,
             s.sequence_no,
             b.num_sessions,
             pr.title      as titulo,
             -- ⚠️ Nombre ENMASCARADO, no el completo: esto viaja a un tercero.
             -- Misma regla que firma las reseñas (`20260729150000:26-42`).
             public.mask_person_name(
               case when s.student_id = v_user then tut.full_name
                    else stu.full_name end
             )             as con,
             case
               when s.status = 'cancelled'
                 or b.status in ('cancelled', 'refunded') then 'cancelada'
               when b.status = 'pending_acceptance'       then 'tentativa'
               else 'confirmada'
             end           as estado,
             -- SEQUENCE del .ics: segundos entre el alta y el último cambio de
             -- la fila. No es «número de revisión» pero cumple lo único que el
             -- formato exige —que no decrezca— y sale de una columna que ya
             -- mantiene el trigger `sessions_set_updated_at`
             -- (`20260709140000:90`). Alternativa descartada: el epoch a secas,
             -- que se sale de un entero de 32 bits en 2038.
             least(
               greatest(
                 0,
                 floor(extract(epoch from (s.updated_at - s.created_at)))
               )::bigint,
               2147483647
             )::integer    as secuencia
        from public.sessions s
        join public.bookings b   on b.id  = s.booking_id
        join public.products pr  on pr.id = b.product_id
        left join public.profiles tut on tut.id = s.tutor_id
        left join public.profiles stu on stu.id = s.student_id
       where (s.student_id = v_user or s.tutor_id = v_user)
         -- G · el tutor de una grupal ve la FECHA (abajo), no a cada alumno
         and not (s.tutor_id = v_user and s.group_class_id is not null)
         and s.start_at >= now() - interval '90 days'
         and b.status <> 'pending_payment'
         and (
              (s.status <> 'cancelled' and b.status not in ('cancelled', 'refunded'))
              or exists (
                   select 1
                     from public.payments pay
                    where pay.booking_id = b.id
                      and pay.status in ('authorized', 'paid',
                                         'partially_refunded', 'refunded')
                 )
             )
      union all
      -- G · una entrada por fecha grupal del tutor, con el id de la fecha.
      select gc.id, gc.start_at, gc.end_at, gc.created_at, gc.updated_at,
             null::text, gc.sequence_no::int, coalesce(pr.package_num_sessions, 1),
             pr.title, null::text,
             case when gc.status = 'cancelled' then 'cancelada' else 'confirmada' end,
             least(greatest(0, floor(extract(epoch from (gc.updated_at - gc.created_at))))::bigint,
                   2147483647)::integer
        from public.group_classes gc
        join public.products pr on pr.id = gc.product_id
       where gc.tutor_id = v_user
         and gc.start_at >= now() - interval '90 days'
       order by 2
       -- Techo de seguridad, no de producto. Un tutor a 5 clases diarias suma
       -- ~450 solo en los 90 días de atrás, así que 500 se quedaba corto de
       -- verdad. Con 1000 el .ics ronda los 250 KB, que es un tamaño razonable
       -- para algo que se descarga entero cada pocas horas.
       limit 1000
    ) x;

  return jsonb_build_object('ok', true, 'timezone', v_tz, 'eventos', v_eventos);
end;
$function$;

-- ── reagendar_clase_grupal: aparta también NTF-08 del tutor ────────────────
create or replace function public.reagendar_clase_grupal(
  p_group_class  uuid,
  p_nuevo_inicio timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gc record;
begin
  select g.id, g.tutor_id, g.product_id, g.status, g.start_at, g.end_at into v_gc
    from public.group_classes g where g.id = p_group_class for update;

  if v_gc.id is null or v_gc.tutor_id is distinct from (select auth.uid()) then
    raise exception 'no puedes reagendar esta clase' using errcode = '42501';
  end if;
  if v_gc.status <> 'scheduled' then
    raise exception 'esa fecha ya no se puede reagendar' using errcode = 'check_violation';
  end if;
  -- La misma regla que la 1:1 (§14): 24 h respecto de la hora PROGRAMADA.
  if v_gc.start_at < now() + interval '24 hours' then
    raise exception 'Solo se puede reagendar con al menos 24 horas de anticipación.'
      using errcode = 'check_violation';
  end if;
  if p_nuevo_inicio <= now() then
    raise exception 'la hora nueva tiene que ser futura' using errcode = 'check_violation';
  end if;
  if p_nuevo_inicio = v_gc.start_at then
    raise exception 'Esa ya es la hora de la clase.' using errcode = 'check_violation';
  end if;

  -- Serializa contra inscripciones (create_booking_line bloquea lo mismo):
  -- quien esté pagando ve «las fechas cambiaron», no una hora vieja.
  perform 1 from public.products where id = v_gc.product_id for update;

  begin
    update public.group_classes
       set start_at = p_nuevo_inicio,
           end_at   = p_nuevo_inicio + (v_gc.end_at - v_gc.start_at),
           rescheduled_at = now()
     where id = v_gc.id;
  exception when exclusion_violation then
    raise exception 'esa hora choca con tu agenda' using errcode = 'exclusion_violation';
  end;

  -- Los recordatorios ya encolados para la hora vieja se apartan (misma
  -- maniobra que responder_reagenda): la clave queda libre para el barrido
  -- que los vuelva a encolar con la hora nueva.
  update public.notifications
     set idempotency_key = idempotency_key || ':movida:' || extract(epoch from now())::bigint,
         status = case when status = 'pending' then 'failed'::public.notification_status
                       else status end
   where idempotency_key in (
           select k
             from public.sessions s
            cross join lateral (values
              ('NTF-11:session:' || s.id || ':student'), ('NTF-11:session:' || s.id || ':tutor'),
              ('NTF-08:session:' || s.id || ':student'), ('NTF-08:session:' || s.id || ':tutor')
            ) as v(k)
            where s.group_class_id = v_gc.id
           union all
           select 'NTF-11:group_class:' || v_gc.id || ':tutor'
           union all
           select 'NTF-08:group_class:' || v_gc.id || ':tutor'   -- G · 20261009150000
         );

  update public.sessions
     set start_at = p_nuevo_inicio,
         end_at   = p_nuevo_inicio + (v_gc.end_at - v_gc.start_at)
   where group_class_id = v_gc.id and status = 'scheduled';
end;
$$;


drop trigger if exists group_classes_google_calendar on public.group_classes;
create trigger group_classes_google_calendar
  after insert or update of start_at, end_at, status on public.group_classes
  for each row execute function public.avisar_google_calendar();
