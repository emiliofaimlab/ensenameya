-- ============================================================================
-- Enséñame Ya — `sessions`: los grants que le faltaban a `service_role`
--
-- Descubierto probando el job de purga de grabaciones contra dev: devolvía
-- `permission denied for table sessions`. La causa es una confusión fácil y
-- cara — **`service_role` se salta la RLS, pero NO los grants de tabla**. Son
-- dos barreras distintas: `bypassrls` es un atributo del rol, los privilegios
-- son del objeto. Saltarse una no te da la otra.
--
-- En este proyecto se nota más que en otros porque los proyectos tienen
-- "auto-expose new tables" en OFF (ver CLAUDE.md), así que cada tabla declara
-- a mano a quién expone. `sessions` declaró `grant select ... to authenticated`
-- (20260709140000:183) y nada más, porque hasta hoy no había ni un solo camino
-- con service_role en la aplicación.
--
-- Mínimo privilegio, no `all`: el job lee sesiones vencidas y escribe UNA
-- columna. El `grant update` va acotado a esa columna, como el patrón de
-- column-grants que ya usa el proyecto (p. ej. `auto_accept_bookings` del tutor
-- en 20260724160000:19).
--
-- ⚠️ Para la próxima: cualquier trabajo nuevo con service_role sobre una tabla
-- que no sea esta se va a estrellar igual hasta que declare sus grants. Falla
-- en tiempo de ejecución, no en el build.
-- ============================================================================

grant select                             on public.sessions to service_role;
grant update (recordings_purged_at)      on public.sessions to service_role;
