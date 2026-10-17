-- ============================================================================
-- Batería del ANEXO B de docs/PLAN-ACADEMIAS-Y-GRUPALES.md (lote 10 del sondeo
-- de grupales, 17-oct-2026). Solo DEV: usa los uuid de las cuentas sembradas
-- (ga.tutor, ga.alumno.ve/mx/es, ga.fuera, admin.us1101).
--
-- Cubre los escenarios de LÓGICA: 4, 5, 7, 8, 9, 10, 11, 13, 16, 17 y 18. Los
-- demás (1-3, 6, 12, 14, 15, 19) son de interfaz o de servicios externos.
-- Cada escenario corre en su bloque y termina en raise 'ROLLBACK_OK': no queda
-- NADA escrito. Devuelve un jsonb con {ok, …} por escenario.
--
--   set -a && . ./.env.local && set +a && \
--     npx supabase db query --linked -f scripts/anexo-b-grupales.sql
--
-- Tras tocar cancel_booking, politica_de_baja, notify_booking, el payout o los
-- regalos, se vuelve a correr: si un `ok` sale false, el `detalle` dice por qué.
-- ============================================================================


-- ── helpers ────────────────────────────────────────────────────────────────
create or replace function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

create or replace function pg_temp.fecha(p_dias numeric) returns timestamptz language sql as $$
  select date_trunc('hour', now()) + p_dias * interval '1 day' + interval '7 minutes'
$$;

-- Crea una grupal en borrador y la publica COMO la tutora (publicar_clase_grupal).
create or replace function pg_temp.mk_clase(p_cap int, p_min int, p_dias numeric[], p_precio bigint default 2000)
returns uuid language plpgsql as $$
declare v uuid; t uuid := 'c1000000-0000-4000-8000-000000000001';
begin
  insert into public.products (tutor_id, title, pricing_model, price_amount, currency,
                               session_duration_min, capacity, min_seats, auto_accept_bookings, status)
  values (t, '[resondeo lote 10] ' || gen_random_uuid(), 'group', p_precio, 'USD', 60,
          p_cap, p_min, true, 'draft')
  returning id into v;
  perform pg_temp.como(t);
  perform public.publicar_clase_grupal(v, array(select pg_temp.fecha(d) from unnest(p_dias) d));
  return v;
end $$;

-- Inscribe con la RPC real (create_booking_line) y, si toca, confirma el cobro
-- como lo haría el webhook (confirm_payment).
create or replace function pg_temp.inscribir(p_student uuid, p_prod uuid, p_pagar boolean default true)
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.create_booking_line(p_student, p_prod,
         array(select g.start_at from public.group_classes g
                where g.product_id = p_prod and g.status = 'scheduled' order by g.start_at));
  if p_pagar then
    perform public.confirm_payment(v, true);
  end if;
  return v;
end $$;

-- Mueve TODAS las fechas vivas de la clase para que la primera quede en p_ini.
create or replace function pg_temp.mover_fechas(p_prod uuid, p_ini timestamptz) returns void language plpgsql as $$
declare d interval;
begin
  select p_ini - min(start_at) into d from public.group_classes
   where product_id = p_prod and status = 'scheduled';
  update public.group_classes set start_at = start_at + d, end_at = end_at + d
   where product_id = p_prod and status = 'scheduled';
  update public.sessions s set start_at = s.start_at + d, end_at = s.end_at + d
    from public.group_classes g
   where s.group_class_id = g.id and g.product_id = p_prod and s.status = 'scheduled';
end $$;

-- ── batería ────────────────────────────────────────────────────────────────
create or replace function pg_temp.t() returns jsonb language plpgsql as $$
declare
  r      jsonb := '{}'::jsonb;
  paso   text;
  T      uuid := 'c1000000-0000-4000-8000-000000000001';  -- ga.tutor
  VE     uuid := 'c1000000-0000-4000-8000-000000000002';
  MX     uuid := 'c1000000-0000-4000-8000-000000000003';
  ES     uuid := 'c1000000-0000-4000-8000-000000000004';
  FUERA  uuid := 'c1000000-0000-4000-8000-000000000030';
  ADMIN  uuid := '29b69342-1c39-4eff-9606-30840e0b3020';  -- admin.us1101
  p      uuid;  p2 uuid;
  b1     uuid;  b2 uuid;  b3 uuid;  b4 uuid;
  conv   uuid;
  gc     uuid;
  cred   uuid;
  j      jsonb; j2 jsonb; d jsonb;
  n      int;   n2 int;   n3 int;
  x      bigint; y bigint;
  ok     boolean;
  txt    text;
