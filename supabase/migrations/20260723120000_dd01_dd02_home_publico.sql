-- ============================================================================
-- P01 — lo que el home del Figma necesita del modelo. Refs: EY-110 (DD-01,
-- DD-02), EY-103 (IV-01), Doc 1 (modelo), Doc 3 (RLS).
--
-- La pasada nodo a nodo de P01 contra el home dejó tres huecos de datos:
--
--   · DD-01 · nombre y foto del tutor en la tarjeta  → tutor_profiles.display_name / avatar_path
--   · DD-02 · imagen del producto en la tarjeta      → products.image_path + bucket
--   · cifras y testimonios de la home                → home_stats() / home_testimonials()
--
-- Nombre y foto NO se leen de `profiles`: esa tabla es privada y abrirla a anon
-- filtraría a todo el mundo (RISK-13). Se copian a `tutor_profiles`, que ya es
-- pública **solo para tutores aprobados** (`tutor_profiles_select_public`), y
-- son campos que el tutor elige publicar — que es justo lo que preguntaba
-- DD-01: el nombre visible puede no ser el nombre legal.
-- ============================================================================

-- ── DD-01 · nombre visible y foto pública del tutor ──────────────────────────
alter table public.tutor_profiles
  add column if not exists display_name text,
  add column if not exists avatar_path  text;   -- ruta en el bucket `avatars`

-- Grants por columna (patrón desde US-201): el tutor edita lo suyo, y su
-- política de update ya limita la fila.
grant insert (display_name, avatar_path) on public.tutor_profiles to authenticated;
grant update (display_name, avatar_path) on public.tutor_profiles to authenticated;

-- Semilla con lo que el tutor ya había cargado en su perfil privado, para que
-- las tarjetas no salgan vacías con los tutores que ya existen.
update public.tutor_profiles tp
   set display_name = coalesce(tp.display_name, p.full_name),
       avatar_path  = coalesce(tp.avatar_path,  p.avatar_path)
  from public.profiles p
 where p.id = tp.profile_id
   and (tp.display_name is null or tp.avatar_path is null);

-- ── DD-02 · imagen del producto ──────────────────────────────────────────────
alter table public.products
  add column if not exists image_path text;      -- ruta en el bucket `product-images`

grant insert (image_path) on public.products to authenticated;
grant update (image_path) on public.products to authenticated;

-- Bucket público: la miniatura se ve en el catálogo sin sesión, igual que
-- `avatars`. Escritura acotada a la carpeta del propio tutor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true,
  5242880,  -- 5 MB, el mismo tope que los avatares
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "product_images_insert_own" on storage.objects;
create policy "product_images_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "product_images_update_own" on storage.objects;
create policy "product_images_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "product_images_delete_own" on storage.objects;
create policy "product_images_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Lectura explícita: el flag `public` no sustituye a la política (default-deny).
drop policy if exists "product_images_select_public" on storage.objects;
create policy "product_images_select_public"
  on storage.objects for select to anon, authenticated
  using ( bucket_id = 'product-images' );

-- ── Cifras de la home ────────────────────────────────────────────────────────
-- El Figma pinta "+1.200 tutores · 25k+ clases · 4.9★ · 30+ países". Las tres
-- primeras salen del modelo; "países" no existe como dato, así que se sustituye
-- por las categorías activas en lugar de inventarse un número (regla de oro 8).
-- Agregación en vivo, como `admin_stats`: para el volumen del MVP sobra.
create or replace function public.home_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tutors',     (select count(*) from public.tutor_profiles where approval_status = 'approved'),
    'sessions',   (select count(*) from public.bookings        where status = 'completed'),
    'rating_avg', (select round(avg(rating), 1) from public.reviews),
    'categories', (select count(*) from public.categories      where is_active)
  );
$$;

grant execute on function public.home_stats() to anon, authenticated;

-- ── Testimonios de la home ───────────────────────────────────────────────────
-- Las reseñas ya son públicas (EP-09), pero el nombre del alumno vive en
-- `profiles`, que no lo es. La función devuelve el nombre **enmascarado**
-- (nombre + inicial, "Marina G.", como el Figma) sin abrir la tabla: el
-- SECURITY DEFINER lee, pero solo sale de aquí lo que se publica.
create or replace function public.home_testimonials(p_limit integer default 7)
returns table (
  id      uuid,
  comment text,
  rating  smallint,
  author  text,
  context text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.comment,
         r.rating,
         coalesce(
           nullif(
             split_part(p.full_name, ' ', 1) ||
             case
               when split_part(p.full_name, ' ', 2) <> ''
                 then ' ' || left(split_part(p.full_name, ' ', 2), 1) || '.'
               else ''
             end,
             ''),
           'Alumno') as author,
         pr.title     as context
    from public.reviews r
    join public.profiles p  on p.id  = r.student_id
    join public.products pr on pr.id = r.product_id
   where r.comment is not null
     and length(btrim(r.comment)) > 0
     and r.rating >= 4                    -- testimonios, no reseñas a secas
   order by r.created_at desc
   limit greatest(1, least(p_limit, 20));
$$;

grant execute on function public.home_testimonials(integer) to anon, authenticated;
