-- ============================================================================
-- Enséñame Ya — EY-232: el tutor extiende la clase 5 minutos, una sola vez,
-- gratis para el alumno (portal de soporte, Néstor, 16-oct)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- «La llamada se corta bruscamente». La sala de Daily muere en
-- `access_closes_at` (= fin + 10 min, `20260826130000`) con
-- `eject_at_room_exp`, y a esa misma hora el cron `close_expired_sessions`
-- cierra la sesión y la sala echa al alumno por Realtime (`20260828120000`).
--
-- ── CÓMO ───────────────────────────────────────────────────────────────────
-- Se mueve `end_at` 5 minutos y todo lo demás lo arrastra solo:
--   · `sessions_set_access_window` (`update of start_at, end_at`) recalcula
--     `access_closes_at`, que es el `exp` de la sala;
--   · `close_expired_sessions()` lee `end_at`, así que no cierra antes;
--   · `sessions_google_calendar` actualiza el evento.
-- La sala de Daily NO se entera sola: el Route Handler
-- `/api/room/[sessionId]/extender` le vuelve a aplicar `exp` tras esta RPC.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Gratis: no toca `bookings` ni `payments`. El payout sale de la reserva, no
--   de los minutos. `completed_at` llega 5 min más tarde, nada más.
-- · El choque con la siguiente clase del TUTOR lo frena la exclusión
--   `sessions_sin_solape_por_tutor` (`20260831180000`) → 23P01. Aquí se
--   comprueba a mano lo que esa exclusión no ve: las otras clases del ALUMNO y
--   las que el tutor toma como alumno (EY-228).
-- · Una sola vez: `extended_at` no nulo = ya se extendió.
-- ============================================================================

alter table public.sessions
  add column if not exists extended_at timestamptz;

comment on column public.sessions.extended_at is
  'EY-232: cuándo el tutor extendió la clase 5 min (end_at ya lleva los 5 min dentro). null = no se extendió. Solo una vez por sesión.';

create or replace function public.extend_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s       public.sessions;
  v_new_end timestamptz;
begin
  select * into v_s
    from public.sessions
   where id = p_session_id
   for update;

  if v_s.id is null or v_s.tutor_id <> (select auth.uid()) then
    raise exception 'solo el tutor de la clase puede extenderla'
      using errcode = 'insufficient_privilege';
  end if;

  if v_s.extended_at is not null then
    raise exception 'esta clase ya se extendió una vez' using errcode = 'check_violation';
  end if;

  if v_s.status not in ('scheduled', 'in_progress') then
    raise exception 'la clase ya terminó' using errcode = 'check_violation';
  end if;

  -- Desde los últimos 10 min de la clase hasta que la sala se cierra.
  if now() < v_s.end_at - interval '10 minutes'
     or now() > coalesce(v_s.access_closes_at, v_s.end_at + interval '10 minutes') then
    raise exception 'solo se puede extender al final de la clase' using errcode = 'check_violation';
  end if;

  v_new_end := v_s.end_at + interval '5 minutes';

  -- El alumno, o el tutor como alumno, con otra clase en esos 5 minutos.
  if exists (
    select 1
      from public.sessions o
     where o.id <> v_s.id
       and o.status not in ('cancelled', 'no_show', 'completed')
       and (o.student_id in (v_s.student_id, v_s.tutor_id)
            or o.tutor_id = v_s.student_id)
       and tstzrange(o.start_at, o.end_at) && tstzrange(v_s.end_at, v_new_end)
  ) then
    raise exception 'hay otra clase justo después' using errcode = 'check_violation';
  end if;

  update public.sessions
     set end_at = v_new_end,
         extended_at = now()
   where id = v_s.id
  returning * into v_s;

  return jsonb_build_object(
    'room_name', v_s.daily_room_name,
    'starts_at', v_s.start_at,
    'ends_at',   v_s.end_at,
    'closes_at', v_s.access_closes_at
  );
exception
  when exclusion_violation then
    raise exception 'hay otra clase justo después' using errcode = 'check_violation';
end;
$$;

comment on function public.extend_session(uuid) is
  'EY-232: el tutor alarga 5 min su clase (una vez, gratis). Mueve end_at; el trigger recalcula access_closes_at. Devuelve lo que necesita ensureRoom para reaplicar el exp en Daily.';

revoke execute on function public.extend_session(uuid) from public, anon;
grant execute on function public.extend_session(uuid) to authenticated;
