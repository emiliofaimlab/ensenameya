-- ============================================================================
-- Enséñame Ya — EP-02 US-203 (SCR-TU02): KYC del tutor.
-- El tutor sube documentos a un bucket PRIVADO → `identity_verification_status`
-- pasa a 'pending' (RN-05, S-10/S-19). La revisión/aprobación del admin (cambiar
-- `status` del documento) llega en US-1101 (S3), vía service_role.
--
-- C-14 (set final de documentos) NO bloquea: los tipos son configuración en el
-- frontend; aquí solo vive el mecanismo (bucket + tabla + RLS + trigger).
-- Anti-escalada (US-1403): column-grants → el tutor sube/re-sube, nunca toca
-- `status`/`reviewed_*`.
-- ============================================================================

-- Enum de estado del documento (Doc 1 §1.3).
create type public.document_status as enum ('pending', 'approved', 'rejected');

-- Bucket PRIVADO con límite de tamaño y tipos permitidos (S-42).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyc-documents', 'kyc-documents', false,
  10485760,  -- 10 MB
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Documentos de verificación (Doc 1 §1.4.16). Un documento por (tutor, tipo).
create table public.verification_documents (
  id           uuid        primary key default gen_random_uuid(),
  tutor_id     uuid        not null references public.profiles (id) on delete cascade,
  doc_type     text        not null,                             -- id_front, id_back, selfie, …
  storage_path text        not null,                             -- ruta en el bucket privado (S-19)
  status       public.document_status not null default 'pending',
  reviewed_by  uuid        references public.profiles (id),
  reviewed_at  timestamptz,
  review_notes text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tutor_id, doc_type)                                    -- permite upsert por tipo
);

create index verification_documents_tutor_id_idx on public.verification_documents (tutor_id);
create index verification_documents_status_idx   on public.verification_documents (status);

create trigger verification_documents_set_updated_at
  before update on public.verification_documents
  for each row execute function public.set_updated_at();

-- Al subir el primer documento, marca la identidad como 'pending'. La columna
-- está protegida (fuera del column-grant del tutor): la mueve este trigger
-- controlado (SECURITY DEFINER), no el cliente.
create or replace function public.mark_identity_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tutor_profiles
     set identity_verification_status = 'pending'
   where profile_id = new.tutor_id
     and identity_verification_status = 'not_submitted';
  return new;
end;
$$;

create trigger verification_documents_mark_identity
  after insert on public.verification_documents
  for each row execute function public.mark_identity_pending();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.verification_documents enable row level security;

create policy "verification_documents_select_own"
  on public.verification_documents for select
  using ( (select auth.uid()) = tutor_id );
create policy "verification_documents_select_admin"
  on public.verification_documents for select
  using ( public.has_role('admin') );
create policy "verification_documents_insert_own"
  on public.verification_documents for insert
  with check ( (select auth.uid()) = tutor_id );
create policy "verification_documents_update_own"
  on public.verification_documents for update
  using ( (select auth.uid()) = tutor_id )
  with check ( (select auth.uid()) = tutor_id );

-- Column-grants: el tutor inserta/actualiza SOLO ruta y tipo; `status`/`reviewed_*`
-- quedan fuera (los mueve el admin en US-1101 vía service_role).
grant select on public.verification_documents to authenticated;
grant insert (tutor_id, doc_type, storage_path) on public.verification_documents to authenticated;
grant update (storage_path) on public.verification_documents to authenticated;

-- ── Storage: políticas equivalentes en el bucket privado (carpeta = uid) ──────
create policy "kyc_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "kyc_objects_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "kyc_objects_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "kyc_objects_select_admin"
  on storage.objects for select to authenticated
  using ( bucket_id = 'kyc-documents' and public.has_role('admin') );
