-- ============================================================================
-- Enséñame Ya — C2 · el termómetro de payouts.
--
-- ── LO PRIMERO: POR QUÉ ESTA MIGRACIÓN NO TOCA `process_scheduled_payouts()` ─
--
-- El encargo dejaba abiertas dos opciones: que esa función dejara de ser solo
-- informativa, o que se quedara como C1 la dejó (`20260901120000`) y el trabajo
-- lo hiciera el Route Handler. **Se queda como está**, y por tres razones que
-- conviene dejar escritas para que nadie la "termine" después:
--
--   1. **No puede pagar.** Corre dentro de Postgres por pg_cron y Postgres no
--      puede llamar a la API de un PSP. Cualquier versión suya que "ejecute" solo
--      puede ejecutar mentiras — que es exactamente lo que hacía antes de C1:
--      `status='paid'`, `provider='simulated'`, y el trigger `notify_payout()`
--      mandando NTF-12 «Se pagó tu liquidación» por dinero que no se movió.
--   2. **Ya dice la verdad que le toca decir.** Devuelve cuántas órdenes esperan
--      y por cuánto. Que corra cada 10 minutos y cueste microsegundos es lo que
--      mantiene su fila viva en `cron.job_run_details`, que es donde este
--      proyecto mira cuando un job deja de funcionar (regla de oro 11).
--   3. **Duplicar el razonamiento sería el error de siempre.** Quién puede pagar,
--      con qué balance y a qué tipo de cambio lo decide el ejecutor —el Route
--      Handler, que es el único que habla con el proveedor—. Reimplementarlo en
--      SQL serían dos sitios calculando lo mismo y, el día que discreparan, uno
--      sería el que paga y otro el que se enseña.
--
-- ── LO QUE SÍ FALTA, Y ES LO ÚNICO QUE AÑADE ESTA MIGRACIÓN ────────────────
--
-- C2 introduce un estado que antes no usaba nadie: **'processing'**. Y con él, la
-- fila más peligrosa que puede tener este sistema:
--
--     status = 'processing'  AND  provider_payout_id IS NULL
--
-- Eso significa «esta orden se reclamó, se le pudo pedir el pago al proveedor, y
-- no sabemos si lo creó». Existe porque `POST /v1/payouts` de dLocal Go **no
-- tiene clave de idempotencia de ninguna clase** y porque un 400 suyo puede haber
-- creado el payout igual: ante esa duda, el ejecutor NO reintenta —reintentar es
-- elegir pagar dos veces— y deja la fila quieta hasta que su barrido pueda
-- afirmar algo o hasta que la mire una persona.
--
-- `process_scheduled_payouts()` cuenta 'scheduled' y solo 'scheduled', así que
-- esas filas **desaparecerían del único sitio donde alguien mira**. Es la forma
-- exacta del fallo que ya ha mordido tres veces en este proyecto: algo se rompe y
-- no se lo dice a nadie. De ahí `payouts_backlog()`.
--
-- ── POR QUÉ NO SE PROGRAMA EN NINGÚN CRON ──────────────────────────────────
-- A propósito, y es el mismo trato que tiene `refunds_backlog()`: es una consulta
-- para el SQL editor y para el pie del workflow, no un job. Un job más sería una
-- fila más que vigilar; y sobre todo, esta función **no se ha ejecutado nunca**
-- (ver abajo), así que ponerla en un reloj sería crear un pg_cron sin estrenar.
--
-- ⚠️ NO APLICADA. Esta migración se escribió sin `db:push` (el encargo lo
-- prohibía), así que `create or replace` ni siquiera ha validado su sintaxis
-- contra el servidor. Al aplicarla, lo primero es ejecutarla una vez:
--
--     select public.payouts_backlog();
--
-- Y como no cuelga de ningún cron, si estuviera mal el fallo se ve ahí mismo, en
-- la primera llamada, y no dentro de dos semanas en `cron.job_run_details`.
-- ============================================================================

