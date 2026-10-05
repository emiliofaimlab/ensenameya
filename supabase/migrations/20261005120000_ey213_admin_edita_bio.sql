-- ============================================================================
-- Enséñame Ya — EY-213: el admin edita la biografía de un tutor ya publicado
-- (portal de soporte, Néstor, 5-oct)
--
-- Hasta hoy `tutor_profiles` solo tenía `tutor_profiles_update_own`: nadie más
-- que el dueño podía tocar su fila. Se añade la política hermana para admin.
--
-- No hace falta `grant`: `bio` ya lo tiene `authenticated` desde
-- `20260706140000`, y la escritura sigue acotada columna a columna, así que el
-- admin NO gana `approval_status`, `tier_id` ni `rating_*` por esta vía (esos
-- siguen yendo por sus RPC). Lo que sí gana son las demás columnas con grant
-- (headline, socials, faqs…): es el mismo conjunto que edita el propio tutor.
-- ============================================================================

create policy "tutor_profiles_update_admin"
  on public.tutor_profiles for update
  using ( public.has_role('admin') )
  with check ( public.has_role('admin') );

comment on policy "tutor_profiles_update_admin" on public.tutor_profiles is
  'EY-213: el admin corrige la ficha pública de un tutor (bio). Las columnas las limita el grant de columna, no esta política.';
