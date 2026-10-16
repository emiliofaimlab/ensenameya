-- ============================================================================
-- Enséñame Ya — EY-232 en la rama de grupales: extender 5 min NO aplica a una
-- clase grupal
--
-- `extend_session` (`20261016210000`, viene de `dev`) mueve el `end_at` de UNA
-- fila de `sessions`. En grupales hay una fila por ALUMNO con
-- `group_class_id` (`20261009190000:302`), así que llamarla sobre una de ellas
-- alargaría la clase a un solo alumno del grupo. La sala grupal
-- (`SalaGrupal`) no pinta el botón, pero la RPC se puede llamar a mano: la
-- guarda va en la base.
--
-- Cuerpo íntegro de `20261016210000`; solo cambia el bloque marcado. Vive solo
-- en esta rama porque `group_class_id` no existe en `dev`.
-- ============================================================================

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

  -- Lo único que cambia respecto a `20261016210000`.
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

