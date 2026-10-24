-- ============================================================================
-- Enséñame Ya — la sala de una clase grupal (Fase C §10.2, RG-12)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Una sala por FECHA de clase, compartida: entran el tutor (anfitrión) y los
-- inscritos con pago confirmado. `join_group_class` es la gemela de
-- `join_session` para eso; el Route Handler que firma el token y la pantalla
-- de 11 personas van en G3.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `join_session` REEMPLAZA a su versión VIVA de dev (`pg_get_functiondef`,
--   9-oct; última migración `20260828120000:69`) con UN cambio «G ·»: rechaza
--   las sesiones grupales. Sin él, el alumno que entrara por la ruta 1:1
--   (`/api/room/[sessionId]`) abriría una sala privada `ey-<su sesión>`, vacía
--   y grabándose aparte.
-- · Mismas reglas que la 1:1, copiadas a propósito: reserva confirmed /
--   in_progress / completed, sesión no cerrada, ventana de
--   `session_access_window` y el ciclo M5 SOLO dentro de
--   `session_live_window` (abrir la sala antes no es empezar la clase, y de
--   eso cuelga el reembolso de RN-37).
-- · El tutor no tiene sesión propia en una grupal: lo que se le exige es que
--   la fecha esté 'scheduled'. Las sesiones que pasan a in_progress son las de
--   los alumnos que entran; las de quien no entre acaban no_show
--   (close_expired_sessions), y su reserva se completa igual (DP-08).
-- · Sala: 'eyg-' || id sin guiones, ESCRITA en group_classes.daily_room_name
--   y leída de ahí (lección de US-1802 con sessions.daily_room_name).
--   Devuelve `max_participants` = cupo + 1 para `ensureRoom` (G3).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.join_session(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_sess    record;
  v_booking public.booking_status;
  v_room    text;
  v_win     tstzrange;
  v_opens   timestamptz;
  v_closes  timestamptz;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select s.id, s.booking_id, s.student_id, s.tutor_id, s.status,
         s.start_at, s.end_at, s.daily_room_name, s.daily_room_url,
         s.access_opens_at, s.access_closes_at, s.group_class_id
    into v_sess
  from public.sessions s
  where s.id = p_session_id
    and (s.student_id = v_uid or s.tutor_id = v_uid);   -- RLS de participante, reforzada
  if v_sess.id is null then
    raise exception 'sesión no encontrada' using errcode = 'no_data_found';
  end if;

  -- G · RG-12: una sesión grupal NO tiene sala propia. Sin esto, el alumno que
  -- entrara por aquí abriría `ey-<su sesión>`: una sala 1:1 vacía, lejos de su
  -- clase y grabando aparte.
  if v_sess.group_class_id is not null then
    raise exception 'es una clase grupal: se entra con join_group_class' using errcode = 'check_violation';
  end if;

  select status into v_booking from public.bookings where id = v_sess.booking_id;

  -- `completed` sigue en la lista (CAMBIO B de MN-05, intacto): una reserva
  -- completada es una clase que YA OCURRIÓ y se pagó. Las que siguen fuera son
  -- las que no deben tener sala nunca: `cancelled` y `refunded` porque el
  -- dinero volvió, y `pending_payment` / `pending_acceptance` porque todavía no
  -- hay clase que abrir.
  --
  -- Ojo a la asimetría con el bloque de abajo, que es a propósito: la RESERVA
  -- completada no cierra la sala (puede tener varias sesiones y solo se cierra
  -- cuando no le queda ninguna abierta), pero la SESIÓN completada sí.
  if v_booking not in ('confirmed', 'in_progress', 'completed') then
    raise exception 'la reserva no está activa (%).', v_booking using errcode = 'check_violation';
  end if;

  -- ⚠️ AQUÍ ESTÁ EL CAMBIO DE ESTA MIGRACIÓN. Ver la cabecera antes de tocarlo:
  -- MN-05 dejó esta guarda en solo `cancelled` porque la sala vivía 7 días;
  -- con la ventana de B-2 (10 min) el único caso que quedaba vivo era el cierre
  -- anticipado del tutor, que es el que el cliente pide bloquear.
  --
  -- Si algún día vuelve la sala larga, esto hay que volver a pensarlo: con una
  -- ventana de días, una sesión cerrada por el cron seguiría teniendo sala y
  -- esta línea le cerraría la puerta durante toda esa semana.
  if v_sess.status in ('cancelled', 'completed', 'no_show') then
    raise exception 'esta sesión ya está cerrada' using errcode = 'check_violation';
  end if;

  -- La ventana se LEE. El `coalesce` es el respaldo para una fila que llegara
  -- sin ventana: columna a columna, nunca un `tstzrange` armado con nulos (un
  -- rango de nulos es infinito y `@> now()` da true, o sea acceso eterno).
  v_win    := public.session_access_window(v_sess.start_at, v_sess.end_at);
  v_opens  := coalesce(v_sess.access_opens_at,  lower(v_win));
  v_closes := coalesce(v_sess.access_closes_at, upper(v_win));

  if now() < v_opens or now() > v_closes then
    raise exception 'fuera de la ventana de acceso' using errcode = 'check_violation';
  end if;

  -- Nombre de sala determinista: el endpoint lo usa para crear/reusar la room
  -- en Daily sin que la BD tenga que conocer el dominio ni guardar la URL.
  v_room := 'ey-' || replace(v_sess.id::text, '-', '');
  if v_sess.daily_room_name is distinct from v_room then
    update public.sessions set daily_room_name = v_room where id = v_sess.id;
  end if;

  -- ── El ciclo M5 (US-802) se mueve SOLO si esto es la clase ────────────────
  --
  -- Sigue siendo `session_live_window` y no la ventana de acceso, aunque con
  -- B-2 den lo mismo: son dos preguntas distintas y de ésta cuelga el dinero.
  -- Abrir la sala para probar la cámara no es empezar la mentoría, y si lo
  -- fuera, la reserva saltaría a `in_progress` antes de tiempo y
  -- `cancel_booking` dejaría de aceptarla — el alumno perdería sin enterarse el
  -- reembolso del 100 % que le da RN-37 por avisar con 24 h.
  --
  -- ⚠️ Con la guarda de estado de arriba, el `if v_sess.status = 'scheduled'`
  -- es ahora redundante (una sesión cerrada ya no llega hasta aquí). Se queda
  -- escrito igual: es la condición que describe la transición M5, y borrarla
  -- para ahorrar una comparación dejaría el ciclo dependiendo de una guarda
  -- que vive treinta líneas más arriba.
  if public.session_live_window(v_sess.start_at, v_sess.end_at) @> now() then
    if v_sess.status = 'scheduled' then
      update public.sessions set status = 'in_progress' where id = v_sess.id;
    end if;
    if v_booking = 'confirmed' then
      update public.bookings set status = 'in_progress' where id = v_sess.booking_id;
    end if;
  end if;

  -- Sin token aquí: lo firma el server con la API key (Doc 1 §1.4.11: el token
  -- se genera al unirse y NO se almacena).
  --
  -- Tres relojes salen por esta puerta y cada uno tiene un consumidor distinto,
  -- así que no se pueden fusionar por parecerse:
  --   · `ends_at`   → `exp` del meeting-token (corto; MN-05a);
  --   · `closes_at` → `exp` de la SALA en Daily;
  --   · `starts_at` → duración de la clase, de donde sale el tope de minutos
  --                   que un participante puede estar conectado.
  return jsonb_build_object(
    'room_name',  v_room,
    'is_tutor',   v_sess.tutor_id = v_uid,
    'starts_at',  v_sess.start_at,
    'ends_at',    v_sess.end_at,
    'closes_at',  v_closes
  );
end;
$function$;


create or replace function public.join_group_class(p_group_class uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_gc      record;
  v_sess    record;
  v_booking public.booking_status;
  v_es_tutor boolean;
  v_room    text;
  v_win     tstzrange;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select g.id, g.tutor_id, g.status, g.start_at, g.end_at, g.daily_room_name, p.capacity
    into v_gc
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.id = p_group_class;
  if v_gc.id is null then
    raise exception 'clase no encontrada' using errcode = 'no_data_found';
  end if;

  v_es_tutor := (v_gc.tutor_id = v_uid);

  if not v_es_tutor then
    -- El alumno entra con SU sesión de esa fecha.
    select s.id, s.booking_id, s.status into v_sess
      from public.sessions s
     where s.group_class_id = v_gc.id and s.student_id = v_uid;
    if v_sess.id is null then
      raise exception 'clase no encontrada' using errcode = 'no_data_found';
    end if;
    select status into v_booking from public.bookings where id = v_sess.booking_id;
    if v_booking not in ('confirmed', 'in_progress', 'completed') then
      raise exception 'la reserva no está activa (%).', v_booking using errcode = 'check_violation';
    end if;
    if v_sess.status in ('cancelled', 'completed', 'no_show') then
      raise exception 'esta sesión ya está cerrada' using errcode = 'check_violation';
    end if;
  end if;

  if v_gc.status <> 'scheduled' then
    raise exception 'esta clase ya está cerrada' using errcode = 'check_violation';
  end if;

  v_win := public.session_access_window(v_gc.start_at, v_gc.end_at);
  if not (v_win @> now()) then
    raise exception 'fuera de la ventana de acceso' using errcode = 'check_violation';
  end if;

  v_room := 'eyg-' || replace(v_gc.id::text, '-', '');
  if v_gc.daily_room_name is distinct from v_room then
    update public.group_classes set daily_room_name = v_room where id = v_gc.id;
  end if;

  -- Ciclo M5, solo si esto ES la clase (misma razón que join_session).
  if not v_es_tutor and public.session_live_window(v_gc.start_at, v_gc.end_at) @> now() then
    if v_sess.status = 'scheduled' then
      update public.sessions set status = 'in_progress' where id = v_sess.id;
    end if;
    if v_booking = 'confirmed' then
      update public.bookings set status = 'in_progress' where id = v_sess.booking_id;
    end if;
  end if;

  return jsonb_build_object(
    'room_name',        v_room,
    'is_tutor',         v_es_tutor,
    'starts_at',        v_gc.start_at,
    'ends_at',          v_gc.end_at,
    'closes_at',        upper(v_win),
    'max_participants', v_gc.capacity + 1
  );
end;
$$;

comment on function public.join_group_class(uuid) is
  'RG-12 · autoriza la entrada a la sala compartida de una fecha grupal: el tutor (anfitrión, is_tutor) o un alumno con su sesión de esa fecha y reserva pagada. Ventana session_access_window; ciclo M5 del alumno solo dentro de session_live_window. Escribe y devuelve la sala ''eyg-<id>''. Sin token: lo firma el Route Handler (G3).';

revoke execute on function public.join_group_class(uuid) from public, anon;
grant  execute on function public.join_group_class(uuid) to authenticated;
