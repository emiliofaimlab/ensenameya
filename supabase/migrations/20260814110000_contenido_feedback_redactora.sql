-- ============================================================================
-- Contenido — feedback de la redactora ("Feedback Enseñame ya.docx", Ennis,
-- 14-ago-2026), la parte que vive en la BD:
--
-- 1) El error de ventana de `send_message` decía "clase"; el chat es superficie
--    de panel con sesión → "mentoría" (criterio del barrido del 12-ago; el
--    mensaje llega tal cual al usuario vía toast en chat-thread.tsx).
--    Redefinición íntegra de la versión vigente (20260722200000); solo cambia
--    ese literal.
--
-- 2) La categoría del seed "Arte y Diseño" → "Arte y diseño": en español no hay
--    Title Case, y el propio seed ya usaba sentence case en el resto. Es dato
--    aplicado, así que va como UPDATE (el seed original tiene on conflict do
--    nothing y no re-corre).
-- ============================================================================

-- ── 1) send_message: "clase" → "mentoría" en el error de ventana ────────────
create or replace function public.send_message(
  p_booking_id      uuid,
  p_body            text,
  p_attachment_path text   default null,
  p_attachment_name text   default null,
  p_attachment_size bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_bk     record;
  v_first  timestamptz;
  v_msg    uuid;
  v_body   text := btrim(coalesce(p_body, ''));
  v_name   text := btrim(coalesce(p_attachment_name, ''));
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_body = '' and p_attachment_path is null then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'check_violation';
  end if;

  -- Participante de la reserva (alumno o tutor).
  select id, student_id, tutor_id, status into v_bk
  from public.bookings
  where id = p_booking_id and v_uid in (student_id, tutor_id);
  if v_bk.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- El adjunto tiene que vivir en la carpeta de ESTA reserva. Sin esto, un
  -- participante podría colgar en su hilo la ruta de otra reserva suya y
  -- filtrarla al otro lado (la RLS de Storage la dejaría leer: es participante).
  if p_attachment_path is not null then
    if p_attachment_path not like p_booking_id::text || '/%' then
      raise exception 'el adjunto no pertenece a esta reserva' using errcode = 'check_violation';
    end if;
    if v_name = '' or coalesce(p_attachment_size, 0) <= 0 then
      raise exception 'adjunto incompleto' using errcode = 'check_violation';
    end if;

    -- Acuerdo 17-jul: prefijo para separar lo del chat del material inicial.
    -- Idempotente: reenviar un nombre ya prefijado no lo duplica.
    if v_name not like 'chat\_%' then
      v_name := 'chat_' || v_name;
    end if;
  end if;

  -- Ventana: desde 2 días antes de la 1ª sesión (RN-41). Reservas sin sesiones
  -- (aún sin confirmar) no tienen chat todavía.
  select min(start_at) into v_first from public.sessions where booking_id = p_booking_id;
  if v_first is null then
    raise exception 'el chat se habilita al confirmarse la reserva' using errcode = 'check_violation';
  end if;
  if now() < v_first - interval '2 days' then
    raise exception 'el chat se abre 2 días antes de tu primera mentoría' using errcode = 'check_violation';
  end if;

  insert into public.messages
    (booking_id, sender_id, body, attachment_path, attachment_name, attachment_size)
  values
    (p_booking_id, v_uid, v_body, p_attachment_path, nullif(v_name, ''), p_attachment_size)
  returning id into v_msg;

  return v_msg;
end;
$$;

grant execute on function public.send_message(uuid, text, text, text, bigint) to authenticated;

-- ── 2) Categoría "Arte y Diseño" → "Arte y diseño" ──────────────────────────
update public.categories
   set name = 'Arte y diseño'
 where slug = 'arte-y-diseno'
   and name = 'Arte y Diseño';
