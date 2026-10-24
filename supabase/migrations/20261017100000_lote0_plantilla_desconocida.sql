-- ============================================================================
-- Enséñame Ya — un aviso con plantilla desconocida espera 24 h (B12)
--
-- Sondeo de grupales del 16-oct (`docs/SONDEO-GRUPALES-LOTES.md`, lote 0).
--
-- `/api/cron/notifications-send` marcaba `failed` para siempre todo aviso cuya
-- plantilla no conocía. Pero eso no es un error de la fila: pasa cuando la
-- migración que encola una plantilla nueva llega antes que el código que la
-- pinta (CI aplica migraciones y Vercel despliega a la vez), y en dev siempre,
-- porque el reloj del correo lo ejecuta la rama `dev` mientras las plantillas
-- grupales viven en `feat/grupales-academias`. Los cinco correos grupales del
-- sondeo salieron `failed` por eso.
--
-- El job no puede leer `notifications` (solo tiene estas RPC, ver
-- `20260806150000`), así que la antigüedad la mira esta función: devuelve true
-- si marcó la fila `failed` (más de 24 h esperando) y false si la deja
-- `pending` para la pasada siguiente. Las 24 h evitan que se acumulen y tapen
-- el lote de 50.
-- ============================================================================

create or replace function public.descartar_plantilla_desconocida(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
     set status = 'failed'::public.notification_status
   where id = p_id
     and status = 'pending'
     and created_at < now() - interval '24 hours';
  return found;
end;
$$;

comment on function public.descartar_plantilla_desconocida(uuid) is
  'B12 · el job de correo la llama cuando no conoce la plantilla de un aviso: lo marca failed solo si lleva más de 24 h pendiente (true) y si no lo deja pending (false). Evita perder avisos por un despliegue que llega después de su migración.';

revoke execute on function public.descartar_plantilla_desconocida(uuid) from public;
revoke execute on function public.descartar_plantilla_desconocida(uuid) from anon;
revoke execute on function public.descartar_plantilla_desconocida(uuid) from authenticated;
grant  execute on function public.descartar_plantilla_desconocida(uuid) to service_role;
