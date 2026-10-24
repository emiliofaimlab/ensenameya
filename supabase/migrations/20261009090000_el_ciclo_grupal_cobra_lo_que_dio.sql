-- ============================================================================
-- Enséñame Ya — el tutor cobra las fechas que sí dio de un ciclo grupal
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- RG-15/RG-16 (`docs/PLAN-ACADEMIAS-Y-GRUPALES.md`). Cuando el tutor cancela
-- una fecha de un ciclo (`cancelar_fecha_grupal`, `20261008180000`), cada pago
-- queda `partially_refunded`, y el payout solo cogía `status = 'paid'`
-- («reembolsados fuera», S-29): el tutor perdía el ciclo ENTERO, no solo la
-- fecha cancelada. Ahora cobra su neto × (1 − devuelto / cobrado).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · SOLO GRUPALES. Un `partially_refunded` 1:1 (baja del alumno al 50 %,
--   RN-37) sigue fuera del payout, como hasta hoy. Y solo reservas
--   `completed`: la baja de un alumno de una grupal deja la reserva
--   `cancelled` y tampoco entra.
-- · Las TRES funciones que cuentan lo que se le debe al tutor cambian a la
--   vez, con la misma regla y la misma cuenta (`parte_del_tutor`): si solo
--   cambiara el payout, «Mis ingresos» y el bloqueo de baja de cuenta dirían
--   otra cifra.
--     build_payout_for_tutor  · vivo en dev, última migración 20260912100000:482
--     tutor_balance           · vivo en dev, última migración 20260912100000:1289
--     account_deletion_state  · vivo en dev
-- · `platform_funded_amount` (lo que la plataforma pone por un crédito suyo)
--   se prorratea igual: `reembolsar_con_credito` devolvió al crédito su parte
--   de cada tramo, así que esa parte ya no hay que fondearla.
-- · Academias reescribirá `build_payout_for_tutor` (+ `academy_id is null` y
--   su gemela): se parte de ESTA versión.
-- ============================================================================

