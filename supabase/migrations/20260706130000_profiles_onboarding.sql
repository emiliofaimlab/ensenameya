-- ============================================================================
-- Enséñame Ya — EP-02 US-201: onboarding ampliado (RN-44).
-- Añade a `profiles` el teléfono E.164 (obligatorio en el onboarding, validado
-- en cliente + CHECK aquí) y el flag `onboarding_complete`.
-- El dueño ya puede editar su fila (RLS profiles_update_own + grant update), así
-- que no hacen falta políticas ni grants nuevos: el trigger set_updated_at sigue.
-- ============================================================================

alter table public.profiles
  add column phone text
    check (phone is null or phone ~ '^\+[1-9]\d{6,14}$'),   -- E.164 (RN-44)
  add column onboarding_complete boolean not null default false;
