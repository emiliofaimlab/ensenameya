-- ============================================================================
-- EY-218 / EY-220 / EY-224 en la rama de grupales — reaplica los cambios de
-- `20261013120000_ey218_avisos_al_tutor_dicen_para_quien` (rama dev) SOBRE los
-- cuerpos de grupales, para que el merge no deje ninguno de los dos a medias.
--
-- ⚠️ Va con un timestamp POSTERIOR a 20261013120000 (dev la trae y, por orden,
-- se aplicaría antes y pisaría a grupales: esta la vuelve a dejar bien).
--
-- Cuerpos de 20261009150000 (avisar_clases_*) y 20261009210100 (notify_booking)
-- + `para: 'alumno'|'tutor'`, NTF-14 solo si no hay reseña (EY-220) y la
-- campana que oculta solo lo caducado (EY-224). En la BD de dev ya está
-- aplicado (ey218_dev_db_combinado.sql), así que ahí bastará `migration repair
-- --status applied` de esta versión.
--
-- Y una cosa propia de grupales (Jose, 13-oct): el aviso grupal al TUTOR lleva
-- a SU clase grupal, `/tutor/clases-grupales/{product_id}`, no a la reserva de
-- uno de los alumnos. Por eso el recordatorio de 24 h (fila del tutor) y
-- NTF-51 llevan `product_id`; «empieza en 15 min» sigue yendo a la sala.
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
    select s.id as session_id, s.booking_id, s.student_id, s.tutor_id, s.group_class_id,
           b.product_id
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
    -- EY-218: `para` dice a cuál de los dos se le habla (como `reschedule_*`).
    perform public.enqueue_notification(
      v_fila.student_id, 'NTF-11', 'email', 'booking_reminder_24h',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id,
                         'para', 'alumno'),
      'NTF-11:session:' || v_fila.session_id || ':student'
    );
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-11', 'email', 'booking_reminder_24h',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id,
                         'group_class_id', v_fila.group_class_id, 'product_id', v_fila.product_id, 'para', 'tutor'),
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

comment on function public.avisar_clases_de_manana() is
  'Encola NTF-11 (booking_reminder_24h) al alumno Y al tutor de cada sesión que empieza dentro de entre 23 y 25 horas, y devuelve CUÁNTOS AVISOS encoló en esta pasada (dos por sesión). Barre SESSIONS y no BOOKINGS porque num_sessions puede ser > 1 y cada sesión de un paquete tiene su propio start_at: con una clave por reserva, el recordatorio de la primera clase bloquearía para siempre el de las demás. La horquilla de 2 h es más ancha que la cadencia del job (30 min) para que ninguna sesión se cuele entre dos pasadas; lo que impide los duplicados que eso provoca es que la clave no lleva dentro el instante de la pasada. Acepta bookings en in_progress además de confirmed porque en un paquete la reserva entra en curso con la primera clase y las siguientes siguen necesitando su recordatorio. EY-218: el payload lleva para = alumno|tutor, que es lo que decide a qué pantalla lleva el enlace.';

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
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id,
                         'para', 'alumno'),
      'NTF-08:session:' || v_fila.session_id || ':student'
    );
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-08', 'email', 'session_starting',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id,
                         'group_class_id', v_fila.group_class_id, 'para', 'tutor'),
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

comment on function public.avisar_clases_que_empiezan() is
  'Encola NTF-08 (session_starting) al alumno Y al tutor de cada sesión que empieza dentro de los próximos 15 minutos, y devuelve CUÁNTOS AVISOS encoló en esta pasada (dos por sesión). Barre sessions.start_at —not null y con índice— y NO access_opens_at, que es nullable: una sesión con ese campo vacío se caería del between sin ruido y se quedaría sin aviso para siempre. La ventana no mira hacia atrás a propósito: una clase que ya empezó no recibe el aviso. Para que este correo llegue a tiempo hace falta la otra mitad, caducar_notificaciones: encolarlo pronto no sirve de nada si el envío tarda horas. EY-218: el payload lleva para = alumno|tutor.';

revoke execute on function public.avisar_clases_de_manana() from public;
revoke execute on function public.avisar_clases_de_manana() from anon;
revoke execute on function public.avisar_clases_de_manana() from authenticated;
grant  execute on function public.avisar_clases_de_manana() to service_role;

revoke execute on function public.avisar_clases_que_empiezan() from public;
revoke execute on function public.avisar_clases_que_empiezan() from anon;
revoke execute on function public.avisar_clases_que_empiezan() from authenticated;
grant  execute on function public.avisar_clases_que_empiezan() to service_role;

