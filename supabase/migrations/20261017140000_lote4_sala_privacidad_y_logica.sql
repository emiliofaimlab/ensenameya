-- ============================================================================
-- Enséñame Ya — Lote 4 del sondeo de grupales · sala: privacidad y lógica
-- (B10, M6, A6 · docs/SONDEO-GRUPALES-LOTES.md)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- · B10 · La sala grupal pintaba el NOMBRE COMPLETO de cada alumno («Mariana
--   Xóchitl») mientras el chat del mismo grupo lo enmascara («Víctor E.»).
--   Choca con RG-19 y pueden ser menores. El Route Handler leía `full_name`
--   por su cuenta; ahora el nombre que va en el token lo decide la BD, en el
--   mismo sitio que autoriza la entrada: alumno → `mask_person_name`, tutor →
--   su `display_name` (o `full_name` si no lo tiene).
-- · M6 · El cupo de Daily era capacidad + 1 (los alumnos y el tutor), sin
--   margen: una segunda pestaña o una reconexión dejaba fuera a un alumno que
--   pagó, o a la tutora, y la pantalla se quedaba en «Conectando…».
-- · A6 · RG-12 dice que la grabación de la fecha la ven TODOS los inscritos,
--   pero el que faltó (sesión `no_show`) no recibía el aviso NTF-19, y la
--   tutora no tenía dónde verla: el aviso le llegaba uno por alumno, con el
--   `booking_id` de una reserva que no es suya, y no había endpoint por fecha.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `join_group_class` REEMPLAZA a la de `20261014130000` (la vigente; el
--   cuerpo vivo de dev coincide con el del repo y ninguna migración posterior
--   la redefine). Tres cambios marcados «Lote 4 ·». Firma y tipo de vuelta
--   intactos → `create or replace` (la regla 12 no aplica). Claves nuevas en
--   el jsonb: `user_id` y `user_name` (nunca null).
-- · `max_participants` pasa a capacidad + 4: el cupo, el tutor y 3 de margen.
--   `ensureRoom` vuelve a aplicar las propiedades en cada entrada, así que el
--   cambio alcanza también a las salas ya creadas.
-- · `notify_recording` REEMPLAZA a la de `20261013170000` (la vigente; el
--   cuerpo vivo coincide). Se le antepone una rama GRUPAL: aviso al alumno
--   también si la sesión cierra en `no_show` (siempre que su reserva esté
--   pagada) y UNO solo al tutor por fecha, con clave de la group_class —
--   `enqueue_notification` hace `on conflict (idempotency_key) do nothing`,
--   así que las demás sesiones de la misma fecha no lo repiten—. Su payload
--   es { group_class_id, product_id, para: 'tutor' }, sin booking_id:
--   `rutaFor` ya lo manda a /tutor/clases-grupales/{product_id}. La rama 1:1
--   queda igual.
-- · `grabacion_de_fecha` es NUEVA: devuelve la sala y el fin de una fecha a
--   quien puede ver su grabación, con la misma autorización que B1 en
--   `api/recordings/[sessionId]/route.ts`. Sin permiso → cero filas, sin
--   error. `room_name` null → nadie entró a esa sala.
-- · Sin tablas nuevas: no hay RLS ni grants de tabla que declarar.
-- ============================================================================

-- ── 1 · join_group_class (B10 + M6) ─────────────────────────────────────────

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
  v_nombre  text;   -- Lote 4 · B10
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

  -- Lote 4 · B10 · el nombre que verán los demás en la sala. El del alumno va
  -- enmascarado como en el chat (RG-19: «Mariana X.»); el del tutor, el
  -- público de su ficha.
  if v_es_tutor then
    select coalesce(nullif(btrim(tp.display_name), ''), p.full_name) into v_nombre
      from public.profiles p
      left join public.tutor_profiles tp on tp.profile_id = p.id
     where p.id = v_uid;
  else
    select public.mask_person_name(p.full_name) into v_nombre
      from public.profiles p
     where p.id = v_uid;
  end if;

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
    -- Lote 4 · M6 · el cupo, el tutor y 3 de margen para una segunda pestaña
    -- o una reconexión.
    'max_participants', v_gc.capacity + 4,
    -- Lote 4 · B10 · quién entra y con qué nombre lo verán los demás.
    'user_id',          v_uid,
    'user_name',        coalesce(v_nombre, case when v_es_tutor then 'Tutor' else 'Alumno' end)
  );
end;
$$;

