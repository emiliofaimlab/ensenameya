-- ============================================================================
-- Enséñame Ya — US-605: cerrar el grant de `expire_stale_bookings`.
--
-- La migración `20260709190000` se lo concedió a `authenticated` para poder
-- verificar el timeout sin esperar 20 min / 24 h (los cutoffs son parámetros).
-- Quedó anotado como "revocar antes de prod" y aquí se salda.
--
-- Por qué importa: la función es SECURITY DEFINER y los cutoffs son argumentos,
-- así que CUALQUIER usuario autenticado podía llamarla con `0 seconds` y vencer
-- de golpe las reservas pendientes de TODA la plataforma (pending_payment →
-- cancelled, y pending_acceptance → cancelled + reembolso 100%). No son datos
-- suyos: son de todos. Verificado explotable en dev con una cuenta de tutor
-- normal antes de este cambio.
--
-- A partir de aquí solo la llama el job de pg_cron, que corre como superusuario
-- y no necesita el grant. `service_role` tampoco lo necesita para el cron, pero
-- se le concede explícitamente por si una Edge Function la dispara a mano
-- (p. ej. desde el panel admin, o una reconciliación manual).
-- ============================================================================

-- OJO con el gotcha de Postgres: `EXECUTE` sobre una función se concede a
-- **PUBLIC por defecto**. Revocar solo de `authenticated` NO cierra nada (se
-- comprobó: seguía ejecutándose). Hay que revocar de PUBLIC primero y luego
-- conceder a quien deba. El `grant ... to authenticated` de la migración
-- original era, de hecho, decorativo: ya era invocable por cualquiera.
revoke execute on function public.expire_stale_bookings(interval, interval) from public;
revoke execute on function public.expire_stale_bookings(interval, interval) from anon;
revoke execute on function public.expire_stale_bookings(interval, interval) from authenticated;

grant execute on function public.expire_stale_bookings(interval, interval) to service_role;