CREATE OR REPLACE FUNCTION public.notify_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    -- La reserva está pagada y esperando al tutor: es AHORA cuando hay que
    -- avisarle, con las 24 h por delante y no ya gastadas.
    if new.status = 'pending_acceptance' then
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);
      -- NTF-17b: y al alumno, que hasta hoy pagaba y no recibía nada hasta que
      -- el tutor contestara. El plazo de 24 h y el reembolso del 100 % de
      -- RN-38 solo son justos si se le cuentan al empezar, no al vencer.
      perform public.enqueue_notification(new.student_id, 'NTF-17b', 'email', 'booking_pending_student',
        jsonb_build_object('booking_id', new.id), 'NTF-17b:booking:' || new.id);

    elsif new.status = 'confirmed' and new.pricing_model = 'group' then
      -- G · RG-06/07: en una grupal nadie acepta. NTF-56 al alumno en lugar de
      -- NTF-05 («el tutor aceptó tu reserva») y NTF-51 al tutor en lugar de
      -- NTF-07 («tienes 24 h para aceptar»).
      perform public.enqueue_notification(new.student_id, 'NTF-56', 'email', 'group_enrolled_student',
        jsonb_build_object('booking_id', new.id), 'NTF-56:booking:' || new.id);
      perform public.enqueue_notification(new.tutor_id, 'NTF-51', 'email', 'group_enrolled_tutor',
        jsonb_build_object('booking_id', new.id, 'product_id', new.product_id), 'NTF-51:booking:' || new.id);

    elsif new.status = 'confirmed' then
      perform public.enqueue_notification(new.student_id, 'NTF-05', 'email', 'booking_confirmed_student',
        jsonb_build_object('booking_id', new.id), 'NTF-05:booking:' || new.id);
      -- Se mantiene para el tutor con auto-aceptar, que nunca pasa por
      -- `pending_acceptance`. Si ya pasó, la clave repetida lo descarta.
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);

    elsif new.status = 'cancelled' then
      -- EY-218: misma plantilla para los dos; `para` dice a quién se le habla
      -- (al tutor no se le promete un reembolso ni se le manda a SCR-AL03).
      perform public.enqueue_notification(new.student_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id, 'para', 'alumno'),
        'NTF-09:booking:' || new.id || ':student');
      perform public.enqueue_notification(new.tutor_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id, 'para', 'tutor'),
        'NTF-09:booking:' || new.id || ':tutor');

    elsif new.status = 'completed' then
      -- NTF-14: al completar, invita a reseñar (RN-28).
      -- EY-220: si ya reseñó en el pop-up al colgar (antes del cierre), no se
      -- le vuelve a pedir. `reviews.booking_id` es unique (RN-17).
      if not exists (select 1 from public.reviews r where r.booking_id = new.id) then
        perform public.enqueue_notification(new.student_id, 'NTF-14', 'email', 'review_request',
          jsonb_build_object('booking_id', new.id), 'NTF-14:booking:' || new.id);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

comment on function public.notify_booking() is
  'EP-12/Doc 7: avisos por transición de bookings. G (grupales): confirmed + pricing_model=group encola NTF-56/NTF-51 en vez de NTF-05/NTF-07. Doc 33 añade NTF-17b al alumno en pending_acceptance — el hueco entre pagar y que el tutor acepte—, y NO lo repite en confirmed: ahí NTF-05 ya dice algo mejor y los dos juntos se contradirían. EY-218: NTF-09 lleva para = alumno|tutor en el payload. EY-220: NTF-14 (review_request) no se encola si la reserva ya tiene reseña (el pop-up al colgar llega antes que el cierre).';

CREATE OR REPLACE FUNCTION public.notify_recording()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and public.recording_allowed(new.id)
  then
    -- A los dos: la grabación es de la clase, no de uno de ellos.
    perform public.enqueue_notification(new.student_id, 'NTF-19', 'email', 'recording_ready',
      jsonb_build_object('booking_id', new.booking_id, 'session_id', new.id, 'para', 'alumno'),
      'NTF-19:session:' || new.id || ':student');
    perform public.enqueue_notification(new.tutor_id, 'NTF-19', 'email', 'recording_ready',
      jsonb_build_object('booking_id', new.booking_id, 'session_id', new.id, 'para', 'tutor'),
      'NTF-19:session:' || new.id || ':tutor');
  end if;
  return new;
end;
$function$;

comment on function public.notify_recording() is
  'US-1802 / NTF-19: al completarse una sesión grabable encola recording_ready al alumno y al tutor. EY-218: el payload lleva para = alumno|tutor, que decide si el enlace va a /reservas/{id} o a /tutor/reservas/{id}.';

create or replace function public.session_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'roles', coalesce(
      (select jsonb_agg(ur.role) from public.user_roles ur
        where ur.user_id = (select auth.uid())),
      '[]'::jsonb),
    'profile', (
      select to_jsonb(p) from (
        select onboarding_complete, full_name, avatar_path, timezone
          from public.profiles where id = (select auth.uid())
      ) p),
    'notices', coalesce(
      (select jsonb_agg(n order by n.created_at desc) from (
        select id, type, template, payload, created_at, read_at
          from public.notifications
          where recipient_id = (select auth.uid())
            -- EY-224: lo CADUCADO por `caducar_notificaciones()` no se enseña
            -- en ninguna de las tres puertas de la campana. Solo eso: un
            -- `failed` porque el proveedor rechazó el correo sigue saliendo,
            -- que el in-app es justo el canal que no falló. Misma lista de
            -- plantillas que esa función (`PLANTILLAS_CADUCABLES` en TS).
            and not (status = 'failed'::public.notification_status
                     and template in ('session_starting', 'booking_reminder_24h'))
          order by created_at desc
          limit 8
      ) n),
      '[]'::jsonb)
  );
$$;

comment on function public.session_bootstrap() is
  'Roles + perfil + avisos del usuario en sesión, en una sola llamada. '
  'security invoker: la RLS de las tres tablas sigue mandando. '
  'EY-224: los avisos excluyen lo caducado por caducar_notificaciones() (failed en session_starting / booking_reminder_24h), igual que listNotices() y la campana; un failed por rechazo del correo sí se enseña.';

grant execute on function public.session_bootstrap() to authenticated;
