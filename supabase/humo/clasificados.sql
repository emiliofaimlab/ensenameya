-- ============================================================================
-- Humo de 20261125120000_clasificados — contra DEV, nunca contra prod.
--
--   npx supabase db query --linked --yes -f supabase/humo/clasificados.sql
--
-- Un solo bloque DO que siempre acaba en `raise exception`: no deja nada.
-- «HUMO OK …» = pasó todo; «FALLO: …» = qué falló.
-- ============================================================================
do $humo$
declare
  v_s uuid; v_t uuid; v_p uuid; v_cat uuid; v_t2 uuid; v_p2 uuid; v_adm uuid;
  v_sl timestamptz[]; v_sl2 timestamptz[];
  v_todo jsonb := '[{"dia":0,"desde":"00:00","hasta":"24:00"},{"dia":1,"desde":"00:00","hasta":"24:00"},{"dia":2,"desde":"00:00","hasta":"24:00"},{"dia":3,"desde":"00:00","hasta":"24:00"},{"dia":4,"desde":"00:00","hasta":"24:00"},{"dia":5,"desde":"00:00","hasta":"24:00"},{"dia":6,"desde":"00:00","hasta":"24:00"}]';
  v_r uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_pr uuid; v_pr2 uuid; v_b uuid; v_st text; v_tz text;
  v_n int; i int;

