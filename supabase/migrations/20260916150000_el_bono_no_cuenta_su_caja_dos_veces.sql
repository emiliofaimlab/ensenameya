-- ════════════════════════════════════════════════════════════════════════════
-- EL BONO NO CUENTA SU CAJA DOS VECES · arreglo de fondeo que abre el bono
-- ════════════════════════════════════════════════════════════════════════════
--
-- `20260916100000_el_regalo_sobrevive_al_tutor.sql` hace que un regalo pueda
-- convertirse en BONO (`credits.kind = 'saldo'`) cuando el tutor cierra su
-- cuenta. Eso abre un caso que hasta ahora no existía: **un crédito de origen
-- `gift` que se gasta en VARIAS reservas**.
--
-- 🔴 Y ahí `aplicar_credito` le pasaba a `fondeo_del_cobro()` el importe
--    ENTERO del regalo como «la caja que hay en el PSP», en cada aplicación.
--    Con un `kind='mentoria'` daba igual —se gasta de una vez, la caja se cuenta
--    una vez— pero con un bono partido la misma caja se cuenta varias veces y el
--    payout sale INFRA-FONDEADO, con el agravante de siempre: no falla el build,
--    no falla el typecheck, y la orden se va a `failed` por saldo semanas
--    después. El detalle numérico está en el comentario de la llamada.
--
-- Se arregla con `v_c.amount - v_c.consumed_amount` (lo que del regalo sigue sin
-- comprometer), que es **neutro para todo lo que existe hoy**: en un
-- `kind='mentoria'` el `consumed_amount` vale 0 en el momento de aplicarlo.
--
-- ── POR QUÉ ESTA MIGRACIÓN ES UN VOLCADO ENTERO ────────────────────────────
--
-- Regla de oro 12: la firma NO cambia, así que va por `create or replace` y no
-- hay `grant execute` que reponer. Pero `create or replace` exige el CUERPO
-- COMPLETO, y por eso las 174 líneas de abajo son copia literal de
-- `20260912110000` con **un solo argumento cambiado** y su comentario. Si al
-- revisar esto se ve cualquier otra diferencia, es un error de copia: la única
-- que debe haber está marcada con 🔴.
-- ════════════════════════════════════════════════════════════════════════════


