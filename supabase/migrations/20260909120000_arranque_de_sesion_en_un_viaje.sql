-- ─────────────────────────────────────────────────────────────────────────────
-- El arranque de sesión, en UN viaje
--
-- Toda pantalla con sesión pagaba tres consultas encadenadas antes de mirar un
-- solo dato suyo: `user_roles` y `profiles` (la guarda) y luego `notifications`
-- (la campana del layout, que necesita el id que devuelven las anteriores).
-- Medido contra dev el 9-sep-2026: entre 250 y 400 ms de peldaños, en las ~48
-- rutas del panel y en lo público con sesión.
--
-- Esta función devuelve las tres cosas de una vez. No es una vista materializada
-- ni una caché: lee lo mismo, en el mismo instante, con las MISMAS políticas.
--
-- ⚠️ `security invoker` A PROPÓSITO (es el default, se escribe para que se lea).
-- La RLS de las tres tablas sigue delante, así que esta función no puede
-- enseñar nada que el usuario no pudiera leer ya por su cuenta. Convertirla en
-- `security definer` la haría más rápida y abriría un agujero: `notifications`
-- tiene una política de admin que abre la tabla entera (ver la cabecera de
-- `lib/notifications-server.ts`), y el filtro por `recipient_id` de aquí abajo
-- es lo único que impide que la campana de un administrador pinte los avisos de
-- cualquier alumno. Ese filtro NO sobra.
--
-- ⚠️ El `limit` es el mismo `NOTICES_LIMIT = 8` de `lib/notifications.ts`. Si
-- allí cambia, cambia aquí: son la misma campana.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.session_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'roles', coalesce(
      (select jsonb_agg(ur.role) from public.user_roles ur
        where ur.user_id = (select auth.uid())),
      '[]'::jsonb),
    'profile', (
      select to_jsonb(p) from (
        select onboarding_complete, full_name, avatar_path, timezone
          from public.profiles where id = (select auth.uid())
      ) p),
    'notices', coalesce(
      (select jsonb_agg(n order by n.created_at desc) from (
        select id, type, template, payload, created_at, read_at
          from public.notifications
          where recipient_id = (select auth.uid())
          order by created_at desc
          limit 8
      ) n),
      '[]'::jsonb)
  );
$$;

comment on function public.session_bootstrap() is
  'Roles + perfil + avisos del usuario en sesión, en una sola llamada. '
  'security invoker: la RLS de las tres tablas sigue mandando.';

-- Regla de oro 9: los grants no se heredan de nada. Sin esto, `permission
-- denied` en tiempo de ejecución y no en el build.
grant execute on function public.session_bootstrap() to authenticated;
