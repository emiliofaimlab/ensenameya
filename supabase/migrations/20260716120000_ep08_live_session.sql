-- ============================================================================
-- Enséñame Ya — EP-08: sala en vivo (Daily). US-801 (entrar) + US-802 (ciclo).
--
-- Proveedor de video SIMULADO, igual que el PSP (regla de oro 8): toda la
-- LÓGICA del AC se construye y se prueba ahora; el embed real de Daily (crear
-- sala vía API + firmar el meeting-token con la API key) se cablea cuando
-- lleguen las credenciales — hoy no están en el env. Un proveedor real = una
-- Edge Function que sustituya el room-url/token simulados, sin tocar el negocio.
--
-- RN-18 / S-45: la ventana de acceso es 10 min antes del inicio y 10 min
-- después del fin. C-08 (que el docx dejaba "pendiente") queda resuelto por el
-- propio AC de US-801, que fija 10/10 — se deja como constante nombrada por si
-- el cliente la cambia.
--
-- Doc 1 §1.4.11: el token se genera server-side AL UNIRSE y NO se almacena.
-- Las columnas daily_room_name/url ya existen en `sessions` (EP-06); la sala se
-- provisiona de forma perezosa en el primer join (con proveedor real sería al
-- confirmar la reserva; simulado, da igual y evita una llamada externa).
-- ============================================================================

-- Ventana de acceso (S-45). Nombradas por si C-08 las mueve.
create or replace function public.session_access_window(
  p_start timestamptz,
  p_end   timestamptz
)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_start - interval '10 minutes', p_end + interval '10 minutes', '[]');
$$;

-- ── US-801: unirse a la sala ────────────────────────────────────────────────
-- Devuelve el room-url y un token efímero (simulado) SOLO si el que llama es
-- participante y `now()` cae en la ventana. De paso mueve el ciclo (US-802):
-- primer join → sesión in_progress y, si era la primera, la reserva in_progress.
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

  -- Provisión perezosa de la sala (simulada). Con Daily real, esto lo haría una
  -- Edge Function creando la room vía API y guardando su url.
  if v_sess.daily_room_name is null then
    v_room := 'sim-' || replace(v_sess.id::text, '-', '');
    update public.sessions
       set daily_room_name = v_room,
           daily_room_url   = 'https://sim.daily.local/' || v_room
     where id = v_sess.id
     returning daily_room_url into v_sess.daily_room_url;
  end if;

  -- US-802: primer join abre la sesión y, si procede, la reserva.
  if v_sess.status = 'scheduled' then
    update public.sessions set status = 'in_progress' where id = v_sess.id;
  end if;
  if v_booking = 'confirmed' then
    update public.bookings set status = 'in_progress' where id = v_sess.booking_id;
  end if;

  -- Token efímero, generado aquí y NO almacenado (Doc 1 §1.4.11). Con Daily
  -- real sería un JWT firmado con la API key, scoped a room+usuario+exp.
  return jsonb_build_object(
    'room_url', v_sess.daily_room_url,
    'token',    'sim-token-' || replace(v_sess.id::text, '-', '') || '-'
                  || floor(extract(epoch from now()))::text,
    'is_tutor', v_sess.tutor_id = v_uid,
    'ends_at',  v_sess.end_at,
    'simulated', true
  );
end;
$$;

grant execute on function public.join_session(uuid) to authenticated;

-- ── US-802: el tutor marca la sesión como completada (S-26, cierre anticipado) ─
create or replace function public.complete_session(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_booking uuid;
  v_pending int;
begin
  update public.sessions
     set status = 'completed', completed_at = now()
   where id = p_session_id
     and tutor_id = v_uid                       -- solo el tutor cierra
     and status in ('scheduled', 'in_progress')
   returning booking_id into v_booking;

  if v_booking is null then
    raise exception 'sesión no encontrada o no cerrable' using errcode = 'check_violation';
  end if;

  -- Reserva completada cuando ya no le quedan sesiones abiertas.
  select count(*) into v_pending
  from public.sessions
  where booking_id = v_booking and status in ('scheduled', 'in_progress');

  if v_pending = 0 then
    update public.bookings set status = 'completed', completed_at = now()
     where id = v_booking and status in ('confirmed', 'in_progress');
  end if;

  return 'completed';
end;
$$;

grant execute on function public.complete_session(uuid) to authenticated;

-- ── US-802: cierre automático al vencer la ventana (S-26) ───────────────────
-- Lo corre el cron: una sesión cuya ventana ya cerró pasa a completed
-- (`no_show` si nadie llegó a entrar), y su reserva a completed cuando no le
-- quedan sesiones abiertas.
create or replace function public.close_expired_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed  int;
  v_booking_ids uuid[];
begin
  -- Cierra las sesiones vencidas y recuerda sus reservas para revisarlas.
  with expired as (
    update public.sessions s
       set status = case when s.status = 'in_progress' then 'completed' else 'no_show' end,
           completed_at = case when s.status = 'in_progress' then now() else completed_at end
     where s.status in ('scheduled', 'in_progress')
       and now() > s.end_at + interval '10 minutes'   -- fin de ventana (S-45)
    returning s.booking_id
  )
  select count(*), array_agg(distinct booking_id) into v_closed, v_booking_ids from expired;

  -- Reservas cuyas sesiones ya están todas resueltas → completed.
  if v_booking_ids is not null then
    update public.bookings b
       set status = 'completed', completed_at = now()
     where b.id = any(v_booking_ids)
       and b.status in ('confirmed', 'in_progress')
       and not exists (
         select 1 from public.sessions s
         where s.booking_id = b.id and s.status in ('scheduled', 'in_progress')
       );
  end if;

  return jsonb_build_object('sessions_closed', coalesce(v_closed, 0));
end;
$$;

-- Gotcha de US-605: EXECUTE es PUBLIC por defecto. Se revoca y se concede solo
-- al cron/service_role — un `authenticated` no debe poder cerrar sesiones ajenas.
revoke execute on function public.close_expired_sessions() from public;
revoke execute on function public.close_expired_sessions() from anon;
revoke execute on function public.close_expired_sessions() from authenticated;
grant  execute on function public.close_expired_sessions() to service_role;

-- Job cada 5 min (idempotente: unschedule previo si existiera).
select cron.unschedule('close-expired-sessions')
where exists (select 1 from cron.job where jobname = 'close-expired-sessions');
select cron.schedule('close-expired-sessions', '*/5 * * * *', $cron$ select public.close_expired_sessions(); $cron$);
