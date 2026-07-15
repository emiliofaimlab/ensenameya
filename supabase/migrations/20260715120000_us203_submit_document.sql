-- ============================================================================
-- Enséñame Ya — US-203 (EY-33): arreglar la subida de documentos KYC.
--
-- BUG: `verification-form.tsx` hacía `.upsert()`, que PostgREST traduce a
-- `INSERT ... ON CONFLICT DO UPDATE SET tutor_id=…, doc_type=…, storage_path=…`.
-- Postgres exige privilegio UPDATE sobre TODAS las columnas del SET al
-- planificar — aunque no haya conflicto — y las column-grants de
-- `20260706150000_kyc.sql` solo conceden `update (storage_path)` (a propósito:
-- US-1403, que el tutor no reasigne un documento a otro `tutor_id`).
-- Resultado: fallaba SIEMPRE con 42501, incluso en la primera subida.
--
-- Arreglo: RPC controlada (el patrón del proyecto). NO se amplían las grants
-- del cliente — eso abriría justo la escalada que la migración evitaba.
--
-- De paso cierra "repostular sin límite de intentos" (UX-203): re-subir un
-- documento lo devuelve a `pending` y limpia la revisión anterior. El tutor no
-- puede hacer eso por PATCH porque `status`/`reviewed_*` están (bien) fuera de
-- sus grants.
-- ============================================================================

-- ── La identidad es una columna DERIVADA de los documentos ───────────────────
-- Antes se recalculaba a mano en `review_document` (US-1101) y el trigger
-- `mark_identity_pending` solo cubría not_submitted→pending al primer insert.
-- Con `submit_document` habría un tercer sitio que recuerda hacerlo. Se
-- centraliza en un trigger: una sola fuente, imposible olvidarla.
create or replace function public.refresh_identity_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tutor_profiles tp
     set identity_verification_status = (
           select case
                    when count(*) = 0                                        then 'not_submitted'
                    when count(*) filter (where vd.status = 'rejected') > 0  then 'rejected'
                    when count(*) filter (where vd.status = 'approved') = count(*) then 'approved'
                    else 'pending'
                  end
             from public.verification_documents vd
            where vd.tutor_id = new.tutor_id
         )::public.identity_verification_status
   where tp.profile_id = new.tutor_id;
  return new;
end;
$$;

drop trigger  if exists verification_documents_mark_identity on public.verification_documents;
drop function if exists public.mark_identity_pending();

create trigger verification_documents_refresh_identity
  after insert or update on public.verification_documents
  for each row execute function public.refresh_identity_status();

-- ── Subir / re-subir un documento ────────────────────────────────────────────
create or replace function public.submit_document(
  p_doc_type     text,
  p_storage_path text
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

  -- La ruta vive siempre en la carpeta del propio tutor — la misma regla que
  -- la RLS de Storage (carpeta = uid). Se valida aquí también porque esta
  -- función corre como SECURITY DEFINER: sin este check, un tutor podría
  -- registrar una fila apuntando al archivo de otro.
  if p_storage_path is distinct from v_uid::text || '/' || p_doc_type then
    raise exception 'la ruta debe ser <uid>/<doc_type>' using errcode = 'check_violation';
  end if;

  insert into public.verification_documents as vd (tutor_id, doc_type, storage_path)
  values (v_uid, p_doc_type, p_storage_path)
  on conflict (tutor_id, doc_type) do update
     set storage_path = excluded.storage_path,
         -- Re-subir = repostular: vuelve a revisión y se olvida el veredicto
         -- anterior (UX-203: sin límite de intentos).
         status       = 'pending',
         reviewed_by  = null,
         reviewed_at  = null,
         review_notes = null
   where vd.tutor_id = v_uid;  -- defensa en profundidad; el conflicto ya es suyo

  -- El trigger ya recalculó la identidad: se devuelve para que la UI la muestre.
  return (
    select identity_verification_status::text
      from public.tutor_profiles
     where profile_id = v_uid
  );
end;
$$;

grant execute on function public.submit_document(text, text) to authenticated;

-- ── US-1101: `review_document` deja de recalcular a mano ─────────────────────
-- El trigger es ahora la única fuente. La RPC solo escribe el veredicto y lee
-- el resultado.
create or replace function public.review_document(
  p_doc_id  uuid,
  p_approve boolean,
  p_notes   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor uuid;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin revisa documentos'
      using errcode = 'insufficient_privilege';
  end if;

  update public.verification_documents
     set status       = case when p_approve then 'approved' else 'rejected' end::public.document_status,
         reviewed_by  = (select auth.uid()),
         reviewed_at  = now(),
         review_notes = p_notes
   where id = p_doc_id
   returning tutor_id into v_tutor;

  if v_tutor is null then
    raise exception 'documento no encontrado' using errcode = 'check_violation';
  end if;

  return (
    select identity_verification_status::text
      from public.tutor_profiles
     where profile_id = v_tutor
  );
end;
$$;
