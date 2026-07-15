-- ============================================================================
-- Enséñame Ya — US-1101 (S3): el admin aprueba/rechaza tutores y su KYC.
-- SCR-AD03/AD05, M1/M2, RN-29 (aprobar exige identidad aprobada), NTF-03 (stub).
--
-- Toda la escritura es server-side (SECURITY DEFINER): `approval_status`,
-- `identity_verification_status` y `user_roles` están FUERA de los column-grants
-- del cliente (US-1403), y `user_roles` no tiene políticas de escritura a
-- propósito (init.sql). El admin tampoco escribe por PATCH: pasa por estas RPC,
-- que verifican `has_role('admin')` dentro.
--
-- El rol `tutor` se otorga AQUÍ, al aprobar — es lo que US-202/US-402 dejaron
-- pendiente ("el rol tutor se otorga al aprobar, US-1101").
--
-- C-14 no bloquea: `doc_type` es texto y la revisión es genérica sobre los
-- documentos que existan (hoy 3; 7 cuando aterrice UX-203/EY-100).
-- Las políticas de lectura del admin ya existen (tutor_profiles_select_admin,
-- verification_documents_select_admin, profiles_select_admin) — no se tocan.
-- ============================================================================

-- Motivo del rechazo (AC US-1101). El tutor lo lee en su propio perfil vía
-- `tutor_profiles_select_own`; queda fuera del column-grant → no puede editarlo.
alter table public.tutor_profiles
  add column approval_notes text;

-- ── Revisión de UN documento (SCR-AD05) ──────────────────────────────────────
-- Devuelve el estado de identidad resultante, que es el AGREGADO de los
-- documentos del tutor: no se marca a mano.
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
  v_tutor    uuid;
  v_identity public.identity_verification_status;
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

  -- Identidad = agregado de sus documentos: uno rechazado la rechaza; todos
  -- aprobados la aprueban; cualquier otro caso sigue pendiente.
  -- ponytail: el agregado se recalcula entero en cada revisión (son ≤7 filas).
  select case
           when count(*) filter (where status = 'rejected') > 0            then 'rejected'
           when count(*) filter (where status = 'approved') = count(*)     then 'approved'
           else 'pending'
         end
    into v_identity
    from public.verification_documents
   where tutor_id = v_tutor;

  update public.tutor_profiles
     set identity_verification_status = v_identity
   where profile_id = v_tutor;

  return v_identity::text;
end;
$$;

-- ── Aprobación / rechazo del tutor (SCR-AD03, M1) ────────────────────────────
create or replace function public.review_tutor(
  p_tutor_id uuid,
  p_approve  boolean,
  p_reason   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity public.identity_verification_status;
  v_new      public.tutor_approval_status;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin aprueba tutores'
      using errcode = 'insufficient_privilege';
  end if;

  select identity_verification_status into v_identity
    from public.tutor_profiles
   where profile_id = p_tutor_id;

  if v_identity is null then
    raise exception 'perfil de tutor no encontrado' using errcode = 'check_violation';
  end if;

  if p_approve then
    -- RN-29: no se aprueba a un tutor cuya identidad no está aprobada.
    if v_identity <> 'approved' then
      raise exception 'RN-29: la identidad debe estar aprobada (está: %)', v_identity
        using errcode = 'check_violation';
    end if;

    update public.tutor_profiles
       set approval_status = 'approved',
           approved_at     = now(),
           approval_notes  = null
     where profile_id = p_tutor_id
     returning approval_status into v_new;

    -- El rol `tutor` se otorga al aprobar (S-15: la escritura de roles nunca es
    -- del cliente). Idempotente: re-aprobar no duplica (PK user_id+role).
    insert into public.user_roles (user_id, role)
    values (p_tutor_id, 'tutor')
    on conflict do nothing;
  else
    update public.tutor_profiles
       set approval_status = 'rejected',
           approval_notes  = p_reason,
           approved_at     = null
     where profile_id = p_tutor_id
     returning approval_status into v_new;

    -- Rechazar/suspender a un tutor ya aprobado le retira el rol: sus productos
    -- dejan de ser publicables (RN-23) y salen del catálogo público (RN-24).
    delete from public.user_roles
     where user_id = p_tutor_id and role = 'tutor';
  end if;

  -- NTF-03 (stub, EP-12): avisar al tutor del resultado del review.
  return v_new::text;
end;
$$;

grant execute on function public.review_document(uuid, boolean, text) to authenticated;
grant execute on function public.review_tutor(uuid, boolean, text)    to authenticated;
