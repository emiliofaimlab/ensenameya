-- ============================================================================
-- Enséñame Ya — un payout de 0 no existe (versión de la rama de grupales)
--
-- `20261020120000` viene de `dev` y reescribe `build_payout_for_tutor` partiendo
-- de la versión de `dev`, que NO sabe de academias ni de grupales prorrateadas.
-- Aplicada aquí pisaría la de `20261017110000` (lote 1). Esta migración la
-- REAFIRMA —esa versión ya filtra `gross_amount > 0`, P32— con el único cambio
-- que exige `payouts_amount_positivo`: la orden que es solo recompensa nace con
-- su importe en vez de crearse a 0 y subirse después.
--
-- ⚠️ Cuando esta rama se mergee, esta es la versión que tiene que quedar viva.
-- ============================================================================

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
  v_nueva    boolean;
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
      and b.academy_id is null   -- A · RA-10: lo de academia es de la academia
      and p.gross_amount > 0     -- P32 · una clase gratis no genera un payout de 0 (como RA-08)
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
      v_nueva := v_destino is null;
      if v_nueva then
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
        values (p_tutor_id, p_status, v_cred.currency, v_cred.importe,
                v_riel, v_pais,
                v_cred.importe, v_cred.importe,
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
       where id = v_destino
         and not v_nueva;   -- la recién creada ya nació con él

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