begin
  -- Oferta elegible con agenda, su categoría y su tutor.
  select p.id, p.tutor_id, pc.category_id into v_p, v_t, v_cat
    from public.products p
    join public.product_categories pc on pc.product_id = p.id
    join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
   where p.status = 'active' and p.visibility = 'public' and p.academy_id is null
     and p.group_template_id is null and p.pricing_model in ('per_session', 'per_hour')
     and (select count(*) from public.get_available_slots(p.id, current_date, current_date + 30)) >= 6
   limit 1;
  if v_p is null then raise exception 'FALLO: no hay oferta elegible en dev'; end if;
  select array_agg(slot_start order by slot_start) into v_sl from (
    select slot_start from public.get_available_slots(v_p, current_date + 1, current_date + 30)
     order by slot_start limit 6) g;

  -- Un segundo tutor de la misma categoría, si lo hay.
  select p.id, p.tutor_id into v_p2, v_t2
    from public.products p
    join public.product_categories pc on pc.product_id = p.id and pc.category_id = v_cat
    join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
   where p.tutor_id <> v_t and p.status = 'active' and p.visibility = 'public'
     and p.academy_id is null and p.group_template_id is null and p.pricing_model in ('per_session', 'per_hour')
     and (select count(*) from public.get_available_slots(p.id, current_date, current_date + 30)) >= 2
   limit 1;
  if v_p2 is not null then
    select array_agg(slot_start order by slot_start) into v_sl2 from (
      select slot_start from public.get_available_slots(v_p2, current_date + 1, current_date + 30)
       order by slot_start limit 2) g;
  end if;

  select ur.user_id into v_s from public.user_roles ur
   where ur.role = 'alumno' and ur.user_id not in (v_t, coalesce(v_t2, v_t))
     and not exists (select 1 from public.tutor_profiles tp where tp.profile_id = ur.user_id)
   limit 1;
  select user_id into v_adm from public.user_roles where role = 'admin' limit 1;
  select timezone into v_tz from public.profiles where id = v_s;

  -- ── A · publicar + aviso a los tutores ───────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s)::text, true);
  v_r := public.publicar_clasificado(v_cat, 'Aprobar el examen final', 'Nivel intermedio', v_todo, null);
  if not exists (select 1 from public.notifications where type = 'NTF-57' and recipient_id = v_t
                  and payload->>'request_id' = v_r::text) then
    raise exception 'FALLO A: no se avisó al tutor de la categoría'; end if;
  if (select expires_at from public.class_requests where id = v_r) < now() + interval '13 days' then
    raise exception 'FALLO A: la vigencia por defecto no es de 14 días'; end if;

  -- ── B · contacto y franjas inválidas ─────────────────────────────────────
  begin
    perform public.publicar_clasificado(v_cat, 'Escríbeme al 0414 123 4567', null, v_todo, null);
    raise exception 'FALLO B: aceptó un teléfono';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin
    perform public.publicar_clasificado(v_cat, 'Algo', null, '[{"dia":1,"desde":"10:00","hasta":"09:00"}]', null);
    raise exception 'FALLO B: aceptó una franja al revés';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── C · el listado público no trae al alumno ─────────────────────────────
  if (select count(*) from public.clasificados_publicos(v_r)) <> 1 then
    raise exception 'FALLO C: no sale en el listado público'; end if;

  -- ── D · postular ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t)::text, true);
  begin
    perform public.postular_a_clasificado(v_r, v_p, v_sl[1], 'mi correo es ana@x.com');
    raise exception 'FALLO D: aceptó un correo en el mensaje';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  v_pr := public.postular_a_clasificado(v_r, v_p, v_sl[1], 'Te ayudo con el examen');
  if not exists (select 1 from public.class_proposals where id = v_pr and request_id = v_r and status = 'pending') then
    raise exception 'FALLO D: la postulación no quedó como propuesta del clasificado'; end if;
  if not exists (select 1 from public.notifications where type = 'NTF-58' and recipient_id = v_s
                  and payload->>'proposal_id' = v_pr::text) then
    raise exception 'FALLO D: no se avisó al alumno'; end if;
  if (select postulaciones from public.clasificados_publicos(v_r)) <> 1 then
    raise exception 'FALLO D: el contador de postulaciones no es 1'; end if;

  -- ── E · fuera de las franjas del alumno ──────────────────────────────────
  -- Una franja solo el día SIGUIENTE al del hueco 2, en la zona del alumno.
  v_n := (extract(dow from v_sl[2] at time zone coalesce(v_tz, 'UTC'))::int + 1) % 7;
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s)::text, true);
  v_r2 := public.publicar_clasificado(v_cat, 'Otra cosa', null,
    jsonb_build_array(jsonb_build_object('dia', v_n, 'desde', '00:00', 'hasta', '24:00')), null);
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t)::text, true);
  begin
    perform public.postular_a_clasificado(v_r2, v_p, v_sl[2], 'Te ayudo');
    raise exception 'FALLO E: aceptó una hora fuera de las franjas';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── F · un segundo tutor postula al primero ──────────────────────────────
  if v_p2 is not null then
    perform set_config('request.jwt.claim.sub', v_t2::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_t2)::text, true);
    v_pr2 := public.postular_a_clasificado(v_r, v_p2, v_sl2[1], 'Yo también puedo');
  end if;

  -- ── G · el alumno paga la del primero: reservado y la otra retirada ──────
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s)::text, true);
  v_b := public.create_booking(v_p, array[v_sl[1]]);
  v_st := public.confirm_payment(v_b, true, null, null);
  if v_st <> 'confirmed' then raise exception 'FALLO G: la reserva quedó %', v_st; end if;
  if (select status from public.class_requests where id = v_r) <> 'reserved' then
    raise exception 'FALLO G: el clasificado no quedó reservado'; end if;
  if v_pr2 is not null then
    if (select status from public.class_proposals where id = v_pr2) <> 'withdrawn' then
      raise exception 'FALLO G: la otra postulación no se retiró'; end if;
    if not exists (select 1 from public.notifications where type = 'NTF-59' and recipient_id = v_t2) then
      raise exception 'FALLO G: no se avisó al otro tutor'; end if;
  end if;
  if (select count(*) from public.clasificados_publicos(v_r)) <> 0 then
    raise exception 'FALLO G: un reservado sigue en el listado'; end if;

  -- ── H · cerrar retira postulaciones ──────────────────────────────────────
  v_r3 := public.publicar_clasificado(v_cat, 'Repasar para el parcial', null, v_todo, null);
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t)::text, true);
  v_pr := public.postular_a_clasificado(v_r3, v_p, v_sl[3], 'Cuenta conmigo');
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s)::text, true);
  perform public.cerrar_clasificado(v_r3);
  if (select status from public.class_proposals where id = v_pr) <> 'withdrawn' then
    raise exception 'FALLO H: cerrar no retiró la postulación'; end if;

  -- ── I · tope de 3 activos (r2 activo; r3 cerrado) ────────────────────────
  v_r4 := public.publicar_clasificado(v_cat, 'Tercero', null, v_todo, null);
  perform public.publicar_clasificado(v_cat, 'Cuarto', null, v_todo, null);
  begin
    perform public.publicar_clasificado(v_cat, 'Quinto', null, v_todo, null);
    raise exception 'FALLO I: dejó publicar un 4.º activo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── J · vencer y republicar ──────────────────────────────────────────────
  update public.class_requests set expires_at = now() - interval '1 minute' where id = v_r4;
  perform public.caducar_clasificados();
  if (select status from public.class_requests where id = v_r4) <> 'expired' then
    raise exception 'FALLO J: no venció'; end if;
  if not exists (select 1 from public.notifications where type = 'NTF-60' and recipient_id = v_s) then
    raise exception 'FALLO J: no se avisó del vencimiento'; end if;
  perform public.republicar_clasificado(v_r4);
  if (select status from public.class_requests where id = v_r4) <> 'active' then
    raise exception 'FALLO J: no se republicó'; end if;

  -- ── K · retirar es solo del admin ────────────────────────────────────────
  begin
    perform public.admin_retirar_clasificado(v_r4, 'prueba');
    raise exception 'FALLO K: un alumno pudo retirar';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm)::text, true);
  perform public.admin_retirar_clasificado(v_r4, 'prueba');
  if (select status from public.class_requests where id = v_r4) <> 'removed' then
    raise exception 'FALLO K: el admin no pudo retirar'; end if;
  select count(*) into v_n from public.admin_clasificados_resumen();
  if v_n < 1 then raise exception 'FALLO K: el resumen del admin sale vacío'; end if;

  -- ── L · grants ───────────────────────────────────────────────────────────
  if not has_function_privilege('anon', 'public.clasificados_publicos(uuid,uuid,int)', 'execute')
     or has_function_privilege('anon', 'public.publicar_clasificado(uuid,text,text,jsonb,date)', 'execute')
     or has_function_privilege('authenticated', 'public.crear_propuesta(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)', 'execute') then
    raise exception 'FALLO L: grants'; end if;

  raise exception 'HUMO OK · A-L pasaron (segundo tutor: %) · todo deshecho a propósito',
    case when v_p2 is null then 'no había' else 'probado' end;
end
$humo$;
