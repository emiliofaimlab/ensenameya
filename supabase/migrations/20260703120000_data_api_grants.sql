-- ============================================================================
-- Enséñame Ya — Grants de la Data API (PostgREST).
-- El proyecto tiene "auto-expose new tables" DESACTIVADO, así que los privilegios
-- de tabla para los roles de la API se declaran aquí, versionados y uniformes en
-- todos los ambientes (dev/prod). RLS sigue siendo la barrera default-deny
-- (Doc 3 / regla de oro 1): estos grants solo permiten que el rol *llegue* a la
-- tabla; las políticas deciden qué filas ve.
--
-- Convención para migraciones futuras: toda tabla expuesta al cliente declara sus
-- grants junto a sus políticas RLS. Tablas públicas (catálogo) añaden `anon`.
-- La escritura financiera / de roles NO se concede al cliente (service_role).
-- ============================================================================

-- profiles: el dueño (authenticated) lee y edita su fila; el admin lee (RLS).
-- INSERT lo hace el trigger handle_new_user (SECURITY DEFINER), no el cliente.
grant select, update on public.profiles to authenticated;

-- user_roles: el usuario lee sus roles; el admin lee todos (RLS).
-- La escritura de roles queda fuera del cliente (service_role / función controlada).
grant select on public.user_roles to authenticated;
