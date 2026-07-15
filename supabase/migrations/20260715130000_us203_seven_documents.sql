-- ============================================================================
-- Enséñame Ya — US-203 / UX-203 (EY-33 / EY-100): set final de 7 documentos.
-- Cierra C-14. El set pasa de 3 provisionales (id_front/id_back/selfie) a los 7
-- que confirmó el cliente:
--   id_document · degree · certificate · diploma · transcript · cv · social_media
--
-- `social_media` es un ENLACE, no un archivo. No se guarda en `storage_path`:
-- esa columna la consume `createSignedUrls()` en la pantalla admin (US-1101), y
-- meter una URL ahí rompería la firma. Entra por su propia columna `link_url`,
-- con un check de "exactamente uno de los dos".
--
-- `doc_type` sigue siendo texto (S-13): ampliar el set no toca el esquema, solo
-- esta migración cambia la forma (archivo vs enlace) y limpia lo obsoleto.
-- ============================================================================

-- ── Documento = archivo XOR enlace ───────────────────────────────────────────
alter table public.verification_documents
  add column link_url text;

alter table public.verification_documents
  alter column storage_path drop not null;

alter table public.verification_documents
  add constraint verification_documents_file_xor_link
    check (num_nonnulls(storage_path, link_url) = 1);

-- ── El agregado de identidad debe reaccionar también al DELETE ───────────────
-- Hace falta para la limpieza de abajo: si se borran los documentos obsoletos
-- de un tutor, su identidad tiene que recalcularse (a `not_submitted` si se
-- queda sin ninguno). En DELETE, `new` no está asignado → se usa `old`.
create or replace function public.refresh_identity_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor uuid := case when tg_op = 'DELETE' then old.tutor_id else new.tutor_id end;
begin
  update public.tutor_profiles tp
     set identity_verification_status = (
           select case
                    when count(*) = 0                                             then 'not_submitted'
                    when count(*) filter (where vd.status = 'rejected') > 0       then 'rejected'
                    when count(*) filter (where vd.status = 'approved') = count(*) then 'approved'
                    else 'pending'
                  end
             from public.verification_documents vd
            where vd.tutor_id = v_tutor
         )::public.identity_verification_status
   where tp.profile_id = v_tutor;
  return coalesce(new, old);
end;
$$;

drop trigger if exists verification_documents_refresh_identity on public.verification_documents;
create trigger verification_documents_refresh_identity
  after insert or update or delete on public.verification_documents
  for each row execute function public.refresh_identity_status();

-- ── Limpieza de los tipos obsoletos ──────────────────────────────────────────
-- Los 3 provisionales quedan fuera del set: el tutor ya no puede re-subirlos
-- (desaparecen del formulario), pero SÍ seguirían contando en el agregado de
-- identidad y la dejarían clavada. Se borran las filas (metadatos + veredicto);
-- los archivos en Storage NO se tocan. Consecuencia esperada de C-14: quien
-- había subido el set viejo vuelve a subir el nuevo.
-- En prod es un no-op (no hay tutores reales todavía); en dev limpia fixtures.
delete from public.verification_documents
 where doc_type not in (
   'id_document', 'degree', 'certificate', 'diploma', 'transcript', 'cv', 'social_media'
 );

-- ── submit_document: ahora acepta archivo o enlace ───────────────────────────
-- Se recrea con firma nueva (3 args). El default de los dos últimos permite
-- llamarla con solo uno de ellos.
drop function if exists public.submit_document(text, text);

create or replace function public.submit_document(
  p_doc_type     text,
  p_storage_path text default null,
  p_link_url     text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  if num_nonnulls(p_storage_path, p_link_url) <> 1 then
    raise exception 'indica exactamente uno: archivo o enlace'
      using errcode = 'check_violation';
  end if;

  -- Igual que antes: la ruta vive en la carpeta del propio tutor (regla de la
  -- RLS de Storage). Se revalida aquí porque esto corre como SECURITY DEFINER.
  if p_storage_path is not null
     and p_storage_path is distinct from v_uid::text || '/' || p_doc_type then
    raise exception 'la ruta debe ser <uid>/<doc_type>' using errcode = 'check_violation';
  end if;

  insert into public.verification_documents as vd (tutor_id, doc_type, storage_path, link_url)
  values (v_uid, p_doc_type, p_storage_path, p_link_url)
  on conflict (tutor_id, doc_type) do update
     set storage_path = excluded.storage_path,
         link_url     = excluded.link_url,
         -- Re-enviar = repostular: vuelve a revisión, se olvida el veredicto.
         status       = 'pending',
         reviewed_by  = null,
         reviewed_at  = null,
         review_notes = null
   where vd.tutor_id = v_uid;

  return (
    select identity_verification_status::text
      from public.tutor_profiles
     where profile_id = v_uid
  );
end;
$$;

grant execute on function public.submit_document(text, text, text) to authenticated;
