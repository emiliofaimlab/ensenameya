-- ============================================================================
-- Enséñame Ya — Bootstrap del PRIMER admin. **Fuera de `migrations/`** a
-- propósito: no es esquema, son datos, y el email cambia por ambiente.
--
-- Por qué existe: `user_roles` es default-deny y no tiene grants de escritura
-- para el cliente (init.sql, S-15). El rol `tutor` lo otorga `review_tutor()`
-- (US-1101), pero esa RPC exige `has_role('admin')` → sin un admin sembrado a
-- mano, nadie puede aprobar a nadie. Huevo y gallina: se rompe aquí, una vez
-- por ambiente.
--
-- Cómo aplicarlo: Supabase Studio → SQL Editor → pegar y ejecutar
-- (el mismo camino de `supabase/seed/ep03-demo.sql`).
--
-- Idempotente: re-ejecutarlo no duplica (PK user_id+role) y no pisa nada.
-- ============================================================================

-- 1) El usuario debe existir ya en Auth (regístralo por la app o por el panel).
--    Cambia el email antes de ejecutar en otro ambiente.
insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
  from auth.users u
 where u.email = 'admin.us1101@ensenameya.dev'
on conflict do nothing;

-- 2) Comprobación: debe devolver una fila con role = 'admin'.
select u.email, ur.role, ur.created_at
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
 where ur.role = 'admin';
