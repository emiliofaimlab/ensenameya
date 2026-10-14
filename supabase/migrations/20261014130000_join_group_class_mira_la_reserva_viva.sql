-- ============================================================================
-- Enséñame Ya — join_group_class entra con la reserva VIVA del alumno (G3)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Un alumno que abre el checkout de una grupal, lo abandona (su hold caduca o
-- lo suelta con «Volver a la clase») y después vuelve y paga tiene DOS
-- sesiones en cada fecha: la de la reserva cancelada y la de la pagada. La
-- versión anterior tomaba una cualquiera sin mirar el estado y, si salía la
-- cancelada, lo dejaba fuera con «la reserva no está activa (cancelled)»
-- habiendo pagado. Se vio en dev al probar G3 con Mateo (14-oct).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · REEMPLAZA a la versión de `20261009130000:155` (la viva; nadie más la
--   redefinió). Un solo cambio, marcado «G3 ·»: la sesión se elige
--   prefiriendo la de una reserva viva y, dentro de eso, una no cancelada.
--   Si no hay ninguna viva, las comprobaciones de abajo rechazan igual que
--   antes, con el mismo texto.
-- · Firma y tipo de vuelta intactos: `create or replace` (regla 12) y los
--   grants se conservan.
-- ============================================================================

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
    -- G3 · con un hold abandonado hay más de una sesión por fecha: manda la
    -- de la reserva viva (ver la cabecera).
    select s.id, s.booking_id, s.status into v_sess
      from public.sessions s
      join public.bookings b on b.id = s.booking_id
     where s.group_class_id = v_gc.id and s.student_id = v_uid
     order by (b.status in ('confirmed', 'in_progress', 'completed')) desc,
              (s.status <> 'cancelled') desc
     limit 1;
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
