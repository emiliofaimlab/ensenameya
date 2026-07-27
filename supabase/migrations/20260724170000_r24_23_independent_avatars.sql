-- ============================================================================
-- Enséñame Ya — R24-23 (reunión 24-jul, decisión 17): foto de alumno y de
-- tutor 100% independientes (sin herencia).
--
-- El backfill de DD-01 (`20260723120000`) sembró `tutor_profiles.avatar_path`
-- desde `profiles.avatar_path` (coalesce), así que la foto pública del tutor
-- quedó igual a la personal. Aquí se deshace esa herencia: los tutores cuya
-- foto de tutor es LA MISMA que la personal la pierden y muestran iniciales
-- hasta que suban una foto de tutor propia (que ya va a su propio fichero
-- `<uid>/tutor-avatar.*`, no pisa la personal). Las fotos que el tutor puso por
-- su cuenta (ruta distinta, p. ej. las demo) no se tocan.
--
-- Solo datos, sin cambio de esquema.
-- ============================================================================

update public.tutor_profiles tp
   set avatar_path = null
  from public.profiles p
 where p.id = tp.profile_id
   and tp.avatar_path is not null
   and tp.avatar_path = p.avatar_path;