comment on function public.join_group_class(uuid) is
  'RG-12 · autoriza la entrada a la sala compartida de una fecha grupal: el tutor (anfitrión, is_tutor) o un alumno con su sesión de esa fecha y reserva pagada. Ventana session_access_window; ciclo M5 del alumno solo dentro de session_live_window. Escribe y devuelve la sala ''eyg-<id>''. Sin token: lo firma el Route Handler (G3). Lote 4: devuelve user_id y user_name —el alumno con el nombre enmascarado de mask_person_name (RG-19, B10); el tutor con su display_name o, si falta, full_name; nunca null— y max_participants = capacidad + 4 (el cupo, el tutor y 3 de margen para otra pestaña o una reconexión, M6).';

revoke execute on function public.join_group_class(uuid) from public, anon;
grant  execute on function public.join_group_class(uuid) to authenticated;

-- ── 2 · notify_recording (A6) ───────────────────────────────────────────────

create or replace function public.notify_recording()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Lote 4 · A6 · rama GRUPAL.
  if new.group_class_id is not null then
    if new.status in ('completed', 'no_show')
       and old.status not in ('completed', 'no_show')
       and public.recording_allowed(new.id)
       and exists (select 1 from public.bookings b
                    where b.id = new.booking_id
                      and b.status in ('confirmed', 'in_progress', 'completed'))
       -- Sin sala no hubo grabación: si nadie entró (ni la tutora), las
       -- sesiones cierran en no_show y el «ya puedes verla» sería falso.
       -- `daily_room_name` solo lo escribe join_group_class.
       and exists (select 1 from public.group_classes g
                    where g.id = new.group_class_id and g.daily_room_name is not null)
    then
      -- RG-12: la grabación de la fecha la ven TODOS los inscritos, también el
      -- que faltó (no_show).
      perform public.enqueue_notification(new.student_id, 'NTF-19', 'email', 'recording_ready',
        jsonb_build_object('booking_id', new.booking_id, 'session_id', new.id,
                           'group_class_id', new.group_class_id, 'para', 'alumno'),
        'NTF-19:session:' || new.id || ':student');
      -- Al tutor, UNO por fecha (y no uno por alumno), hacia su ficha de la
      -- clase: rutaFor ya lo resuelve con para=tutor + group_class_id +
      -- product_id. La clave es de la group_class y enqueue_notification
      -- ignora las repetidas.
      perform public.enqueue_notification(new.tutor_id, 'NTF-19', 'email', 'recording_ready',
        -- `booking_id`/`session_id` de cualquiera de los inscritos: es por donde
        -- pending_email_notifications resuelve la clase y la fecha del correo.
        jsonb_build_object('group_class_id', new.group_class_id,
                           'product_id', (select g.product_id from public.group_classes g
                                           where g.id = new.group_class_id),
                           'booking_id', new.booking_id, 'session_id', new.id,
                           'para', 'tutor'),
        'NTF-19:group_class:' || new.group_class_id || ':tutor');
    end if;
    return new;
  end if;

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
  'US-1802 / NTF-19: al completarse una sesión grabable encola recording_ready al alumno y al tutor. EY-218: el payload lleva para = alumno|tutor, que decide si el enlace va a /reservas/{id} o a /tutor/reservas/{id}. Lote 4 (A6) · en una GRUPAL avisa al alumno cuando su sesión cierra en completed O no_show —RG-12: la grabación la ven todos los inscritos, también el que faltó— siempre que su reserva esté pagada, y al tutor UNA vez por fecha (clave NTF-19:group_class:<id>:tutor, payload { group_class_id, product_id, para: tutor }, sin booking_id) hacia su ficha de la clase.';

-- ── 3 · grabacion_de_fecha (A6) ─────────────────────────────────────────────

create or replace function public.grabacion_de_fecha(p_group_class uuid)
returns table (room_name text, end_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select g.daily_room_name, g.end_at
    from public.group_classes g
   where g.id = p_group_class
     and ( g.tutor_id = (select auth.uid())
           or public.has_role('admin')
           or exists (select 1
                        from public.sessions s
                        join public.bookings b on b.id = s.booking_id
                       where s.group_class_id = g.id
                         and s.student_id = (select auth.uid())
                         and s.status <> 'cancelled'
                         and b.status in ('confirmed', 'in_progress', 'completed')) );
$$;

comment on function public.grabacion_de_fecha(uuid) is
  'Lote 4 (A6) · sala (daily_room_name) y fin de una fecha grupal para buscar su grabación en Daily. Misma autorización que B1 en api/recordings/[sessionId]: el tutor de la clase y el admin siempre; el alumno, con su sesión de esa fecha no cancelada —no_show incluido, RG-12— y la reserva pagada. Sin permiso o sin la fecha devuelve CERO filas, sin error; room_name null significa que nadie entró a la sala.';

revoke execute on function public.grabacion_de_fecha(uuid) from public, anon;
grant  execute on function public.grabacion_de_fecha(uuid) to authenticated;
