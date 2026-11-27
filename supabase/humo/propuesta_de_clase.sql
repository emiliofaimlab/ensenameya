-- ============================================================================
-- Humo de 20261124140000_propuesta_de_clase — contra DEV, nunca contra prod.
--
--   npx supabase db query --linked --yes -f supabase/humo/propuesta_de_clase.sql
--
-- Es UN solo bloque DO que siempre acaba en `raise exception`: todo lo que
-- hace (propuestas, reservas, pagos, avisos encolados) se deshace. Si acaba en
-- «HUMO OK …» pasó todo; si acaba en «FALLO: …», dice qué.
-- ============================================================================
do $humo$
declare
  v_t    uuid;  v_s uuid;  v_p uuid;  v_otra uuid;  v_c uuid;
  v_sl   timestamptz[];
  v_p1   uuid;  v_p2 uuid;  v_b2 uuid;  v_b3 uuid;
  v_st   text;  v_n int;  i int;
  v_pk   record;  v_slk timestamptz[];  v_bk uuid;
begin
  -- Para actuar como un usuario se fija `request.jwt.claim(s)`, que es lo que
  -- lee auth.uid() — lo mismo que hace PostgREST con el JWT.
  -- Oferta 1:1 de aceptación MANUAL con agenda.
  select p.id, p.tutor_id into v_p, v_t
    from public.products p
    join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
   where p.status = 'active' and p.visibility = 'public' and p.academy_id is null
     and p.group_template_id is null and p.pricing_model in ('per_session', 'per_hour')
     and not p.auto_accept_bookings
     and (select count(*) from public.get_available_slots(p.id, current_date, current_date + 30)) >= 10
   limit 1;
  if v_p is null then raise exception 'FALLO: no hay oferta manual con agenda en dev'; end if;

  select array_agg(g.slot_start order by g.slot_start) into v_sl
    from (select slot_start from public.get_available_slots(v_p, current_date, current_date + 30)
           order by slot_start limit 10) g;

  -- Alumno sin historia con ese tutor (para que el tope previo aplique).
  select ur.user_id into v_s
    from public.user_roles ur
   where ur.role = 'alumno' and ur.user_id <> v_t
     and not exists (select 1 from public.tutor_profiles tp where tp.profile_id = ur.user_id)
     and not exists (select 1 from public.bookings b where b.student_id = ur.user_id and b.tutor_id = v_t)
   limit 1;

  -- Oferta 1:1 de OTRO tutor.
  select p.id into v_otra from public.products p
   where p.status = 'active' and p.tutor_id <> v_t and p.pricing_model in ('per_session','per_hour')
   limit 1;

  insert into public.conversations (student_id, tutor_id) values (v_s, v_t)
  on conflict (student_id, tutor_id) do update set updated_at = now()
  returning id into v_c;
  delete from public.messages where conversation_id = v_c;

  -- ── A · el tutor propone ─────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  v_p1 := public.proponer_clase(v_c, v_p, v_sl[1]);
  if not exists (select 1 from public.class_proposals where id = v_p1 and status = 'pending') then
    raise exception 'FALLO A: la propuesta no quedó pending'; end if;
  if not exists (select 1 from public.messages where proposal_id = v_p1 and sender_id = v_t and expires_at is null) then
    raise exception 'FALLO A: no hay mensaje con proposal_id'; end if;

  -- ── C · hora no libre / D · oferta ajena ─────────────────────────────────
  begin
    perform public.proponer_clase(v_c, v_p, v_sl[1] + interval '1 minute');
    raise exception 'FALLO C: aceptó una hora fuera de la agenda';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin
    perform public.proponer_clase(v_c, v_otra, v_sl[2]);
    raise exception 'FALLO D: aceptó la oferta de otro tutor';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── E · la propuesta no gasta cupo: 5 mensajes pasan, el 6.º no ──────────
  for i in 1..5 loop perform public.send_conversation_message(v_c, 'hola ' || i); end loop;
  begin
    perform public.send_conversation_message(v_c, 'sexto');
    raise exception 'FALLO E: el tope de 5 no frenó';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── B · el alumno no puede proponer ──────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  begin
    perform public.proponer_clase(v_c, v_p, v_sl[2]);
    raise exception 'FALLO B: el alumno pudo proponer';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── F · proponer otra retira la anterior ─────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  v_p2 := public.proponer_clase(v_c, v_p, v_sl[2]);
  if (select status from public.class_proposals where id = v_p1) <> 'withdrawn' then
    raise exception 'FALLO F: la anterior no se retiró'; end if;

  -- ── G · el alumno empieza a pagar: el tutor no puede cambiarla ───────────
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  v_b2 := public.create_booking(v_p, array[v_sl[2]]);
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  begin
    perform public.proponer_clase(v_c, v_p, v_sl[3]);
    raise exception 'FALLO G: cambió la propuesta con el alumno pagando';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── H · pagada → confirmed aunque la oferta sea manual ───────────────────
  v_st := public.confirm_payment(v_b2, true, null, null);
  if v_st <> 'confirmed' then raise exception 'FALLO H: quedó % y no confirmed', v_st; end if;
  if not exists (select 1 from public.class_proposals where id = v_p2 and status = 'paid' and booking_id = v_b2) then
    raise exception 'FALLO H: la propuesta no quedó paid'; end if;

  -- ── I · sin propuesta, la oferta manual sigue esperando al tutor ─────────
  perform set_config('request.jwt.claim.sub', v_s::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  v_b3 := public.create_booking(v_p, array[v_sl[4]]);
  v_st := public.confirm_payment(v_b3, true, null, null);
  if v_st <> 'pending_acceptance' then raise exception 'FALLO I: quedó % y no pending_acceptance', v_st; end if;

  -- ── J · tope de 5 propuestas en 24 h (ya van 2) ──────────────────────────
  perform set_config('request.jwt.claim.sub', v_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  perform public.proponer_clase(v_c, v_p, v_sl[5]);
  perform public.proponer_clase(v_c, v_p, v_sl[6]);
  perform public.proponer_clase(v_c, v_p, v_sl[7]);
  begin
    perform public.proponer_clase(v_c, v_p, v_sl[8]);
    raise exception 'FALLO J: aceptó la 6.ª propuesta';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- ── K · un PAQUETE no rompe confirm_payment ──────────────────────────────
  select p.id, p.package_num_sessions n into v_pk from public.products p
   where p.status = 'active' and p.pricing_model = 'per_package' and p.academy_id is null
     and p.tutor_id <> v_s
     and (select count(*) from public.get_available_slots(p.id, current_date, current_date + 30)) >= 20
   limit 1;
  if v_pk.id is not null then
    -- Horarios que no se pisen: uno cada 2 días.
    select array_agg(x order by x) into v_slk from (
      select distinct on ((slot_start at time zone 'UTC')::date) slot_start x
        from public.get_available_slots(v_pk.id, current_date, current_date + 30)
       order by (slot_start at time zone 'UTC')::date, slot_start) d;
    v_slk := v_slk[1:coalesce(v_pk.n, 1)];
    perform set_config('request.jwt.claim.sub', v_s::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
    v_bk := public.create_booking(v_pk.id, v_slk);
    v_st := public.confirm_payment(v_bk, true, null, null);
    if v_st not in ('confirmed', 'pending_acceptance') then raise exception 'FALLO K: paquete quedó %', v_st; end if;
  else
    raise notice 'K omitido: no hay paquete con agenda en dev';
  end if;

  -- ── L · grants ───────────────────────────────────────────────────────────
  if not has_function_privilege('authenticated', 'public.proponer_clase(uuid,uuid,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.proponer_clase(uuid,uuid,timestamptz)', 'execute') then
    raise exception 'FALLO L: grants de proponer_clase'; end if;

  raise exception 'HUMO OK · A-L pasaron (paquete: %) · todo deshecho a propósito',
    case when v_pk.id is null then 'omitido' else 'probado' end;
end
$humo$;
