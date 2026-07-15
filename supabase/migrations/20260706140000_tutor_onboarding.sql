-- ============================================================================
-- Enséñame Ya — EP-02 US-202: onboarding del tutor.
-- El tutor crea/edita su perfil de vitrina; queda `approval_status='pending'`
-- hasta que un admin lo apruebe (US-1101). El rol `tutor` se otorga AL aprobar,
-- no aquí (S-15: la escritura de roles no es del cliente).
--
-- US-1403 (anti-escalada): la escritura del cliente se acota con GRANTS A NIVEL
-- DE COLUMNA — el tutor solo toca campos de vitrina; `approval_status`,
-- `identity_verification_status`, `tier_id`, `rating_*`, `approved_*` quedan FUERA
-- (los mueve el admin / service_role). RLS limita a la fila propia.
-- ============================================================================

-- Redes sociales (jsonb flexible: {instagram, linkedin, youtube, website}).
alter table public.tutor_profiles
  add column socials jsonb not null default '{}';

-- Column-level grants: el `authenticated` solo puede escribir estas columnas.
-- (El SELECT sigue siendo a nivel de tabla, de la migración de catálogo.)
grant insert (profile_id, headline, bio, socials) on public.tutor_profiles to authenticated;
grant update (headline, bio, socials)             on public.tutor_profiles to authenticated;

-- Fila propia: crear y editar SU perfil de tutor (nace 'pending' por default).
create policy "tutor_profiles_insert_own"
  on public.tutor_profiles for insert
  with check ( (select auth.uid()) = profile_id );

create policy "tutor_profiles_update_own"
  on public.tutor_profiles for update
  using ( (select auth.uid()) = profile_id )
  with check ( (select auth.uid()) = profile_id );
