-- ============================================================================
-- Acuerdos de la reunión de desarrollo del 17-jul-2026 que tocan el chat.
--
-- 1) Prefijo `chat_` en los adjuntos (00:17:20). Emilio pidió que el sistema
--    renombre lo compartido EN el chat para distinguirlo del material inicial
--    de la clase. Se hace en la RPC, no en el cliente: es una regla, y el
--    cliente no debe poder saltársela.
--
-- 2) Se PARA el borrado duro a 30 días (00:15:xx vs 00:22:40). La reunión dio
--    dos números — 30 días atados a la grabación y 5 días de conversación
--    activa — y además pidió que el chat quede "archivado y descargable", no
--    borrado. Hasta que eso se decida, la purga no destruye nada.
-- ============================================================================

-- ── 1) Prefijo `chat_` ──────────────────────────────────────────────────────
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
    raise exception 'el chat se abre 2 días antes de tu primera clase' using errcode = 'check_violation';
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

-- ── 2) Purga en pausa ───────────────────────────────────────────────────────
-- El cron (`purge-expired-messages`, 04:00 diario) se deja programado a
-- propósito: si se desprograma, se olvida. La función deja de destruir y pasa a
-- INFORMAR de cuánto habría caducado, que es justo el dato que Emilio pidió
-- para el estudio de almacenamiento (00:15:xx).
--
-- Para reactivar el borrado hace falta una decisión de negocio, no un cambio de
-- código: cuántos días de conversación activa, cuántos de retención, y si el
-- hilo se archiva descargable en vez de borrarse.
create or replace function public.purge_expired_messages()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due       int;
  v_due_files int;
  v_bytes     bigint;
begin
  select
    count(*),
    count(*) filter (where attachment_path is not null),
    coalesce(sum(attachment_size), 0)
  into v_due, v_due_files, v_bytes
  from public.messages
  where expires_at < now();

  return jsonb_build_object(
    'estado',             'pausada',
    'motivo',             'retención sin decidir (reunión 17-jul: 5 días activo vs 30 de retención, archivado descargable)',
    'messages_purged',    0,
    'attachments_purged', 0,
    'messages_vencidos',  v_due,
    'adjuntos_vencidos',  v_due_files,
    'bytes_vencidos',     v_bytes
  );
end;
$$;

revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;
