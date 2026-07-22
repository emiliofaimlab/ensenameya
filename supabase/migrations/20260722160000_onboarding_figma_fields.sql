-- ============================================================================
-- IV-02 — Campos que pide el onboarding del Figma (AL01 ×3, TU01 ×5).
-- Doc 1 (modelo), Doc 3 (RLS). Refs: EY-104, EY-99, EY-101, EY-111.
--
-- El asistente del Figma pide datos que el modelo no tenía. Se añaden aquí para
-- poder construirlo completo:
--
--   · foto de perfil            → profiles.avatar_path       (AL01 p1, TU01 p1)
--   · categorías que enseña     → tutor_categories           (TU01 p2)
--   · nivel principal           → tutor_profiles.teaching_level (TU01 p2)
--   · materiales de clase       → tutor_materials + bucket   (TU01 p4)
--   · intereses del alumno      → student_interests          (AL01 p2)
--
-- Ojo con la foto: DD-01 (EY-111) sigue abierta porque publicar el NOMBRE real
-- del tutor es otra decisión. Aquí solo se añade el avatar y se expone en el
-- mismo alcance que ya tiene `tutor_profiles` (tutores aprobados), sin abrir
-- `profiles` a terceros.
-- ============================================================================

-- ── Foto de perfil ───────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists avatar_path text;   -- ruta en el bucket `avatars`

-- El dueño ya podía actualizar su fila (profiles_update_own); falta la columna
-- en el grant, que es por columna desde US-201.
grant update (avatar_path) on public.profiles to authenticated;

-- Bucket PÚBLICO: la foto se ve en el catálogo, junto al resto del perfil
-- público del tutor. Escritura solo en la carpeta propia (mismo patrón que KYC).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true,
  5242880,  -- 5 MB, como dice el Figma
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Lectura: el bucket es público, pero la política explícita evita depender solo
-- del flag (default-deny sigue siendo la regla del proyecto).
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
  on storage.objects for select to anon, authenticated
  using ( bucket_id = 'avatars' );

-- ── Nivel principal que enseña el tutor (TU01 paso 2) ────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'teaching_level') then
    create type public.teaching_level as enum ('basico', 'intermedio', 'avanzado');
  end if;
end $$;

alter table public.tutor_profiles
  add column if not exists teaching_level public.teaching_level;

grant update (teaching_level) on public.tutor_profiles to authenticated;
grant insert (teaching_level) on public.tutor_profiles to authenticated;

-- ── Categorías que enseña el tutor (TU01 paso 2) ─────────────────────────────
-- Hasta ahora la categoría colgaba del PRODUCTO. El onboarding las pide antes
-- de que exista ningún producto, así que el tutor las declara en su perfil.
create table if not exists public.tutor_categories (
  tutor_id    uuid not null references public.profiles (id)   on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (tutor_id, category_id)
);

alter table public.tutor_categories enable row level security;

-- Público: se ven las de tutores aprobados (mismo criterio que RN-24).
drop policy if exists "tutor_categories_select_public" on public.tutor_categories;
create policy "tutor_categories_select_public"
  on public.tutor_categories for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.profile_id = tutor_categories.tutor_id
        and tp.approval_status = 'approved'
    )
  );

drop policy if exists "tutor_categories_select_own" on public.tutor_categories;
create policy "tutor_categories_select_own"
  on public.tutor_categories for select
  using ( (select auth.uid()) = tutor_id );

drop policy if exists "tutor_categories_select_admin" on public.tutor_categories;
create policy "tutor_categories_select_admin"
  on public.tutor_categories for select
  using ( public.has_role('admin') );

drop policy if exists "tutor_categories_write_own" on public.tutor_categories;
create policy "tutor_categories_write_own"
  on public.tutor_categories for insert
  with check ( (select auth.uid()) = tutor_id );

drop policy if exists "tutor_categories_delete_own" on public.tutor_categories;
create policy "tutor_categories_delete_own"
  on public.tutor_categories for delete
  using ( (select auth.uid()) = tutor_id );

grant select on public.tutor_categories to anon, authenticated;
grant insert, delete on public.tutor_categories to authenticated;

-- ── Intereses del alumno (AL01 paso 2) ───────────────────────────────────────
-- Privados: son para recomendar, no para publicar. Solo el dueño y el admin.
create table if not exists public.student_interests (
  student_id  uuid not null references public.profiles (id)   on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (student_id, category_id)
);

alter table public.student_interests enable row level security;

drop policy if exists "student_interests_select_own" on public.student_interests;
create policy "student_interests_select_own"
  on public.student_interests for select
  using ( (select auth.uid()) = student_id );

drop policy if exists "student_interests_select_admin" on public.student_interests;
create policy "student_interests_select_admin"
  on public.student_interests for select
  using ( public.has_role('admin') );

drop policy if exists "student_interests_write_own" on public.student_interests;
create policy "student_interests_write_own"
  on public.student_interests for insert
  with check ( (select auth.uid()) = student_id );

drop policy if exists "student_interests_delete_own" on public.student_interests;
create policy "student_interests_delete_own"
  on public.student_interests for delete
  using ( (select auth.uid()) = student_id );

grant select, insert, delete on public.student_interests to authenticated;

-- ── Materiales de clase del tutor (TU01 paso 4) ──────────────────────────────
-- NO son los documentos de KYC (`verification_documents`, bucket privado): esto
-- son los archivos didácticos que el tutor usa en sus sesiones.
create table if not exists public.tutor_materials (
  id           uuid        primary key default gen_random_uuid(),
  tutor_id     uuid        not null references public.profiles (id) on delete cascade,
  storage_path text        not null,
  file_name    text        not null,
  size_bytes   bigint      not null check (size_bytes > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tutor_materials_tutor_id_idx
  on public.tutor_materials (tutor_id);

drop trigger if exists tutor_materials_set_updated_at on public.tutor_materials;
create trigger tutor_materials_set_updated_at
  before update on public.tutor_materials
  for each row execute function public.set_updated_at();

alter table public.tutor_materials enable row level security;

-- Privados: material propio del tutor. No se publican en el catálogo.
drop policy if exists "tutor_materials_select_own" on public.tutor_materials;
create policy "tutor_materials_select_own"
  on public.tutor_materials for select
  using ( (select auth.uid()) = tutor_id );

drop policy if exists "tutor_materials_select_admin" on public.tutor_materials;
create policy "tutor_materials_select_admin"
  on public.tutor_materials for select
  using ( public.has_role('admin') );

drop policy if exists "tutor_materials_write_own" on public.tutor_materials;
create policy "tutor_materials_write_own"
  on public.tutor_materials for insert
  with check ( (select auth.uid()) = tutor_id );

drop policy if exists "tutor_materials_delete_own" on public.tutor_materials;
create policy "tutor_materials_delete_own"
  on public.tutor_materials for delete
  using ( (select auth.uid()) = tutor_id );

grant select, delete on public.tutor_materials to authenticated;
grant insert (tutor_id, storage_path, file_name, size_bytes)
  on public.tutor_materials to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tutor-materials', 'tutor-materials', false,
  10485760,  -- 10 MB por archivo, como dice el Figma
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

drop policy if exists "materials_insert_own" on storage.objects;
create policy "materials_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tutor-materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "materials_select_own" on storage.objects;
create policy "materials_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tutor-materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "materials_delete_own" on storage.objects;
create policy "materials_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tutor-materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "materials_select_admin" on storage.objects;
create policy "materials_select_admin"
  on storage.objects for select to authenticated
  using ( bucket_id = 'tutor-materials' and public.has_role('admin') );
