-- ============================================================================
-- LV01 — "Subir documentos" dentro de la sala (EP-22 / IV-04).
--
-- El Figma pone un botón "Subir documentos" en la barra de la sala, y su propio
-- hilo de chat dice "Te comparto mi CV en un momento": el documento viaja POR EL
-- CHAT, no por un almacén aparte. Así que es un adjunto de `messages` (EP-17) y
-- no una tabla nueva.
--
-- Hereda gratis de EP-17: RLS por participantes, entrega por Realtime y la
-- purga a 30 días (RN-41). Ojo con eso último: el mensaje se borra pero el
-- objeto de Storage NO — queda anotado abajo.
-- ============================================================================

alter table public.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_size bigint
    check (attachment_size is null or attachment_size > 0);

-- Un mensaje solo-adjunto no lleva texto: el check original exigía cuerpo.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_or_attachment
  check (btrim(body) <> '' or attachment_path is not null);

-- ── Bucket privado ──────────────────────────────────────────────────────────
-- Privado a propósito: son documentos personales (el CV del ejemplo). Se leen
-- con URL firmada, no por URL pública.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments', 'chat-attachments', false,
  10485760,  -- 10 MB
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

-- La carpeta es el id de la RESERVA (no el uid): los dos participantes leen el
-- mismo hilo. La pertenencia se comprueba contra `bookings`, igual que la RLS
-- de `messages`.
drop policy if exists "chat_attachments_insert_participant" on storage.objects;
create policy "chat_attachments_insert_participant"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.bookings b
      where b.id::text = (storage.foldername(name))[1]
        and (select auth.uid()) in (b.student_id, b.tutor_id)
    )
  );

drop policy if exists "chat_attachments_select_participant" on storage.objects;
create policy "chat_attachments_select_participant"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.bookings b
      where b.id::text = (storage.foldername(name))[1]
        and (select auth.uid()) in (b.student_id, b.tutor_id)
    )
  );

-- Sin DELETE: un adjunto ya enviado no se retira del hilo del otro. La purga la
-- hace el service_role (ver nota al final).

-- ── send_message con adjunto ────────────────────────────────────────────────
-- Hay que soltar la firma vieja: si se dejaran las dos, una llamada de 2 args
-- sería ambigua para PostgREST. Los nuevos parámetros van con default, así que
-- el cliente que solo manda texto sigue funcionando igual.
drop function if exists public.send_message(uuid, text);

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
    if btrim(coalesce(p_attachment_name, '')) = '' or coalesce(p_attachment_size, 0) <= 0 then
      raise exception 'adjunto incompleto' using errcode = 'check_violation';
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
    (p_booking_id, v_uid, v_body, p_attachment_path, btrim(p_attachment_name), p_attachment_size)
  returning id into v_msg;

  return v_msg;
end;
$$;

grant execute on function public.send_message(uuid, text, text, text, bigint) to authenticated;

-- ── Purga (US-1703): ahora también los objetos ──────────────────────────────
-- `purge_expired_messages` borraba solo filas. Con adjuntos eso dejaría huérfano
-- el objeto en Storage, que es justo el dato personal que RN-41 quiere caducar.
create or replace function public.purge_expired_messages()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
  v_objects int;
begin
  with gone as (
    delete from public.messages where expires_at < now()
    returning attachment_path
  ),
  dropped as (
    delete from storage.objects
    where bucket_id = 'chat-attachments'
      and name in (select attachment_path from gone where attachment_path is not null)
    returning 1
  )
  select
    (select count(*) from gone),
    (select count(*) from dropped)
  into v_deleted, v_objects;

  return jsonb_build_object(
    'messages_purged', v_deleted,
    'attachments_purged', v_objects
  );
end;
$$;

revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