begin
  -- ═══ 4 · tres inscripciones: invariante del 5 % y NTF-51 ×3 ══════════════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(4, null, array[300]);
    paso := 'inscribir VE';  b1 := pg_temp.inscribir(VE, p);
    paso := 'inscribir MX';  b2 := pg_temp.inscribir(MX, p);
    paso := 'inscribir ES';  b3 := pg_temp.inscribir(ES, p);
    paso := 'comprobar';
    select jsonb_agg(jsonb_build_object(
             'alumno', b.student_id, 'booking', b.status, 'pago', pm.status, 'provider', pm.provider,
             'payer', pm.payer_country, 'gross', pm.gross_amount, 'fee', pm.platform_fee_amount,
             'net', pm.tutor_net_amount, 'service', pm.service_fee_amount, 'pct', pm.service_fee_pct,
             'total_booking', b.total_amount, 'subtotal', b.subtotal_amount,
             'cuadra', pm.gross_amount = pm.platform_fee_amount + pm.tutor_net_amount + pm.service_fee_amount,
             'cinco', pm.service_fee_amount = round((pm.gross_amount - pm.service_fee_amount) * 0.05)))
      into d
      from public.bookings b join public.payments pm on pm.booking_id = b.id
     where b.product_id = p;
    select count(*) into n from public.notifications
     where recipient_id = T and type = 'NTF-51'
       and idempotency_key in ('NTF-51:booking:' || b1, 'NTF-51:booking:' || b2, 'NTF-51:booking:' || b3);
    select count(*) into n2 from public.notifications
     where type = 'NTF-56' and idempotency_key in ('NTF-56:booking:' || b1, 'NTF-56:booking:' || b2, 'NTF-56:booking:' || b3);
    ok := n = 3
      and (select bool_and((e->>'cuadra')::boolean and (e->>'cinco')::boolean and e->>'booking' = 'confirmed'
                           and e->>'pago' = 'paid' and (e->>'service')::bigint > 0)
             from jsonb_array_elements(d) e)
      and jsonb_array_length(d) = 3;
    r := r || jsonb_build_object('04_tres_inscripciones', jsonb_build_object('ok', ok,
           'ntf51_al_tutor', n, 'ntf56_alumnos', n2, 'pagos', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('04_tres_inscripciones', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 5 · hold caducado devuelve el cupo (expire_stale_bookings) ══════════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(2, null, array[301]);
    paso := 'inscribir VE pagado'; b1 := pg_temp.inscribir(VE, p);
    paso := 'hold FUERA';          b2 := pg_temp.inscribir(FUERA, p, false);
    n := public.cupos_libres(p);
    paso := 'tercero sin cupo';
    begin
      perform pg_temp.inscribir(MX, p, false);
      txt := 'MX entró con la clase llena';
    exception when others then txt := sqlerrm; end;
    paso := 'envejecer hold';
    update public.bookings set created_at = now() - interval '8 minutes' where id = b2;
    paso := 'expire_stale_bookings';
    j := public.expire_stale_bookings();
  -- sentencia aparte para ver sus cambios
    n2 := public.cupos_libres(p);
    select jsonb_build_object('booking', b.status, 'pago', pm.status,
                              'sesiones_vivas', (select count(*) from public.sessions s where s.booking_id = b.id and s.status = 'scheduled'))
      into d from public.bookings b join public.payments pm on pm.booking_id = b.id where b.id = b2;
    select coalesce(jsonb_agg(jsonb_build_object('a', recipient_id, 'type', type, 'template', template)), '[]')
      into j2 from public.notifications
     where payload->>'booking_id' = b2::text or idempotency_key like '%' || b2 || '%';
    paso := 'reinscribir MX tras liberar';
    b3 := pg_temp.inscribir(MX, p, false);
    ok := n = 0 and n2 = 1 and d->>'booking' = 'cancelled' and d->>'pago' = 'failed'
          and txt = 'esta clase ya no tiene cupos'
          and not (j2 @> '[{"type":"NTF-09"}]'::jsonb);  -- lote 10: sin NTF-09 de 1:1
    r := r || jsonb_build_object('05_hold_caducado', jsonb_build_object('ok', ok,
           'cupos_con_hold', n, 'tercero_con_lleno', txt, 'expire', j, 'cupos_tras_expirar', n2,
           'hold', d, 'avisos_del_hold', j2, 'reinscripcion_mx', b3 is not null));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('05_hold_caducado', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 7 · clase llena por pagos → NTF-52 (y no antes con un hold) ═════════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(2, null, array[302]);
    paso := 'VE pagado';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX hold';    b2 := pg_temp.inscribir(MX, p, false);
    select count(*) into n from public.notifications where type = 'NTF-52' and idempotency_key = 'NTF-52:product:' || p;
    n3 := public.cupos_libres(p);
    paso := 'MX paga';    perform public.confirm_payment(b2, true);
    select count(*) into n2 from public.notifications
     where type = 'NTF-52' and recipient_id = T and idempotency_key = 'NTF-52:product:' || p;
    ok := n = 0 and n2 = 1 and n3 = 0 and public.inscritos_pagados(p) = 2;
    r := r || jsonb_build_object('07_clase_llena', jsonb_build_object('ok', ok,
           'ntf52_con_1_pagado_y_1_hold', n, 'cupos_libres_con_hold', n3,
           'ntf52_con_2_pagados', n2, 'inscritos_pagados', public.inscritos_pagados(p)));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('07_clase_llena', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 8 · baja del alumno con > 24 h: 100 %, sale del chat, cupo libre ════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(3, null, array[303]);
    paso := 'VE';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX';  b2 := pg_temp.inscribir(MX, p);
    select c.id into conv from public.conversations c where c.kind = 'group' and c.group_product_id = p;
    perform pg_temp.como(VE);
    ok := public.puede_ver_conversacion(conv);
    n := public.cupos_libres(p);
    j2 := public.politica_de_baja(b1);
    paso := 'cancel_booking como VE';
    j := public.cancel_booking(b1, 'resondeo');
    n2 := public.cupos_libres(p);
    select jsonb_build_object('booking', b.status, 'pago', pm.status, 'gross', pm.gross_amount,
                              'refunded', pm.refunded_amount,
                              'refund_request', (select jsonb_agg(jsonb_build_object('amount', rr.amount, 'status', rr.status))
                                                   from public.refund_requests rr where rr.payment_id = pm.id))
      into d from public.bookings b join public.payments pm on pm.booking_id = b.id where b.id = b1;
    perform pg_temp.como(VE);
    r := r || jsonb_build_object('08_baja_mas_24h', jsonb_build_object(
           'ok', ok and not public.puede_ver_conversacion(conv)
                 and (j->>'refund_pct')::int = 100
                 and (d->>'refunded')::bigint = (d->>'gross')::bigint
                 and d->>'booking' = 'cancelled' and d->>'pago' = 'refunded'
                 and n2 = n + 1
                 and not exists (select 1 from public.my_conversations() m where m.id = conv),
           'veia_chat_antes', ok, 've_chat_despues', public.puede_ver_conversacion(conv),
           'politica', j2, 'cancel', j, 'reserva', d, 'cupos_antes', n, 'cupos_despues', n2));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('08_baja_mas_24h', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 9 · reagenda: NTF-54; el de ANTES con < 24 h → 100 %; el de DESPUÉS → 50 %
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(4, null, array[304]);
    paso := 'VE (antes)';  b1 := pg_temp.inscribir(VE, p);
    update public.bookings set created_at = now() - interval '1 day' where id = b1;
    select id into gc from public.group_classes where product_id = p;
    paso := 'reagendar como tutor';
    perform pg_temp.como(T);
    perform public.reagendar_clase_grupal(gc, pg_temp.fecha(305));
    select count(*) into n from public.notifications
     where type = 'NTF-54' and recipient_id = VE and payload->>'group_class_id' = gc::text;
    paso := 'MX (después)';
    b2 := pg_temp.inscribir(MX, p);
    update public.bookings set created_at = now() + interval '1 second' where id = b2;
    select count(*) into n2 from public.notifications
     where type = 'NTF-54' and recipient_id = MX and payload->>'group_class_id' = gc::text;
    paso := 'acercar la fecha a 20 h';
    perform pg_temp.mover_fechas(p, now() + interval '20 hours');
    paso := 'baja VE';
    perform pg_temp.como(VE);
    j2 := public.politica_de_baja(b1);
    j  := public.cancel_booking(b1, 'resondeo');
    paso := 'baja MX';
    perform pg_temp.como(MX);
    d  := public.politica_de_baja(b2);
    d  := jsonb_build_object('politica', d, 'cancel', public.cancel_booking(b2, 'resondeo'));
    select pm.gross_amount, pm.refunded_amount into x, y from public.payments pm where pm.booking_id = b1;
    r := r || jsonb_build_object('09_reagenda', jsonb_build_object(
           'ok', n = 1 and n2 = 0
                 and (j->>'refund_pct')::int = 100 and (j2->>'reagendada')::boolean
                 and y = x
                 and (d->'cancel'->>'refund_pct')::int = 50
                 and not (d->'politica'->>'reagendada')::boolean,
           'ntf54_a_VE', n, 'ntf54_a_MX_inscrito_despues', n2,
           'VE_politica', j2, 'VE_cancel', j, 'VE_gross', x, 'VE_refunded', y,
           'MX', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('09_reagenda', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 10 · mínimo no alcanzado a < 24 h → se cancela sola, 100 %, NTF-53 ══
  begin
    paso := 'crear clase (cap 4, min 4)';
    p := pg_temp.mk_clase(4, 4, array[306]);
    paso := 'VE';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX';  b2 := pg_temp.inscribir(MX, p);
    paso := 'ES';  b3 := pg_temp.inscribir(ES, p);
    paso := 'acercar la fecha a 20 h';
    perform pg_temp.mover_fechas(p, now() + interval '20 hours');
    perform pg_temp.como(null);
    paso := 'cancelar_grupales_sin_minimo';
    n := public.cancelar_grupales_sin_minimo();
    select jsonb_agg(jsonb_build_object('alumno', b.student_id, 'booking', b.status, 'motivo', b.cancel_reason,
                                        'pago', pm.status, 'gross', pm.gross_amount, 'refunded', pm.refunded_amount,
                                        'ntf53', (select count(*) from public.notifications nn
                                                   where nn.type = 'NTF-53' and nn.recipient_id = b.student_id
                                                     and nn.idempotency_key = 'NTF-53:product:' || p || ':' || b.student_id)))
      into d from public.bookings b join public.payments pm on pm.booking_id = b.id where b.product_id = p;
    select count(*) into n2 from public.notifications
     where type = 'NTF-53' and recipient_id = T and idempotency_key = 'NTF-53:product:' || p || ':' || T;
    select jsonb_build_object('producto', pr.status, 'fechas', (select jsonb_agg(g.status) from public.group_classes g where g.product_id = p))
      into j from public.products pr where pr.id = p;
    r := r || jsonb_build_object('10_minimo_no_alcanzado', jsonb_build_object(
           'ok', n >= 1 and n2 = 1
                 and (select bool_and(e->>'booking' = 'cancelled' and e->>'pago' = 'refunded'
                                      and (e->>'refunded')::bigint = (e->>'gross')::bigint
                                      and (e->>'ntf53')::int = 1) from jsonb_array_elements(d) e),
           'clases_canceladas_por_el_cron', n, 'ntf53_tutor', n2, 'reservas', d, 'clase', j));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('10_minimo_no_alcanzado', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 11 · ciclo de 4 fechas, el tutor cancela la 3.ª → 25 % y NTF-55 ═════
  begin
    paso := 'crear ciclo de 4';
    p := pg_temp.mk_clase(3, null, array[307, 308, 309, 310]);
    paso := 'VE';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX';  b2 := pg_temp.inscribir(MX, p);
    select id into gc from public.group_classes where product_id = p and sequence_no = 3;
    paso := 'cancelar_fecha_grupal como tutor';
    perform pg_temp.como(T);
    n := public.cancelar_fecha_grupal(gc, 'resondeo');
    select jsonb_agg(jsonb_build_object('alumno', b.student_id, 'booking', b.status, 'num_sessions', b.num_sessions,
                                        'pago', pm.status, 'gross', pm.gross_amount, 'refunded', pm.refunded_amount,
                                        'esperado', round(pm.gross_amount / 4.0),
                                        'sesion_3', (select s.status from public.sessions s where s.booking_id = b.id and s.group_class_id = gc),
                                        'ntf55', (select jsonb_agg(nn.payload) from public.notifications nn
                                                   where nn.type = 'NTF-55' and nn.recipient_id = b.student_id
                                                     and nn.payload->>'product_id' = p::text)))
      into d from public.bookings b join public.payments pm on pm.booking_id = b.id where b.product_id = p;
    r := r || jsonb_build_object('11_cancelar_fecha_3', jsonb_build_object(
           'ok', n = 2 and (select bool_and(e->>'booking' = 'confirmed' and e->>'pago' = 'partially_refunded'
                                             and (e->>'refunded')::bigint = (e->>'esperado')::bigint
                                             and e->>'sesion_3' = 'cancelled'
                                             and jsonb_array_length(e->'ntf55') = 1
                                             and (e->'ntf55'->0) ? 'fecha') from jsonb_array_elements(d) e),
           'afectados', n, 'reservas', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('11_cancelar_fecha_3', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 13 · chat grupal: quién ve el hilo ═══════════════════════════════════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(4, null, array[311]);
    paso := 'VE pagado';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX pagado';  b2 := pg_temp.inscribir(MX, p);
    paso := 'ES hold';    b3 := pg_temp.inscribir(ES, p, false);
    select c.id into conv from public.conversations c where c.kind = 'group' and c.group_product_id = p;
    d := '{}'::jsonb;
    perform pg_temp.como(T);
    d := d || jsonb_build_object('tutor', jsonb_build_object('puede', public.puede_ver_conversacion(conv),
           'en_my_conversations', exists (select 1 from public.my_conversations() m where m.id = conv)));
    perform pg_temp.como(VE);
    d := d || jsonb_build_object('VE_pagado', jsonb_build_object('puede', public.puede_ver_conversacion(conv),
           'en_my_conversations', exists (select 1 from public.my_conversations() m where m.id = conv)));
    perform pg_temp.como(MX);
    d := d || jsonb_build_object('MX_pagado', jsonb_build_object('puede', public.puede_ver_conversacion(conv),
           'en_my_conversations', exists (select 1 from public.my_conversations() m where m.id = conv)));
    perform pg_temp.como(ES);
    d := d || jsonb_build_object('ES_hold', jsonb_build_object('puede', public.puede_ver_conversacion(conv),
           'en_my_conversations', exists (select 1 from public.my_conversations() m where m.id = conv)));
    perform pg_temp.como(FUERA);
    d := d || jsonb_build_object('FUERA', jsonb_build_object('puede', public.puede_ver_conversacion(conv),
           'en_my_conversations', exists (select 1 from public.my_conversations() m where m.id = conv)));
    paso := 'FUERA escribe';
    begin
      perform public.send_conversation_message(conv, 'hola desde fuera');
      txt := 'FUERA PUDO ESCRIBIR';
    exception when others then txt := 'rechazado: ' || sqlerrm; end;
    d := d || jsonb_build_object('FUERA_escribe', txt);
    paso := 'tutor escribe';
    perform pg_temp.como(T);
    begin
      perform public.send_conversation_message(conv, 'hola grupo');
      txt := 'ok';
    exception when others then txt := 'rechazado: ' || sqlerrm; end;
    d := d || jsonb_build_object('tutor_escribe', txt);
    r := r || jsonb_build_object('13_chat_grupal', jsonb_build_object(
           'ok', conv is not null
                 and (d->'tutor'->>'puede')::boolean and (d->'tutor'->>'en_my_conversations')::boolean
                 and (d->'VE_pagado'->>'puede')::boolean and (d->'VE_pagado'->>'en_my_conversations')::boolean
                 and (d->'MX_pagado'->>'puede')::boolean and (d->'MX_pagado'->>'en_my_conversations')::boolean
                 and not (d->'ES_hold'->>'puede')::boolean and not (d->'ES_hold'->>'en_my_conversations')::boolean
                 and not (d->'FUERA'->>'puede')::boolean and not (d->'FUERA'->>'en_my_conversations')::boolean
                 and d->>'FUERA_escribe' like 'rechazado%' and d->>'tutor_escribe' = 'ok',
           'detalle', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('13_chat_grupal', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 16 · payout: solo completed, nunca las canceladas ═══════════════════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(3, null, array[312]);
    paso := 'VE';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX';  b2 := pg_temp.inscribir(MX, p);
    paso := 'ES';  b3 := pg_temp.inscribir(ES, p);
    paso := 'ES se da de baja';
    perform pg_temp.como(ES);
    perform public.cancel_booking(b3, 'resondeo');
    paso := 'balance antes';
    perform pg_temp.como(T);
    j := public.tutor_balance(7);
    select coalesce(sum((e->>'amount')::bigint), 0) into x from jsonb_array_elements(j->'available') e where e->>'currency' = 'USD';
    paso := 'completar VE y MX hace 10 días';
    update public.bookings set status = 'completed', completed_at = now() - interval '10 days' where id in (b1, b2);
    -- y ES (cancelada) con completed_at viejo, por si alguien mirase solo la fecha
    update public.bookings set completed_at = now() - interval '10 days' where id = b3;
    perform pg_temp.como(T);
    j2 := public.tutor_balance(7);
    select coalesce(sum((e->>'amount')::bigint), 0) into y from jsonb_array_elements(j2->'available') e where e->>'currency' = 'USD';
    select sum(pm.tutor_net_amount) into n3 from public.payments pm where pm.booking_id in (b1, b2);
    paso := 'build_payout_for_tutor';
    perform public.build_payout_for_tutor(T, 7);
    select jsonb_object_agg(
             case b.id when b1 then 'VE' when b2 then 'MX' else 'ES' end,
             jsonb_build_object('booking', b.status, 'pago', pm.status, 'net', pm.tutor_net_amount,
                                'en_payout', exists (select 1 from public.payout_items pi where pi.payment_id = pm.id),
                                'item', (select pi.amount from public.payout_items pi where pi.payment_id = pm.id)))
      into d from public.bookings b join public.payments pm on pm.booking_id = b.id where b.product_id = p;
    r := r || jsonb_build_object('16_payout', jsonb_build_object(
           'ok', (y - x) = n3
                 and (d->'VE'->>'en_payout')::boolean and (d->'MX'->>'en_payout')::boolean
                 and not (d->'ES'->>'en_payout')::boolean,
           'available_usd_antes', x, 'available_usd_despues', y, 'delta', y - x, 'net_VE_mas_MX', n3,
           'reservas', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('16_payout', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 17 · regalo de cupo: clase llena antes del canje → saldo ════════════
  begin
    paso := 'crear clase cap 2';
    p := pg_temp.mk_clase(2, null, array[313]);
    paso := 'comprar_regalo como VE para FUERA';
    perform pg_temp.como(VE);
    cred := public.comprar_regalo(p, 'ga.fuera@ensenameya.dev', 'resondeo');
    paso := 'confirm_gift_payment';
    perform pg_temp.como(null);
    txt := public.confirm_gift_payment(cred, true);
    select jsonb_build_object('status', c.status, 'kind', c.kind, 'beneficiario', c.beneficiary_id, 'amount', c.amount)
      into j from public.credits c where c.id = cred;
    paso := 'MX y ES llenan la clase';
    b1 := pg_temp.inscribir(MX, p);
    b2 := pg_temp.inscribir(ES, p);
    select jsonb_build_object('status', c.status, 'kind', c.kind, 'beneficiario', c.beneficiary_id,
                              'ntf38', (select jsonb_agg(nn.payload->>'causa') from public.notifications nn
                                         where nn.idempotency_key = 'CRED:bono:' || c.id))
      into j2 from public.credits c where c.id = cred;
    paso := 'FUERA intenta canjear con la clase llena';
    begin
      perform pg_temp.inscribir(FUERA, p, false);
      txt := 'FUERA ENTRÓ';
    exception when others then txt := sqlerrm; end;
    -- Variante B · la inscripción cierra (primera fecha pasada) con el regalo vivo.
    d := null;
    paso := 'variante B: clase con cupo, regalo vivo';
    p2 := pg_temp.mk_clase(3, null, array[314]);
    perform pg_temp.como(VE);
    cred := public.comprar_regalo(p2, 'ga.fuera@ensenameya.dev', 'resondeo B');
    perform pg_temp.como(null);
    perform public.confirm_gift_payment(cred, true);
    paso := 'variante B: la primera fecha pasa';
    perform pg_temp.mover_fechas(p2, now() - interval '30 minutes');
    paso := 'variante B: regalos_de_grupales_cerradas';
    begin
      n := public.regalos_de_grupales_cerradas();
    exception when others then n := -1; d := jsonb_build_object('error_cron', sqlerrm); end;
    select coalesce(d, '{}'::jsonb) || jsonb_build_object('status', c.status, 'kind', c.kind, 'convertidos', n,
                              'ntf38', (select jsonb_agg(nn.payload->>'causa') from public.notifications nn
                                         where nn.idempotency_key = 'CRED:bono:' || c.id))
      into d from public.credits c where c.id = cred;
    r := r || jsonb_build_object('17_regalo_de_cupo', jsonb_build_object(
           'ok', j->>'status' = 'active' and j->>'kind' = 'mentoria'
                 and j2->>'kind' = 'saldo' and j2->>'status' = 'active'
                 and j2->'ntf38' ? 'clase_llena'
                 and txt = 'esta clase ya no tiene cupos'
                 and d->>'kind' = 'saldo' and d->'ntf38' ? 'inscripcion_cerrada',
           'regalo_al_pagar', j, 'regalo_con_clase_llena', j2, 'canje_con_clase_llena', txt,
           'variante_inscripcion_cerrada', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('17_regalo_de_cupo', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  -- ═══ 18 · admin_sacar_de_clase_grupal: 100 % y sacado_por_admin_at ═══════
  begin
    paso := 'crear clase';
    p := pg_temp.mk_clase(3, null, array[315]);
    paso := 'VE';  b1 := pg_temp.inscribir(VE, p);
    paso := 'MX';  b2 := pg_temp.inscribir(MX, p);
    paso := 'tutor intenta usar la RPC de admin';
    perform pg_temp.como(T);
    begin
      perform public.admin_sacar_de_clase_grupal(b2, 'x');
      txt := 'EL TUTOR PUDO';
    exception when others then txt := sqlstate || ' ' || sqlerrm; end;
    paso := 'admin saca a VE';
    perform pg_temp.como(ADMIN);
    j := public.admin_sacar_de_clase_grupal(b1, 'resondeo admin');
    select jsonb_build_object('booking', b.status, 'sacado_por_admin_at', b.sacado_por_admin_at, 'motivo', b.cancel_reason,
                              'pago', pm.status, 'gross', pm.gross_amount, 'refunded', pm.refunded_amount,
                              'claims_tras_rpc', current_setting('request.jwt.claim.sub', true),
                              'ntf', (select jsonb_agg(jsonb_build_object('type', nn.type, 'para', nn.payload->>'para', 'alcance', nn.payload->>'alcance'))
                                        from public.notifications nn where nn.payload->>'booking_id' = b.id::text
                                         and nn.type in ('NTF-55', 'NTF-09')))
      into d from public.bookings b join public.payments pm on pm.booking_id = b.id where b.id = b1;
    r := r || jsonb_build_object('18_admin_saca', jsonb_build_object(
           'ok', (j->>'refund_pct')::int = 100 and d->>'booking' = 'cancelled'
                 and d->>'sacado_por_admin_at' is not null and d->>'pago' = 'refunded'
                 and (d->>'refunded')::bigint = (d->>'gross')::bigint
                 and txt like '42501%' and d->>'claims_tras_rpc' = ADMIN::text,
           'tutor_rpc_admin', txt, 'resultado', j, 'reserva', d));
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then
      r := r || jsonb_build_object('18_admin_saca', jsonb_build_object('ok', false, 'paso', paso, 'error', sqlerrm, 'estado', sqlstate));
    end if;
  end;

  return r;
end $$;

select jsonb_pretty(pg_temp.t()) as resultado;
