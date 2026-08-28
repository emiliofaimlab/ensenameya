-- ============================================================================
-- «Marcar completada» CIERRA LA SALA PARA LOS DOS
--
-- Petición del cliente: hoy el tutor pulsa «Marcar completada», la sesión pasa
-- a `completed`… y el alumno se queda dentro de la videollamada. Pide dos
-- cosas, y la segunda es la que obliga a bajar a la base:
--   1. que al alumno se le saque de la sala y aterrice en su reserva;
--   2. que **se le bloquee el acceso** — no solo que se le eche.
--
-- Lo primero es de pantalla. Lo segundo es esta migración.
--
-- ── 1) `join_session` vuelve a mirar el estado de la sesión ─────────────────
--
-- ⚠️ ESTO DESHACE EL «CAMBIO A» DE MN-05 (`20260820190000`), y va explicado
-- porque leído en frío parece una regresión.
--
-- MN-05 quitó el estado de la puerta a propósito: con la sala abierta 7 días,
-- una sesión cerrada por el cron a los 10 min seguía teniendo sala durante una
-- semana, y rechazarla por `completed` habría dejado la mitad de aquella
-- historia sin efecto. El razonamiento era correcto **para una ventana larga**.
--
-- B-2 (`20260826130000`) devolvió la ventana a 10 min y su cabecera ya lo dejó
-- escrito: «con la ventana en 10 min, una sesión cerrada ya cae fuera del rango
-- y el estado no tiene que volver a ser puerta». Cierto para el cierre del
-- CRON, que ocurre justo cuando la ventana expira. Falso para el cierre
-- ANTICIPADO del tutor (`complete_session`, US-802/S-26): ahí la sesión queda
-- `completed` con la ventana todavía abierta, y hoy el alumno puede volver a
-- entrar tantas veces como quiera a una clase que ya se dio por terminada. Es
-- exactamente el caso que el cliente pide bloquear.
--
-- O sea que no se recupera la guarda «por si acaso»: se recupera porque el
-- único escenario que MN-05 protegía —sala viva con sesión cerrada— ya no
-- existe salvo en el cierre anticipado, que es justo el que hay que cortar.
--
-- `cancelled` sigue fuera por lo de siempre (esa clase no va a existir y su
-- dinero volvió). `no_show` entra con `completed`: el cron solo lo pone al
-- expirar la ventana, así que en la práctica nunca llega aquí dentro de rango,
-- pero dejarlo fuera de la lista sería decir que una sesión a la que nadie vino
-- sí tiene sala.
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
-- `session_access_window()`, `session_live_window()` y `close_expired_sessions()`
-- no aparecen aquí. Los dos relojes siguen siendo dos (ver B-2) y
-- `bookings.completed_at` —el plazo de pago al tutor, §12 del contrato— no se
-- mueve ni un segundo con esta ficha. El resto del cuerpo de `join_session` es
-- copia literal de MN-05: solo cambia el bloque del `if` de estado.
--
-- ── 2) `sessions` entra en la publicación de Realtime ───────────────────────
--
-- Para SACAR al alumno hace falta que su navegador se entere de que la sesión
-- se cerró, y el alumno no está pulsando nada: está dentro del iframe de Daily.
-- La sala se suscribe a los UPDATE de SU fila de `sessions` (`live-room.tsx`) y
-- al ver `completed`/`no_show`/`cancelled` cuelga la llamada y navega al
-- detalle de la reserva.
--
-- Se usa Realtime y no un mensaje de Daily por una razón concreta: el tutor
-- puede cerrar la sesión **desde fuera de la sala**, en
-- `/tutor/reservas/<id>` (`CompleteSessionButton`). Ahí no hay llamada desde la
-- que mandarle nada al alumno; la fila de la base sí cambia en los dos caminos.
--
-- No hace falta política nueva: `postgres_changes` respeta la RLS del que
-- escucha, y `sessions_select_participant` (EP-06) ya limita cada fila a su
-- alumno y su tutor. `grant select ... to authenticated` también está desde
-- entonces. Y no se pide `replica identity full`: solo se lee el registro NUEVO.
-- ============================================================================


-- ── 1) La puerta ────────────────────────────────────────────────────────────
create or replace function public.join_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
         s.access_opens_at, s.access_closes_at
    into v_sess
  from public.sessions s
  where s.id = p_session_id
    and (s.student_id = v_uid or s.tutor_id = v_uid);   -- RLS de participante, reforzada
  if v_sess.id is null then
    raise exception 'sesión no encontrada' using errcode = 'no_data_found';
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
$$;

comment on function public.join_session(uuid) is
  'Autoriza la entrada a la sala: participante, reserva activa, sesión no cerrada y ventana de acceso (session_access_window). Desde 2026-08-28 vuelve a rechazar las sesiones completed/no_show además de las cancelled: con la ventana de B-2 (10 min) el único caso que quedaba abierto era el cierre anticipado del tutor, y el cliente pidió que «Marcar completada» bloquee el acceso, no solo saque a la gente. Mueve el ciclo M5 solo dentro de session_live_window(), que es de donde cuelga bookings.completed_at y con él el payout.';


-- ── 2) Realtime sobre `sessions` ────────────────────────────────────────────
--
-- Idempotente en los dos sentidos: si la publicación no existiera (proyecto sin
-- Realtime) no se rompe la migración, y si la tabla ya estuviera dentro no se
-- vuelve a añadir — `alter publication ... add table` da error si ya es miembro.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'sessions'
     )
  then
    execute 'alter publication supabase_realtime add table public.sessions';
  end if;
end
$$;
