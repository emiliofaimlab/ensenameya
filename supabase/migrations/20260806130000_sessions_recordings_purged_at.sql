-- ============================================================================
-- Enséñame Ya — marca de purga de grabaciones (RN-42 / US-1802)
--
-- La política de privacidad publicada dice que las grabaciones dejan de estar
-- disponibles a los 30 días. Hasta hoy eso se cumplía solo "al servir": el
-- endpoint devolvía 410 pasada la fecha, pero el fichero seguía vivo en Daily
-- indefinidamente. El comentario de `src/app/api/recordings/[sessionId]/route.ts`
-- lo admitía, y el texto legal también, porque callarlo habría sido peor.
--
-- El job que lo borra de verdad (`/api/cron/recordings-purge`) necesita saber
-- qué sesiones ya trató. Sin esta columna tendría dos opciones malas: repasar
-- CADA sesión vencida en cada pasada —una llamada a Daily por sesión, cada día,
-- para siempre— o mirar solo una ventana de días recientes, que deja escapar en
-- silencio todo lo que caiga fuera si el job se para una temporada. Justo lo que
-- no quieres en el mecanismo que sostiene un compromiso de privacidad.
--
-- Con la marca el trabajo es proporcional a lo que vence, no al histórico, y
-- además queda constancia de CUÁNDO se borró, que es la prueba de que la
-- política se cumple.
--
-- Sin índice a propósito: `sessions` tendrá cientos de filas durante mucho
-- tiempo y el barrido diario es trivial. Si algún día pesa, el índice es
-- parcial sobre (end_at) where recordings_purged_at is null.
--
-- Sin política de RLS nueva: es una columna más de `sessions`, que ya tiene las
-- suyas y su `grant select ... to authenticated` a nivel de tabla. Quien la
-- escribe es el job, con service_role.
-- ============================================================================

alter table public.sessions
  add column if not exists recordings_purged_at timestamptz;

comment on column public.sessions.recordings_purged_at is
  'RN-42: cuándo se borraron en el proveedor las grabaciones de esta sesión. Null = pendiente o nunca hubo. Lo escribe /api/cron/recordings-purge con service_role.';
