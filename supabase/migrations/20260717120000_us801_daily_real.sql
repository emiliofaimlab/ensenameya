-- ============================================================================
-- Enséñame Ya — US-801: cablear Daily REAL (deja de ser simulado).
--
-- Reparto de responsabilidades (lo que la BD puede y lo que no):
--   · `join_session` (aquí) SIGUE mandando en la AUTORIZACIÓN y el CICLO:
--     participante, reserva activa, sesión no cerrada, ventana RN-18/S-45,
--     y las transiciones M5 (scheduled→in_progress, booking→in_progress).
--     Las guardas NO cambian: son las ya verificadas en EP-08.
--   · Postgres NO puede llamar a la API de Daily ni firmar un meeting-token.
--     Eso lo hace el endpoint server-side `/api/room/[sessionId]` con la
--     DAILY_API_KEY (server-only), que primero llama a esta RPC para autorizar.
--
-- Cambia solo:
--   1. El nombre de sala deja de ser `sim-*` → `ey-<sessionid>` (determinista,
--      así el endpoint lo reusa sin guardar nada extra).
--   2. Ya no se inventa `daily_room_url` (`sim.daily.local`) ni un token falso:
--      la URL la devuelve Daily al crear la sala y el token lo firma el server.
-- ============================================================================

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
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select s.id, s.booking_id, s.student_id, s.tutor_id, s.status,
         s.start_at, s.end_at, s.daily_room_name, s.daily_room_url
    into v_sess
  from public.sessions s
  where s.id = p_session_id
    and (s.student_id = v_uid or s.tutor_id = v_uid);   -- RLS de participante, reforzada
  if v_sess.id is null then
    raise exception 'sesión no encontrada' using errcode = 'no_data_found';
  end if;

  -- La reserva debe estar viva. Una cancelada/reembolsada no da acceso.
  select status into v_booking from public.bookings where id = v_sess.booking_id;
  if v_booking not in ('confirmed', 'in_progress') then
    raise exception 'la reserva no está activa (%).', v_booking using errcode = 'check_violation';
  end if;

  -- Sesión ya cerrada: no se re-entra (RN-18 + ciclo M5).
  if v_sess.status in ('completed', 'cancelled', 'no_show') then
    raise exception 'la sesión ya terminó' using errcode = 'check_violation';
  end if;

  -- RN-18: solo dentro de la ventana. Fuera → bloqueado (la UI muestra la
  -- cuenta regresiva; el server es la barrera con dientes).
  if not public.session_access_window(v_sess.start_at, v_sess.end_at) @> now() then
    raise exception 'fuera de la ventana de acceso' using errcode = 'check_violation';
  end if;

  -- Nombre de sala determinista: el endpoint lo usa para crear/reusar la room
  -- en Daily sin que la BD tenga que conocer el dominio ni guardar la URL.
  v_room := 'ey-' || replace(v_sess.id::text, '-', '');
  if v_sess.daily_room_name is distinct from v_room then
    update public.sessions set daily_room_name = v_room where id = v_sess.id;
  end if;

  -- US-802: primer join abre la sesión y, si procede, la reserva.
  if v_sess.status = 'scheduled' then
    update public.sessions set status = 'in_progress' where id = v_sess.id;
  end if;
  if v_booking = 'confirmed' then
    update public.bookings set status = 'in_progress' where id = v_sess.booking_id;
  end if;

  -- Sin token aquí: lo firma el server con la API key (Doc 1 §1.4.11: el token
  -- se genera al unirse y NO se almacena).
  return jsonb_build_object(
    'room_name', v_room,
    'is_tutor',  v_sess.tutor_id = v_uid,
    'ends_at',   v_sess.end_at
  );
end;
$$;
