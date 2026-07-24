-- ============================================================================
-- Enséñame Ya — SEED DEMO de imágenes para P01 (DD-01 / DD-02). ⚠️ SOLO DEV.
--
-- Fuera de supabase/migrations/ a propósito, como el resto de `supabase/seed/`:
-- el CI solo despliega migraciones, así que esto nunca llega a prod.
--
-- Los tutores demo de `ep03-demo.sql` no pueden iniciar sesión
-- (encrypted_password null), así que sus imágenes no se pueden subir desde el
-- cliente con su propia sesión. Los ficheros ya están en los buckets públicos,
-- subidos con la cuenta `tutor.us401@ensenameya.dev` (por eso las rutas cuelgan
-- de su uid: la RLS de Storage exige que el primer segmento sea el del que
-- sube). Aquí solo se apuntan las columnas a esas rutas.
--
-- Aplicar SOLO a dev, pegándolo en el SQL Editor de Supabase. SQL plano, sin
-- meta-comandos de psql (`\set` no funciona en el editor): la carpeta
-- 'ed5c4ff6-…' (uid de tutor.us401) va literal en cada ruta.
-- ============================================================================

-- ── Foto pública de los tutores demo (DD-01) ─────────────────────────────────
update public.tutor_profiles
   set avatar_path = 'ed5c4ff6-77f7-4aa8-b235-f06b6c3a3618/demo-ana.png'
 where profile_id = 'a0000000-0000-4000-8000-000000000001';

update public.tutor_profiles
   set avatar_path = 'ed5c4ff6-77f7-4aa8-b235-f06b6c3a3618/demo-diego.png'
 where profile_id = 'a0000000-0000-4000-8000-000000000002';

update public.tutor_profiles
   set avatar_path = 'ed5c4ff6-77f7-4aa8-b235-f06b6c3a3618/demo-lucia.png'
 where profile_id = 'a0000000-0000-4000-8000-000000000003';

-- ── Miniatura de los productos demo (DD-02) ──────────────────────────────────
update public.products
   set image_path = 'ed5c4ff6-77f7-4aa8-b235-f06b6c3a3618/demo-calculo.jpg'
 where id = 'b0000000-0000-4000-8000-000000000001';

update public.products
   set image_path = 'ed5c4ff6-77f7-4aa8-b235-f06b6c3a3618/demo-marketing.jpg'
 where id = 'b0000000-0000-4000-8000-000000000002';

update public.products
   set image_path = 'ed5c4ff6-77f7-4aa8-b235-f06b6c3a3618/demo-ingles.jpg'
 where id = 'b0000000-0000-4000-8000-000000000003';
