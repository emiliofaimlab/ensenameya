-- ============================================================================
-- US-1703 · Se reactiva la purga del chat (decisión 22 del cliente, 24-jul)
--
-- El 17-jul la purga se PARÓ (`20260722200000`): la función dejó de borrar y
-- pasó a informar de cuánto habría caducado, porque la retención estaba sin
-- decidir. El cliente respondió el 24-jul: **30 días + descarga antes de
-- purgar**.
--
-- Los 30 días ya son el default de `messages.expires_at` desde EP-17, así que
-- lo único que faltaba era la descarga (US-1702, `/api/chat/[id]/download`),
-- que ya existe. Con eso, la función vuelve a borrar.
--
-- Se restaura la versión CON adjuntos (`20260722180000`): borrar solo las filas
-- dejaría el objeto huérfano en Storage, que es justo el dato personal que
-- RN-41 quiere caducar.
--
-- El cron (`purge-expired-messages`, 04:00 diario) nunca se desprogramó, así
-- que reemplazar la función basta para que vuelva a hacer efecto.
-- ============================================================================

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
    'estado',             'activa',
    'retencion_dias',     30,
    'messages_purged',    v_deleted,
    'attachments_purged', v_objects
  );
end;
$$;

-- Sigue siendo solo del cron: un `authenticated` que pueda vaciar mensajes
-- ajenos es la lección de US-605.
revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;