create or replace function public.aplicar_credito(p_booking_id uuid, p_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_b       record;
  v_p       record;
  v_c       record;
  v_r       jsonb;
  v_cubre   bigint;
  v_caja    bigint;
  v_falta   bigint;
  v_funding text;
  v_abierto boolean;
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  select b.id, b.product_id, b.num_sessions
    into v_b
  from public.bookings b
  where b.id = p_booking_id and b.student_id = v_uid;
  if v_b.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- ⚠️ ORDEN DE BLOQUEO: `payments` primero, `credits` después. Es el mismo que
  -- toman expire_stale_bookings, confirm_payment y refund_payment. Invertirlo
  -- aquí crearía el ciclo de deadlock que hoy no existe.
  select p.* into v_p from public.payments p where p.booking_id = p_booking_id for update;
  if v_p.id is null then
    raise exception 'esta reserva no tiene cobro' using errcode = 'no_data_found';
  end if;

  -- Cerrojo 1 — solo antes de cobrar. El mismo que `set_charge_provider`
  -- (`20260910120000:303`) y por la misma razón.
  if v_p.status <> 'pending' then
    raise exception 'el pago de esta reserva ya está en %', v_p.status
      using errcode = 'check_violation';
  end if;

  -- Cerrojo 3 (S9) — esta reserva ya tiene crédito. Sin esto, un doble clic o
  -- dos pestañas pisan `payments.credit_id` y el PRIMER crédito se queda
  -- `consumed` sin que nada lo devuelva: `quitar_credito` solo sabe deshacer lo
  -- que `payments.credit_amount` dice AHORA.
  if v_p.credit_id is not null then
    raise exception 'esta reserva ya tiene un crédito aplicado'
      using errcode = 'check_violation',
            hint = 'Quítalo antes con quitar_credito si quieres usar otro.';
  end if;

  -- ⚠️ Y LA FECHA, QUE FALTABA. `status = 'active'` no basta: `caducar_creditos`
  -- corre UNA VEZ AL DÍA (03:17), así que un crédito vencido a las 00:01 sigue
  -- diciendo 'active' durante ~27 horas y hasta hoy se podía gastar entero.
  -- El barrido es el que ORDENA la caducidad; quien la DECIDE es esta fecha.
  select c.* into v_c
  from public.credits c
  where c.id = p_credit_id
    and c.beneficiary_id = v_uid
    and c.status  = 'active'
    and c.destino = 'cobro'
    and (c.expires_at is null or c.expires_at > now())
  for update;
  if v_c.id is null then
    raise exception 'crédito no disponible' using errcode = 'no_data_found';
  end if;

  -- ⚠️ SE RECALCULA AQUÍ, NO SE CONFÍA EN EL NAVEGADOR (regla de oro 2). Lo
  -- único que manda el navegador es un `credit_id`; el importe sale de
  -- `payments.gross_amount` y del propio crédito, ya bloqueados.
  v_r := public.credito_aplicable(
           v_c.kind, v_c.source, v_c.amount, v_c.consumed_amount,
           v_c.currency, v_c.product_id,
           v_p.gross_amount, v_b.num_sessions, v_p.currency, v_b.product_id);

  if not (v_r ->> 'usable')::boolean then
    raise exception '%', coalesce(v_r ->> 'motivo', 'este crédito no se puede usar aquí')
      using errcode = 'check_violation';
  end if;
  v_cubre := (v_r ->> 'cubre')::bigint;

  -- 🔴 CERROJO 2 — Y AHORA NO ESTÁ VACÍO. Ver §3. Las tres señales valen; la
  -- que de verdad sostiene el caso normal es `checkout_opened_at`, porque las
  -- otras dos se escriben tarde o no se escriben. Y se consiente el caso en que
  -- el cobro abierto YA es por el importe que quedaría: eso significa que el
  -- marcador y el crédito cuadran y no hay nada que explotar (es lo que pasa
  -- cuando dos pestañas aplican el mismo crédito).
  v_abierto := v_p.provider_payment_id is not null
            or coalesce(v_p.provider_metadata, '{}'::jsonb) ? 'checkout'
            or v_p.checkout_opened_at is not null;

  if v_abierto and coalesce(v_p.checkout_amount, -1) <> (v_p.gross_amount - v_cubre) then
    raise exception 'ya hay un cobro abierto para esta reserva por otro importe'
      using errcode = 'check_violation',
            hint = 'Ciérralo o espera a que caduque la reserva antes de cambiar el crédito.';
  end if;

  -- ── EL FONDEO (quién pone el dinero con el que se paga al tutor) ──────────
  --
  -- `funding_provider` es el PSP donde está la CAJA de este cobro;
  -- `platform_funded_amount` es lo que falta en esa caja para pagarle al tutor.
  --
  -- 🔴 NO SE REIMPLEMENTA AQUÍ. La aritmética vive en
  -- `public.fondeo_del_cobro()` (`20260912100000:249`), cuyo propio
  -- `comment on column` dice que es la única válida y que esta función tiene que
  -- llamarla. Había dos versiones y NO daban lo mismo: ésta sumaba las dos cajas
  -- (la del regalo y la del cobro) y eso INFRA-FONDEA el payout, porque un
  -- payout se ejecuta contra UN SOLO BALANCE. Regalo de 6000 cobrado por dLocal,
  -- el tutor sube el precio a 20000, el destinatario paga 14000 por Stripe y el
  -- neto del tutor es 16000: sumando cajas sale «la plataforma pone 0» cuando a
  -- Stripe —que es quien va a pagar— le faltan 2000. `fondeo_del_ciclo` no
  -- enseñaría el hueco, operaciones no transferiría nada y la orden se iría a
  -- `failed` por saldo semanas después, que es exactamente el fallo que las dos
  -- migraciones dicen venir a evitar.
  --
  -- Con una sola caja las dos fórmulas siguen coincidiendo donde tienen que
  -- coincidir (regalo que cubre el neto → se paga desde el PSP del regalo y el
  -- fondeo es 0), que es el caso que el diagrama describe.
  select f.funding_provider, f.caja, f.platform_funded_amount
    into v_funding, v_caja, v_falta
  from public.fondeo_del_cobro(
         v_p.gross_amount,
         v_p.tutor_net_amount,
         v_cubre,            -- lo que el crédito pone EN ESTE cobro
         v_p.provider,       -- quién procesa el cargo
         v_c.source,         -- 'gift' = ya hay caja; 'referral' = la pone la casa
         -- 🔴 LO QUE DEL REGALO SIGUE SIN COMPROMETER, no lo que se cobró.
         --    Cambiado el 16-sep-2026 y es DINERO: hasta entonces un regalo era
         --    siempre `kind='mentoria'` y se gastaba de una vez, así que la caja
         --    se contaba una sola vez y las dos expresiones coincidían
         --    (`consumed_amount` vale 0 al aplicarlo). Desde
         --    `20260916100000_el_regalo_sobrevive_al_tutor.sql` un regalo puede
         --    convertirse en BONO (`kind='saldo'`) cuando el tutor se da de baja,
         --    y un bono SÍ se parte entre varias reservas: con `v_c.amount` la
         --    misma caja se contaría ENTERA en cada una. Regalo de 10000, dos
         --    reservas de neto 9600: `platform_funded_amount` = 0 en las dos
         --    cuando de verdad faltan 9200 — `fondeo_del_ciclo` no enseñaría el
         --    hueco, operaciones no transferiría nada y la orden se iría a
         --    `failed` por saldo semanas después. Es exactamente el fallo que
         --    `20260912100000` dice venir a evitar, entrando por la otra puerta.
         v_c.amount - v_c.consumed_amount,
         v_c.provider        -- y dónde está esa caja
       ) f;

  update public.payments p
     set credit_id              = p_credit_id,
         credit_amount          = v_cubre,
         funding_provider       = v_funding,
         platform_funded_amount = v_falta
   where p.id = v_p.id;

  -- ⚠️ 'mentoria' CONSUME EL TOPE ENTERO. `amount` es un tope, no un importe:
  -- el sobrante es de la plataforma. Escribir `consumed_amount + v_cubre`
  -- violaría `credits_mentoria_entera` en cuanto la mentoría cueste menos que
  -- el tope, que es siempre — y ese es el `check` que hacía que la mentoría
  -- gratis no funcionara nunca.
  update public.credits c
     set consumed_amount = case when c.kind = 'mentoria'
                                then c.amount
                                else c.consumed_amount + v_cubre end,
         status = case when (case when c.kind = 'mentoria'
                                  then c.amount
                                  else c.consumed_amount + v_cubre end) >= c.amount
                       then 'consumed' else c.status end,
         -- ⚠️ `consumed_at` SOLO CUANDO SE GASTA DEL TODO. Un saldo parcial
         -- sigue 'active' con dinero dentro, y sellarle la fecha de consumo hace
         -- que `mis_regalos_comprados.canjeado` —que se deriva de esta columna—
         -- diga «canjeado» de algo que todavía se puede gastar.
         consumed_at = case when (case when c.kind = 'mentoria'
                                       then c.amount
                                       else c.consumed_amount + v_cubre end) >= c.amount
                            then now() else c.consumed_at end
   where c.id = p_credit_id;

  return jsonb_build_object(
    'credit_id',              p_credit_id,
    'gross_amount',           v_p.gross_amount,
    'credit_amount',          v_cubre,
    'a_pagar',                v_p.gross_amount - v_cubre,
    'funding_provider',       v_funding,
    'platform_funded_amount', v_falta
  );
end;
$fn$;
