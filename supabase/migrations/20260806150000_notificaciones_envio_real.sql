-- ============================================================================
-- Enséñame Ya — US-1201: las notificaciones por correo se envían de verdad
-- (EP-12 · C-11/DP-05 resuelta → Resend · Doc 7)
--
-- QUÉ PASABA. `process_notifications()` era el stub del EmailProvider: cada 2
-- minutos marcaba TODAS las pendientes como `sent` sin enviar nada. Nadie
-- recibía un correo —reserva nueva, pago, KYC, cancelación, liquidación— y la
-- tabla registraba que sí, así que el fallo era invisible incluso para el admin.
--
-- EL DETALLE QUE ROMPE TODO SI SE PASA POR ALTO: mientras ese cron siga
-- marcando `sent`, cualquier remitente externo llega SIEMPRE a una cola vacía.
-- Da igual lo bien escrito que esté: se ejecuta cada 5 minutos y el stub vació
-- la cola dos veces por el medio. Por eso lo primero de esta migración es
-- desactivar el stub, no añadir el envío.
--
-- Se sigue el precedente del propio proyecto (`20260722200000`, pausa de la
-- purga del chat): la función NO se borra ni se desprograma el cron —"si se
-- desprograma, se olvida"— sino que deja de actuar y pasa a INFORMAR. Así
-- `select public.process_notifications();` sigue siendo el sitio donde mirar
-- cuánto hay encolado, y si el remitente externo se cae, la cola se ve crecer
-- en vez de desaparecer sin rastro.
--
-- QUIÉN ENVÍA AHORA: `/api/cron/notifications-send`, invocado cada 5 minutos.
-- Va como route handler y no como Edge Function por lo mismo que la purga de
-- grabaciones (ver `20260806130000`): el repo ya eligió ese patrón en
-- `20260717120000` y una función de Deno duplicaría cliente y despliegue.
--
-- POR QUÉ DOS RPC Y NINGÚN GRANT DE TABLA. El correo del destinatario vive en
-- `auth.users`, que no está expuesto por la Data API — y mejor así. En vez de
-- abrir `notifications` a `service_role`, se le dan exactamente dos verbos:
-- leer el lote pendiente (con el correo ya resuelto) y marcar el resultado.
-- El remitente no puede tocar nada más de la tabla, ni siquiera por error.
-- ============================================================================

-- ── 1) El stub deja de vaciar la cola ───────────────────────────────────────
create or replace function public.process_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending_email  int;
  v_pending_in_app int;
  v_failed         int;
  v_oldest         timestamptz;
begin
  select
    count(*) filter (where channel = 'email'  and status = 'pending'),
    count(*) filter (where channel = 'in_app' and status = 'pending'),
    count(*) filter (where status = 'failed'),
    min(created_at) filter (where status = 'pending')
  into v_pending_email, v_pending_in_app, v_failed, v_oldest
  from public.notifications;

  return jsonb_build_object(
    'estado',           'delegada',
    'envia',            '/api/cron/notifications-send (Resend)',
    -- Si esto crece sin parar, el remitente externo no está corriendo.
    'pendientes_email', v_pending_email,
    'pendientes_in_app', v_pending_in_app,
    'fallidas',         v_failed,
    'mas_antigua',      v_oldest
  );
end;
$$;

-- ── 2) El lote pendiente, con el correo ya resuelto ─────────────────────────
-- SECURITY DEFINER porque lee `auth.users`. Devuelve el correo YA resuelto para
-- que el remitente no necesite acceso a auth ni una llamada por destinatario.
-- Las `in_app` se quedan fuera: esas las pinta la campana (US-1203).
create or replace function public.pending_email_notifications(p_limit int default 50)
returns table (
  id       uuid,
  type     text,
  template text,
  payload  jsonb,
  email    text,
  nombre   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.type, n.template, n.payload,
         u.email::text,
         coalesce(p.full_name, '')
    from public.notifications n
    join auth.users     u on u.id = n.recipient_id
    left join public.profiles p on p.id = n.recipient_id
   where n.status  = 'pending'
     and n.channel = 'email'
   order by n.created_at          -- lo más viejo primero: nadie se queda atrás
   limit greatest(1, least(p_limit, 200));
$$;

revoke execute on function public.pending_email_notifications(int) from public;
revoke execute on function public.pending_email_notifications(int) from anon;
revoke execute on function public.pending_email_notifications(int) from authenticated;
grant  execute on function public.pending_email_notifications(int) to service_role;

-- ── 3) Marcar el resultado ──────────────────────────────────────────────────
-- Solo dos destinos posibles, y solo desde 'pending': si el envío se reintenta
-- por un fallo transitorio, la fila se queda 'pending' y la coge la pasada
-- siguiente. Marcar 'failed' es una decisión del remitente para errores
-- PERMANENTES (dirección inválida, plantilla desconocida), no para un 500 del
-- proveedor — si no, un mal minuto de Resend perdería avisos para siempre.
create or replace function public.mark_notification(p_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
     set status  = case when p_ok then 'sent' else 'failed' end::public.notification_status,
         sent_at = case when p_ok then now() else sent_at end
   where id = p_id
     and status = 'pending';
end;
$$;

revoke execute on function public.mark_notification(uuid, boolean) from public;
revoke execute on function public.mark_notification(uuid, boolean) from anon;
revoke execute on function public.mark_notification(uuid, boolean) from authenticated;
grant  execute on function public.mark_notification(uuid, boolean) to service_role;
