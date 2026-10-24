-- ============================================================================
-- Enséñame Ya — Sala: el tutor elige extender 5, 10 o 20 minutos
-- (correcciones de la sala de Emilio, 16-oct, punto 6)
--
-- `extend_session` (`20261016220000`) solo sabía sumar 5. Ahora recibe los
-- minutos. Todo lo demás se queda igual: una sola vez, gratis para el alumno,
-- no aplica a grupales, mismas comprobaciones de choque.
--
-- ⚠️ Regla de oro 12: añadir un argumento es `drop` + `create`, no
-- `create or replace` (dejaría DOS funciones y PostgREST respondería PGRST203).
-- `p_minutos` lleva `default 5` para que el código de la rama `dev` —que llama
-- con un solo argumento y comparte la BD de dev con esta rama— siga
-- resolviendo a ESTA función. El `drop` se lleva los `grant`: se reponen abajo.
-- ============================================================================

drop function if exists public.extend_session(uuid);

create function public.extend_session(p_session_id uuid, p_minutos int default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s       public.sessions;
  v_new_end timestamptz;
begin
  if p_minutos is null or p_minutos not in (5, 10, 20) then
    raise exception 'solo se puede extender 5, 10 o 20 minutos' using errcode = 'check_violation';
  end if;

  select * into v_s
    from public.sessions
   where id = p_session_id
   for update;

  if v_s.id is null or v_s.tutor_id <> (select auth.uid()) then
    raise exception 'solo el tutor de la clase puede extenderla'
      using errcode = 'insufficient_privilege';
  end if;

  if v_s.group_class_id is not null then
    raise exception 'las clases grupales no se pueden extender' using errcode = 'check_violation';
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

  v_new_end := v_s.end_at + make_interval(mins => p_minutos);

  -- El alumno, o el tutor como alumno, con otra clase en esos minutos.
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

comment on function public.extend_session(uuid, int) is
  'Sala: el tutor alarga su clase 5, 10 o 20 min (una vez, gratis, no grupales). Mueve end_at; el trigger recalcula access_closes_at. Devuelve lo que necesita ensureRoom para reaplicar el exp en Daily.';

revoke execute on function public.extend_session(uuid, int) from public, anon;
grant execute on function public.extend_session(uuid, int) to authenticated;