create or replace function public.payouts_backlog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(

    -- El reparto completo, sin interpretar. Si aquí aparece un estado que no
    -- esperabas, empieza por ahí.
    'por_estado', (
      select coalesce(jsonb_object_agg(t.estado, t.n), '{}'::jsonb)
        from (
          select p.status::text as estado, count(*) as n
            from public.payouts p
           group by 1
        ) t
    ),

    -- 🔴 LA CIFRA QUE NUNCA PUEDE QUEDARSE ARRIBA. Órdenes reclamadas de las que
    -- no se sabe si el proveedor llegó a crear el payout. No se resuelven solas
    -- (a propósito): hay que mirar el panel del PSP y anotar el id, o confirmar
    -- que no existe y devolver la fila a 'scheduled'.
    --   select id, tutor_id, amount, currency, provider_metadata
    --     from public.payouts
    --    where status = 'processing' and provider_payout_id is null;
    --
    -- 🔑 Y NO HAY QUE BUSCARLAS POR IMPORTE Y FECHA: cada payout que manda C2
    -- lleva su marca dentro. En dLocal Go va en `description` y es
    -- `EY-<payouts.id>-<intento>`, con el intento en
    -- `provider_metadata -> 'c2' -> 'intento'` (1 si no está). O sea que la fila
    -- de arriba se busca en el panel del proveedor pegando esa cadena, y la
    -- respuesta es sí o no — no «se le parece». Los ids de intentos anteriores
    -- que el proveedor dio por muertos quedan en
    -- `provider_metadata -> 'c2' -> 'intentos_muertos'`.
    'sin_identificar', (
      select count(*) from public.payouts p
       where p.status = 'processing'::public.payout_status
         and p.provider_payout_id is null
    ),

    -- En vuelo CON identificador: creadas en el proveedor y esperando a que el
    -- dinero llegue. dLocal Go las crea en PENDING, así que esto es lo normal
    -- entre el envío y el cobro; solo preocupa si no baja nunca.
    'en_vuelo', (
      select count(*) from public.payouts p
       where p.status = 'processing'::public.payout_status
         and p.provider_payout_id is not null
    ),

    -- Lo que el ejecutor tiene delante ahora mismo. Mismo criterio que
    -- `process_scheduled_payouts()`, para que las dos cifras se puedan contrastar.
    'en_cola', (
      select count(*) from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    ),
    'en_cola_importe', (
      select coalesce(jsonb_object_agg(t.currency, t.total), '{}'::jsonb)
        from (
          select p.currency::text as currency, sum(p.amount) as total
            from public.payouts p
           where p.status = 'scheduled'::public.payout_status
             and p.scheduled_for <= now()
           group by 1
        ) t
    ),

    -- Emitidas pero todavía no vencidas (retención de DP-02). No son un problema.
    'programadas_a_futuro', (
      select count(*) from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and (p.scheduled_for is null or p.scheduled_for > now())
    ),

    -- Rechazadas por el proveedor. Requieren `manage_payout(id,'retry')` o una
    -- decisión humana; no salen solas.
    'fallidas', (
      select count(*) from public.payouts p
       where p.status = 'failed'::public.payout_status
    ),

    -- ── POR QUÉ NO SALE LO QUE ESTÁ EN COLA ────────────────────────────────
    --
    -- Estos cinco números explican una cola que no baja. Ninguno es un fallo del
    -- pago: son condiciones previas que el ejecutor comprueba ANTES de llamar a
    -- nadie, y que ninguna pasada del job va a resolver sola.
    --
    -- ⚠️ Se calculan aquí para poder mirarlos sin depender de que el workflow
    -- corra, PERO el que manda es el ejecutor: si algún día discrepan, gana el
    -- Route Handler, que es quien habla con el proveedor. Esta función explica;
    -- no decide.
    'bloqueos', (
      select jsonb_build_object(

        -- Sin país de destino congelado no se puede pagar a ningún sitio.
        -- ⚠️ Hoy en dev son TODAS: el backfill de `20260901130000` copió
        -- `payments.payee_country`, que está a null en las 115 filas.
        'sin_pais',
          count(*) filter (where p.payee_country is null),

        -- A su destino no le corresponde ningún PSP que sepa pagar. Hoy eso es
        -- Venezuela y el tutor que no ha declarado país: las dos filas de ruteo
        -- con `payout_provider = 'simulated'`, que es la ausencia de ejecutor.
        'sin_ejecutor',
          count(*) filter (where r.payout_provider is null
                              or r.payout_provider = 'simulated'),

        -- 🔴 EL DINERO ESTÁ EN OTRO BALANCE. Un payout se paga desde el balance
        -- del PSP que cobró ese dinero (`funding_provider`); si el que ejecuta es
        -- otro, la orden no es «difícil», es IMPAGABLE.
        -- ⚠️ Hoy esto lo cumple TODO lo que se construya: las diez filas de
        -- `payment_routing_rules` dicen `charge_provider='stripe'` con
        -- `payout_provider='dlocal'`. O se cobra por donde se paga, o se fondea el
        -- balance de dLocal Go a propósito. Es una decisión de tesorería, no de
        -- código.
        'balance_ajeno',
          count(*) filter (where r.payout_provider is not null
                             and r.payout_provider <> 'simulated'
                             and p.funding_provider is distinct from r.payout_provider),

        -- El saldo del tutor está en USD y el país cobra en su moneda. Convertir
        -- exige decidir quién asume el spread de dLocal (~4,6-4,7 % peor que su
        -- propio /v1/currency-exchanges), y esa decisión de producto no está
        -- tomada. Ecuador es el único de los ocho países que cobra en USD, o sea
        -- el único que hoy no necesita esa respuesta.
        'cambio_sin_decidir',
          count(*) filter (where c.currency is not null
                             and c.currency <> p.currency),

        -- El tutor no ha registrado datos de cobro (B1). Se arregla solo en cuanto
        -- los guarde: la orden sigue en la cola, no en 'failed'.
        'sin_datos_de_cobro',
          count(*) filter (where a.tutor_id is null),

        -- El importe agregado no cuadra con sus líneas. Es integridad nuestra, no
        -- del PSP, y el ejecutor se niega a mandarlo (regla de oro 2).
        'descuadradas',
          count(*) filter (where p.amount is distinct from coalesce(i.suma, 0))
      )
        from public.payouts p
        left join lateral (
          select rr.payout_provider
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
        left join public.payout_country_rules   c on c.country  = p.payee_country
        left join public.tutor_payout_accounts  a on a.tutor_id = p.tutor_id
        left join lateral (
          select sum(pi.amount) as suma
            from public.payout_items pi
           where pi.payout_id = p.id
        ) i on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    )
  );
$$;

comment on function public.payouts_backlog() is
  'C2 · termómetro de la cola de payouts, para el SQL editor y el pie del workflow de Actions. NO está programado en ningún cron, igual que refunds_backlog(). Devuelve el reparto por estado, lo que hay en cola con su importe, lo que está en vuelo, y —la cifra que importa— sin_identificar: órdenes en ''processing'' sin provider_payout_id, o sea reclamadas sin saber si el proveedor llegó a crear el payout. Esas NO se reintentan solas a propósito (POST /v1/payouts no tiene clave de idempotencia y un 400 suyo puede haber creado el payout igual), así que mientras ese número no sea 0 puede haber un pago sin conciliar. El bloque bloqueos explica por qué una cola no baja: sin país, sin ejecutor, balance ajeno, cambio sin decidir, sin datos de cobro o descuadrada. Explica, no decide: quien manda sobre si una orden se manda es el Route Handler /api/cron/payouts-process.';

-- 🔴 Las cuatro líneas de siempre. Esta función no devuelve PII —solo cuenta—
-- pero sí dice cuánto se le debe a la plataforma y a cuántos tutores, y en
-- Postgres el EXECUTE de una función nueva se concede a PUBLIC por defecto, que
-- con PostgREST significa `POST /rest/v1/rpc/payouts_backlog` abierto a `anon`.
revoke execute on function public.payouts_backlog() from public;
revoke execute on function public.payouts_backlog() from anon;
revoke execute on function public.payouts_backlog() from authenticated;
grant  execute on function public.payouts_backlog() to service_role;

-- ── Lo que hay que mirar el día que esto se aplique (regla de oro 11) ───────
--
-- a) Que la función corre. Es la única verificación que `create or replace` NO
--    hace por ti: valida la sintaxis, no ejecuta el cuerpo.
--
--      select public.payouts_backlog();
--
-- b) Que el ejecutor y este termómetro cuentan lo mismo. Si discrepan, gana el
--    ejecutor y esta función está mal:
--
--      GET /api/cron/payouts-process?simulacro=1   (con la cabecera CRON_SECRET)
--
-- c) Que `process-payouts` —el pg_cron de C1, que sigue vivo— no se ha roto por
--    el camino. Agregando por jobname, que leer las diez últimas filas solo
--    enseña los jobs frecuentes:
--
--      select j.jobname, d.status, count(*), max(d.start_time), max(d.return_message)
--        from cron.job_run_details d join cron.job j using (jobid)
--       where j.jobname in ('run-payout-batch', 'process-payouts')
--       group by 1, 2;
