-- ============================================================================
-- Enséñame Ya — lo que el admin hace con las clases grupales (G4, §11.4)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
--   1. `admin_habilitar_grupales` · el interruptor de RG-18. La columna
--      `tutor_profiles.group_classes_enabled` no tiene grant de columna a
--      propósito (`20261008120100`): con él, el tutor se encendería las
--      grupales solo. Solo el admin, por aquí.
--   2. `admin_sacar_de_clase_grupal` · el admin saca a UN alumno de una clase
--      con el 100 % (RN-37, «si cancela el tutor»). `cancel_booking` exige ser
--      el alumno o el tutor de la reserva y decide el porcentaje por quién
--      llama, así que se le llama como el TUTOR —el mismo cambio de claims que
--      ya hace `cancelar_clase_grupal` (`20261008180000:77`)— y se restauran.
--      El alumno recibe NTF-55 con el motivo (notify_booking, `20261014150000`).
--
-- Cancelar la clase entera ya lo admite `cancelar_clase_grupal` para el admin.
-- ============================================================================

create or replace function public.admin_habilitar_grupales(p_tutor uuid, p_activo boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo puede habilitar clases grupales' using errcode = '42501';
  end if;
  update public.tutor_profiles set group_classes_enabled = coalesce(p_activo, false)
   where profile_id = p_tutor;
  if not found then
    raise exception 'tutor no encontrado' using errcode = 'no_data_found';
  end if;
  return coalesce(p_activo, false);
end;
$$;

comment on function public.admin_habilitar_grupales(uuid, boolean) is
  'RG-18 · el admin enciende o apaga las clases grupales de un tutor. Es la única vía: group_classes_enabled no tiene grant de columna.';

revoke execute on function public.admin_habilitar_grupales(uuid, boolean) from public, anon;
grant  execute on function public.admin_habilitar_grupales(uuid, boolean) to authenticated;


create or replace function public.admin_sacar_de_clase_grupal(p_booking uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bk     record;
  v_claims text;
  v_sub    text;
  v_res    jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo puede sacar a un alumno de una clase' using errcode = '42501';
  end if;

  select b.id, b.tutor_id, b.pricing_model into v_bk
    from public.bookings b where b.id = p_booking for update;
  if v_bk.id is null or v_bk.pricing_model <> 'group' then
    raise exception 'esta reserva no es de una clase grupal' using errcode = 'check_violation';
  end if;

  v_claims := current_setting('request.jwt.claims', true);
  v_sub    := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_bk.tutor_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_bk.tutor_id::text, true);

  v_res := public.cancel_booking(
    p_booking,
    coalesce(nullif(trim(p_motivo), ''), 'El equipo de Enséñame Ya canceló tu cupo'));

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_res;
end;
$$;

comment on function public.admin_sacar_de_clase_grupal(uuid, text) is
  'G4 · el admin cancela el cupo de UN alumno en una clase grupal con el 100 % (cancel_booking como el tutor de la reserva). El alumno recibe NTF-55 con el motivo.';

revoke execute on function public.admin_sacar_de_clase_grupal(uuid, text) from public, anon;
grant  execute on function public.admin_sacar_de_clase_grupal(uuid, text) to authenticated;