create or replace function public.parte_del_tutor(
  p_importe  bigint,
  p_gross    bigint,
  p_devuelto bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
           when coalesce(p_devuelto, 0) <= 0 or coalesce(p_gross, 0) <= 0 then coalesce(p_importe, 0)
           else coalesce(p_importe, 0)
                - round(coalesce(p_importe, 0) * least(p_devuelto, p_gross)::numeric / p_gross)::bigint
         end
$$;

comment on function public.parte_del_tutor(bigint, bigint, bigint) is
  'G · lo que queda de un importe del tutor (neto o parte fondeada) tras devolver p_devuelto de un cobro de p_gross: importe × (1 − devuelto/gross). Sin devolución, el importe tal cual: los pagos ''paid'' no cambian.';

CREATE OR REPLACE FUNCTION public.build_payout_for_tutor(p_tutor_id uuid, p_retention_days integer, p_status payout_status DEFAULT 'scheduled'::payout_status)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cutoff   timestamptz := now() - make_interval(days => p_retention_days);
  v_rec      record;
  v_payout   uuid;
  -- ⚠️ Ver el aviso 1 de la cabecera. Mientras esto sea false, todo el bloque
  -- de recompensas ni se prepara, y esta función se comporta EXACTAMENTE como
  -- la de hoy salvo por las dos columnas nuevas.
  v_hay_cred boolean := to_regclass('public.credits') is not null;
  v_cred     record;
  v_destino  uuid;
  v_pais     char(2);
  v_riel     text;
begin
  -- Se agrupa por MONEDA, por BALANCE DE ORIGEN y por PAÍS DE DESTINO. La
  -- moneda porque sumar monedas distintas no significa nada (RN-13); el balance
  -- porque el dinero vive donde vive y un payout que mezcle dos no lo puede
  -- ejecutar ninguno de los dos; y el país porque es quien elige al EJECUTOR
  -- (`payment_routing_rules.payout_providers`), y mezclar destinos produce una
  -- orden que no se sabe a dónde mandar.
  --
  -- Los tres son la misma idea aplicada tres veces: en la clave va todo lo que
  -- tiene que ser IGUAL en las líneas para que la orden resultante sea pagable.
  -- Un payout de más es un inconveniente; un payout impagable es dinero parado
  -- sin que nadie se entere.
  --
  -- 🔑 LO QUE CAMBIA HOY: la clave del balance deja de ser `p.provider` —quién
  -- PROCESÓ el cargo— y pasa a ser `p.funding_provider` —dónde está la CAJA—.
  -- Con `funding_provider` backfilleado a `provider` las dos son idénticas en
  -- las 127 filas de dev, que es justo lo que hay que verificar antes de
  -- construir nada encima.
  for v_rec in
    select p.currency,
           coalesce(p.funding_provider, p.provider) as funding_provider,
           p.payee_country                          as payee_country,
           sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)) as total,
           sum(public.parte_del_tutor(p.platform_funded_amount, p.gross_amount, p.refunded_amount)) as falta,
           array_agg(p.id)                          as payment_ids
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where b.tutor_id = p_tutor_id
      -- reembolsados fuera (S-29)… salvo G · el ciclo grupal con fechas
      -- canceladas por el tutor, que cobra la parte que sí dio.
      and (p.status = 'paid'
           or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
      and b.status = 'completed'
      and b.completed_at <= v_cutoff              -- retención vencida (DP-02)
      and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
    group by p.currency, coalesce(p.funding_provider, p.provider), p.payee_country
  loop
    insert into public.payouts (tutor_id, status, currency, amount,
                                funding_provider, payee_country,
                                platform_funded_amount,
                                retention_until, scheduled_for)
    values (p_tutor_id, p_status, v_rec.currency, v_rec.total,
            v_rec.funding_provider, v_rec.payee_country,
            coalesce(v_rec.falta, 0), v_cutoff, now())
    returning id into v_payout;
    -- `provider` se queda a null a propósito: lo escribe quien ejecute (C2).

    insert into public.payout_items (payout_id, payment_id, amount)
    select v_payout, pid, public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)
    from unnest(v_rec.payment_ids) as pid
    join public.payments p on p.id = pid;
  end loop;

  -- ── SEGUNDO BUCLE · LAS RECOMPENSAS EN DINERO DEL TUTOR ───────────────────
  --
  -- El diagrama dice «le llega solo, en el siguiente ciclo». H-4 demuestra que
  -- la versión ingenua —crear un payout por la recompensa y ya— produce una
  -- orden con `funding_provider` y `payee_country` a NULL que
  -- `payouts-process/route.ts` descarta en DOS puertas seguidas (:437 por
  -- balance, :453 por país) sin marcar nada, y que se queda 'scheduled' para
  -- siempre en un contador que solo sale por `console.error`. Así que el orden
  -- de preferencia es este, y es el de H-4:
  --
  --   1) ENGANCHARLA A UNA ORDEN QUE YA EXISTE de ese tutor y esa moneda. Es el
  --      caso normal —la recompensa llega con clases dentro— y hereda un
  --      `funding_provider` y un `payee_country` que ya son buenos. Va detrás
  --      del primer bucle a propósito: así también engancha con las órdenes
  --      recién creadas en esta misma pasada.
  --   2) Si no hay ninguna, CREARLA, pero solo si se sabe a dónde (el
  --      `payout_country` del tutor) y por dónde (un riel de su ruta).
  --   3) Si no se sabe, NO CREARLA. El crédito se queda 'active' y vuelve a
  --      intentarlo en la pasada siguiente. Una recompensa que sigue viva vale
  --      infinitamente más que una orden 'scheduled' que nadie ejecuta.
  --
  if v_hay_cred then
    for v_cred in
      select c.id, c.currency, (c.amount - c.consumed_amount) as importe
        from public.credits c
       where c.beneficiary_id = p_tutor_id
         and c.destino = 'payout'
         and c.status  = 'active'
         and c.amount  > c.consumed_amount
         and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id)
       order by c.created_at
         for update of c
    loop
      -- (1) ¿Hay ya una orden a la que engancharla?
      -- 'on_hold' queda fuera: está retenida por un motivo y meterle una
      -- recompensa dentro la retiene también. 'processing' y 'paid' ni se
      -- miran: ya están en manos del proveedor.
      select po.id
        into v_destino
        from public.payouts po
       where po.tutor_id = p_tutor_id
         and po.currency = v_cred.currency
         and po.status in ('pending', 'scheduled')
         and po.funding_provider is not null
         and po.payee_country    is not null
       order by po.created_at desc
       limit 1;

      -- (2) Si no, se crea — con destino y riel resueltos, o no se crea.
      if v_destino is null then
        select tp.payout_country into v_pais
          from public.tutor_profiles tp
         where tp.profile_id = p_tutor_id;

        v_riel := null;
        if v_pais is not null then
          -- 🔑 EL PRIMER CANDIDATO QUE NO ESTÉ ATADO A UN BALANCE. Una orden que
          -- es SOLO recompensa no tiene caja detrás en ningún PSP: es dinero que
          -- la plataforma regala. Un riel atado a balance (hoy 'stripe' y
          -- 'dlocal', `src/lib/payments.ts:276` y `:295`) exigiría transferirle
          -- el importe entero antes del ciclo; los fondeados aparte (wise,
          -- paypal, manual, banco-manual) recargan desde nuestro banco y no
          -- dependen de quién cobró, que es exactamente lo que hace falta aquí.
          -- ⚠️ Ese par ('dlocal','stripe') está DUPLICADO en SQL a sabiendas:
          -- `payouts_backlog()` ya lo lleva escrito igual, en su contador
          -- `balance_ajeno`. Si algún día un riel cambia de bando hay que tocar
          -- los dos sitios Y `src/lib/payments.ts`, que es el que manda.
          -- H-4 decía «dejarla fuera si el riel está atado»; se implementa un
          -- paso más fino: se busca el primer candidato NO atado de la lista, y
          -- solo si no hay ninguno se deja fuera. Mismo invariante, menos
          -- recompensas paradas.
          select cand
            into v_riel
            from unnest((public.ruta_de_pago(v_pais)).payout_providers)
                   with ordinality as t(cand, ord)
           where cand not in ('dlocal', 'stripe', 'simulated')
           order by t.ord
           limit 1;
        end if;

        -- (3) Sin país o sin riel servible: el crédito no se toca y se reintenta
        -- en la pasada siguiente. Queda visible como `credits` 'active'.
        if v_riel is null then
          continue;
        end if;

        insert into public.payouts (tutor_id, status, currency, amount,
                                    funding_provider, payee_country,
                                    platform_funded_amount, adjustment_amount,
                                    retention_until, scheduled_for)
        values (p_tutor_id, p_status, v_cred.currency, 0,
                v_riel, v_pais,
                0, 0,
                now(), now())   -- una recompensa no tiene clase que retener
        returning id into v_destino;
      end if;

      insert into public.payout_adjustments (payout_id, credit_id, amount)
      values (v_destino, v_cred.id, v_cred.importe);

      -- `amount` sube porque hay que pagarlo; `platform_funded_amount` sube LO
      -- MISMO porque no hay caja detrás. Las dos cosas a la vez o la vista de
      -- fondeo miente.
      update public.payouts
         set amount                 = amount + v_cred.importe,
             adjustment_amount      = adjustment_amount + v_cred.importe,
             platform_funded_amount = platform_funded_amount + v_cred.importe
       where id = v_destino;

      update public.credits
         set consumed_amount = amount,
             status          = 'consumed',
             consumed_at     = now()
       where id = v_cred.id;

      v_payout := v_destino;
    end loop;
  end if;

  -- Se crea un payout por cada (moneda, balance, país) y se devuelve el último.
  -- Quien lo llama solo mira si es null: `request_withdrawal` para saber si
  -- había saldo, `run_payout_batch` para contar tutores. Ninguno usa el id.
  -- ⚠️ Desde hoy también devuelve no-null cuando lo único que pasó fue
  -- ENGANCHAR una recompensa a una orden que ya existía. Es correcto para los
  -- dos llamadores: había algo que pagar.
  return v_payout;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tutor_balance(p_retention_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_cutoff   timestamptz := now() - make_interval(days => p_retention_days);
  -- Las recompensas, en dos arrays paralelos (moneda ↔ importe). Arrays y no un
  -- `union` dentro del `select` por lo mismo que el bloque 11: `public.credits`
  -- puede no existir, y una rama no tomada de PL/pgSQL no se prepara. Con esto,
  -- una sola versión de la función vale en los dos órdenes de aplicación.
  v_monedas  char(3)[] := '{}'::char(3)[];
  v_importes bigint[]  := '{}'::bigint[];
  v_hay_cred boolean   := to_regclass('public.credits') is not null;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  if v_hay_cred then
    select coalesce(array_agg(t.currency order by t.currency), '{}'::char(3)[]),
           coalesce(array_agg(t.total    order by t.currency), '{}'::bigint[])
      into v_monedas, v_importes
      from (
        -- ⚠️ EL `::bigint` NO ES ADORNO: `sum(bigint)` devuelve `numeric`, y
        -- meter un `numeric[]` en una variable `bigint[]` solo funciona porque
        -- PL/pgSQL cae a la conversión por texto. Funcionar por accidente en
        -- una función que suma dinero es cómo se descubre un fallo el día que
        -- alguien cambia un tipo. Se dice el tipo.
        select c.currency, sum(c.amount - c.consumed_amount)::bigint as total
          from public.credits c
         where c.beneficiary_id = v_uid
           and c.destino = 'payout'
           and c.status  = 'active'
           and c.amount  > c.consumed_amount
           and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id)
         group by c.currency
      ) t;
  end if;

  return jsonb_build_object(
    -- Disponible: pago 'paid' de reserva completada, retención vencida, no
    -- pagado aún — MÁS las recompensas en dinero que el lote va a meter en la
    -- próxima orden. Los dos orígenes se agregan por moneda antes de agrupar:
    -- sumar monedas distintas no significa nada (RN-13).
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('currency', a.currency, 'amount', a.total) order by a.currency)
      from (
        select x.currency, sum(x.monto) as total
        from (
          select p.currency, public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount) as monto
          from public.payments p
          join public.bookings b on b.id = p.booking_id
          where b.tutor_id = v_uid and b.status = 'completed'
            and (p.status = 'paid' or (p.status = 'partially_refunded' and b.pricing_model = 'group'))  -- G ·
            and b.completed_at <= v_cutoff
            and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
          union all
          select r.moneda, r.importe
          from unnest(v_monedas, v_importes) as r(moneda, importe)
        ) x
        group by x.currency
      ) a
    ), '[]'::jsonb),
    -- En retención: liquidable salvo que la retención aún no venció. Sin
    -- recompensas: no hay clase detrás, así que no hay nada que retener.
    'in_retention', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select p.currency, sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)) as total
        from public.payments p
        join public.bookings b on b.id = p.booking_id
        where b.tutor_id = v_uid and b.status = 'completed'
            and (p.status = 'paid' or (p.status = 'partially_refunded' and b.pricing_model = 'group'))  -- G ·
          and b.completed_at > v_cutoff
          and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
        group by p.currency
      ) r
    ), '[]'::jsonb),
    -- Ya pagado: payouts liquidados. `payouts.amount` YA lleva dentro el
    -- `adjustment_amount`, así que la recompensa pagada se cuenta aquí sola y
    -- sumarla otra vez sería duplicarla.
    'paid_out', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select currency, sum(amount) as total
        from public.payouts
        where tutor_id = v_uid and status = 'paid'
        group by currency
      ) pd
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.account_deletion_state(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with
  -- Clases futuras ya vendidas. Se mira `sessions` y no `bookings` porque la
  -- fecha vive ahí: `create_booking` mete una sesión por hueco del paquete.
  futuras_tutor as (
    select count(*) as n from public.sessions s
     where s.tutor_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  futuras_alumno as (
    select count(*) as n from public.sessions s
     where s.student_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  -- Saldo pendiente. La definición de «liquidable» se copia LITERALMENTE de
  -- `tutor_balance` (`20260716150000`), que a su vez la comparte con
  -- `build_payout_for_tutor`: una sola fuente para los tres. Se juntan
  -- `available` e `in_retention` porque para darse de baja da igual que la
  -- retención haya vencido o no — es dinero suyo que todavía no ha cobrado.
  --
  -- `ultimo_completado` es lo que permite decirle CUÁNDO: la retención de 7
  -- días (DP-02, el default de `run_payout_batch`) corre desde `completed_at`,
  -- así que el saldo entero es liquidable a partir del último + 7 días. La
  -- pantalla lo redondea al lote semanal; aquí se da el dato crudo.
  sin_liquidar as (
    select coalesce(sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)), 0) as importe,
           count(distinct p.currency)           as monedas,
           min(p.currency)                      as moneda,
           max(b.completed_at)                  as ultimo_completado
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.tutor_id = p_user_id
       and (p.status = 'paid' or (p.status = 'partially_refunded' and b.pricing_model = 'group'))  -- G ·
       and b.status   = 'completed'
       and not exists (
         select 1 from public.payout_items pi where pi.payment_id = p.id
       )
  ),
  -- Dinero ya en vuelo: un retiro emitido que aún no ha aterrizado.
  -- ⚠️ 'failed' está DENTRO, a diferencia de EY-192: un payout fallido es
  -- dinero que se le debe y que espera un `admin_payout_action('retry')`.
  -- Dejarlo fuera dejaba anonimizar a quien no habías pagado.
  payouts_vivos as (
    select count(*) as n from public.payouts po
     where po.tutor_id = p_user_id
       and po.status in ('pending', 'scheduled', 'processing', 'on_hold', 'failed')
  ),
  -- Reembolso pendiente HACIA el alumno. No bloquea por el dinero —el abono va
  -- contra el pago del PSP, no contra el perfil— sino porque irse mientras te
  -- deben algo deja a la persona sin a dónde reclamar.
  reembolsos_vivos as (
    select count(*) as n
      from public.refund_requests rr
      join public.bookings b on b.id = rr.booking_id
     where b.student_id = p_user_id
       and rr.status = 'pending'
  ),
  -- 🔴 NUEVO · UN REGALO PAGADO POR UN TERCERO QUE ESTA PERSONA NO HA AGENDADO.
  -- La fecha manda sobre el status (el barrido es diario): uno ya vencido no
  -- bloquea nada porque ya no vale.
  regalos_sin_usar as (
    select count(*) as n from public.credits c
     where c.beneficiary_id = p_user_id
       and c.source  = 'gift'
       and c.status  = 'active'
       and c.destino = 'cobro'
       and c.amount > c.consumed_amount
       and (c.expires_at is null or c.expires_at > now())
  ),
  -- 🔴 NUEVO · LA RECOMPENSA EN DINERO DEL TUTOR QUE TODAVÍA NO HA ENTRADO EN
  -- UN CICLO. `payout_adjustments.credit_id` es único: en cuanto el lote la
  -- mete, el crédito pasa a 'consumed' y esta cuenta baja sola.
  recompensas_payout as (
    select coalesce(sum(c.amount - c.consumed_amount), 0) as importe,
           count(*)                                       as n
      from public.credits c
     where c.beneficiary_id = p_user_id
       and c.destino = 'payout'
       and c.status  = 'active'
       and c.amount > c.consumed_amount
  )
  select jsonb_build_object(
    'accionables', jsonb_strip_nulls(jsonb_build_object(
      'clases_futuras_como_tutor',
        case when (select n from futuras_tutor)  > 0 then (select n from futuras_tutor)  end,
      'clases_futuras_como_alumno',
        case when (select n from futuras_alumno) > 0 then (select n from futuras_alumno) end,
      'regalos_sin_agendar',
        case when (select n from regalos_sin_usar) > 0 then (select n from regalos_sin_usar) end
    )),
    'en_espera', jsonb_strip_nulls(jsonb_build_object(
      'saldo_sin_liquidar',
        case when (select importe from sin_liquidar) > 0
             then (select importe from sin_liquidar) end,
      -- Solo cuando hay UNA moneda: con varias, sumar no significa nada
      -- (RN-13) y la pantalla se calla el importe en vez de mentirlo.
      'saldo_moneda',
        case when (select importe from sin_liquidar) > 0
              and (select monedas from sin_liquidar) = 1
             then (select moneda from sin_liquidar) end,
      'saldo_liquidable_desde',
        case when (select importe from sin_liquidar) > 0
             then (select ultimo_completado + interval '7 days' from sin_liquidar) end,
      'payouts_en_curso',
        case when (select n from payouts_vivos)   > 0 then (select n from payouts_vivos)   end,
      'reembolsos_pendientes',
        case when (select n from reembolsos_vivos) > 0 then (select n from reembolsos_vivos) end,
      'recompensas_sin_cobrar',
        case when (select n from recompensas_payout) > 0
             then (select n from recompensas_payout) end
    ))
  );
$function$;

