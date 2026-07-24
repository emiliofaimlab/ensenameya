-- ============================================================================
-- Enséñame Ya — TU02: subida en borrador + envío en bloque a revisión.
--
--   · refresh_identity_status  — los 'draft' NO cuentan como enviados.
--   · submit_document(…, p_draft) — guarda como borrador o directo a 'pending'.
--   · submit_documents_for_review() — pasa todos los borradores a 'pending'.
--
-- Sin tablas ni RLS nuevas: se reusa el mecanismo de US-203. El admin sigue
-- sin poder tocar borradores (los filtra la pantalla) y el tutor sigue sin
-- poder mover `status` por PATCH (column-grants intactos): todo pasa por estas
-- RPC SECURITY DEFINER.
-- ============================================================================

-- ── La identidad ignora los borradores ───────────────────────────────────────
-- Sólo los documentos ENVIADOS (no 'draft') deciden el estado de identidad:
-- con puros borradores la identidad sigue 'not_submitted' y no llega al admin.
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
                    when count(*) filter (where vd.status <> 'draft') = 0            then 'not_submitted'
                    when count(*) filter (where vd.status = 'rejected') > 0          then 'rejected'
                    when count(*) filter (where vd.status = 'approved')
                         = count(*) filter (where vd.status <> 'draft')              then 'approved'
                    else 'pending'
                  end
             from public.verification_documents vd
            where vd.tutor_id = v_tutor
         )::public.identity_verification_status
   where tp.profile_id = v_tutor;
  return coalesce(new, old);
end;
$$;

-- ── Guardar un documento (borrador o envío) ──────────────────────────────────
-- Firma nueva: 4º argumento `p_draft`. Se dropea la de 3 args primero (Postgres
-- distingue funciones por lista de argumentos). Las llamadas por nombre desde
-- el cliente siguen resolviendo — `p_draft` tiene default.
drop function if exists public.submit_document(text, text, text);

create or replace function public.submit_document(
  p_doc_type     text,
  p_storage_path text default null,
  p_link_url     text default null,
  p_draft        boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status public.document_status := case when p_draft then 'draft' else 'pending' end;
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  if num_nonnulls(p_storage_path, p_link_url) <> 1 then
    raise exception 'indica exactamente uno: archivo o enlace'
      using errcode = 'check_violation';
  end if;

  -- La ruta vive en la carpeta del propio tutor (regla de la RLS de Storage).
  -- Se revalida aquí porque esto corre como SECURITY DEFINER.
  if p_storage_path is not null
     and p_storage_path is distinct from v_uid::text || '/' || p_doc_type then
    raise exception 'la ruta debe ser <uid>/<doc_type>' using errcode = 'check_violation';
  end if;

  insert into public.verification_documents as vd (tutor_id, doc_type, storage_path, link_url, status)
  values (v_uid, p_doc_type, p_storage_path, p_link_url, v_status)
  on conflict (tutor_id, doc_type) do update
     set storage_path = excluded.storage_path,
         link_url     = excluded.link_url,
         -- Re-guardar = repostular: se olvida el veredicto anterior. Queda en
         -- borrador o en revisión según `p_draft`.
         status       = v_status,
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

grant execute on function public.submit_document(text, text, text, boolean) to authenticated;

-- ── Enviar todos los borradores a revisión ───────────────────────────────────
-- El botón "Guardar y enviar a revisión" pasa a 'pending' lo que quede en
-- borrador (los archivos nuevos ya entran como 'pending'; esto barre los
-- borradores viejos de sesiones anteriores). El trigger recalcula la identidad.
create or replace function public.submit_documents_for_review()
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

  update public.verification_documents
     set status = 'pending'
   where tutor_id = v_uid
     and status = 'draft';

  return (
    select identity_verification_status::text
      from public.tutor_profiles
     where profile_id = v_uid
  );
end;
$$;

grant execute on function public.submit_documents_for_review() to authenticated;
