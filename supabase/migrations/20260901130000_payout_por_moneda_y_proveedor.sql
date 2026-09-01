-- Enséñame Ya — el payout deja de mezclar balances, y `service_role` deja de
-- estar a ciegas sobre `payouts` (regla de oro 9, sexta vez).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1 · UN PAYOUT NO PUEDE SUMAR DINERO QUE ESTÁ EN DOS SITIOS
-- ════════════════════════════════════════════════════════════════════════════
--
-- `build_payout_for_tutor` agrupa por MONEDA y nada más
-- (`20260716140000_ep10_payouts.sql:110-118`). Con un solo PSP eso es correcto
-- y su comentario —«sumar monedas distintas no tiene sentido (RN-13)»— lo
-- explica bien. Con dos deja de serlo, y el motivo no es contable sino de
-- tesorería: **un payout se paga desde el balance del PSP que cobró ese
-- dinero**. dLocal Go paga con `POST /v1/payouts` contra su propio balance;
-- cobrar por Stripe no lo financia. Un payout que sume $30 cobrados por Stripe
-- y $20 cobrados por dLocal no es «un payout de $50»: es una orden que ningún
-- proveedor puede ejecutar, porque a ninguno de los dos le consta ese importe.
--
-- Y no es un problema futuro que llegue con dLocal. **Ya pasa en dev hoy**:
--
--   payments (paid, de reservas completed) → 24 con provider='simulated'
--                                            26 con provider='stripe'
--   y SEIS de los ocho tutores tienen de los dos.
--
-- O sea que los payouts ya construidos pueden mezclar dinero cobrado de verdad
-- por Stripe con dinero que no se cobró en ninguna parte: de los 5 pagos ya
-- liquidados del tutor 1, tres son 'simulated' y dos 'stripe', todos en USD —
-- la moneda como única clave no tenía por qué separarlos. Cuáles quedaron
-- efectivamente mezclados lo dice la consulta del backfill, más abajo.
--
-- ── DE DÓNDE SALE EL PROVEEDOR DE UN PAGO ───────────────────────────────────
--
-- `payments.provider` (`20260709140000:106`). Lo escribe `create_booking` como
-- snapshot congelado, igual que `tier_split_pct`: lee `charge_provider` de
-- `payment_routing_rules` y lo copia (`20260709160000:118-139`). No es
-- nullable en la práctica —si no hay regla activa, `create_booking` levanta
-- «sin ruta de pago disponible» y no llega a insertar nada— aunque la columna
-- sí admita null. Está poblado en las 115 filas de dev.
--
-- ── POR QUÉ NO SIRVE `payouts.provider`, QUE YA EXISTE ──────────────────────
--
-- Porque **no significa lo mismo**, y no es una interpretación: es lo que dicen
-- los datos. La única regla de ruteo que existe hoy en dev es
--
--   payee_country='VE', charge_provider='stripe', payout_provider='simulated'
--
-- Dos columnas distintas con dos valores distintos en la misma fila. `payments`
-- copia la primera; `payouts.provider` está descrito como «resuelto por
-- payee_country (DP-01)» (`20260716140000:29`), que es la segunda. Una dice
-- POR DÓNDE ENTRÓ el dinero, la otra QUIÉN LO VA A SACAR. En un mundo con un
-- solo PSP coinciden y por eso nadie las distinguió nunca.
--
-- Hay una segunda prueba, más fuerte, en cómo se escribe la columna:
-- `build_payout_for_tutor` NO la toca, y el único sitio que la escribía era
-- `process_scheduled_payouts`, en el mismo `update` que ponía `paid_at` y
-- `provider_payout_id` (`20260716140000:174-179`). Es decir: `provider` se
-- rellena en el MOMENTO DE EJECUTAR, junto al identificador que devuelve el
-- proveedor. Es el campo del ejecutor. Hoy, con C1 aplicado
-- (`20260901120000`), ya no lo escribe nadie y está a null en todo lo que esté
-- en 'scheduled'.
--
-- Meter ahí el origen del dinero rompería las dos cosas a la vez: un payout
-- recién creado parecería ya ejecutado, y perderíamos el sitio donde C2 tiene
-- que anotar quién lo pagó de verdad. Así que hace falta OTRA columna.
--
-- ── LA COLUMNA NUEVA ────────────────────────────────────────────────────────
--
-- `payouts.funding_provider` — de qué balance sale este dinero. Se copia de
-- `payments.provider` de sus líneas, y por construcción todas las líneas de un
-- payout comparten valor: es parte de la clave de agrupación.
--
--   payouts.funding_provider  →  dónde ESTÁ el dinero   (= payments.provider
--                                = payment_routing_rules.charge_provider)
--   payouts.provider          →  quién lo SACÓ          (= payout_provider,
--                                lo escribe C2 al ejecutar, junto a paid_at)
--
-- El día que las dos no coincidan en una fila, ese payout no se puede pagar y
-- hay que mirar la regla de ruteo — no es un detalle, es el único chequeo que
-- separa «orden de pago» de «orden imposible».
--
-- ── QUÉ PASA CON null Y CON 'simulated' ─────────────────────────────────────
--
-- No se filtran, se AGRUPAN. Es la diferencia entre esconder el problema y
-- enseñarlo:
--
--  · **'simulated'** (24 pagos en dev) no cobró nada en ninguna parte, así que
--    su balance no existe. Hoy contamina payouts que sí tienen dinero real
--    detrás. Al entrar en la clave de agrupación se separa solo, sin un `case`
--    ni una excepción: queda un payout 'simulated' aparte —visible en el panel,
--    contando para `payouts_en_curso` de la baja de cuenta— que C2 rechazará
--    por no conocer ese proveedor. Filtrarlo aquí, en cambio, dejaría un saldo
--    que `tutor_balance` sigue enseñando como disponible y que ningún lote
--    recogería jamás: dinero invisible, que es peor.
--
--  · **null** no puede ocurrir hoy (ver arriba), pero la columna lo admite y un
--    camino nuevo podría dejarlo. `group by` le da su propio grupo, y el payout
--    nace con `funding_provider` null. Eso es exactamente lo que significa: no
--    consta de qué balance sale. C2 no lo ejecuta y el admin lo ve.
--
-- La regla para C2 es una línea: si `funding_provider` no es un proveedor que
-- sepa pagar, no manda la orden. No adivina.
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
--
-- `tutor_balance` y `account_deletion_state` siguen agregando solo por moneda,
-- a propósito: al tutor le da igual por qué pasarela entró su dinero, y el
-- saldo que ve es el mismo antes y después de esta migración. Solo cambia en
-- cuántas filas de `payouts` se parte. `refund_payment` (S-29) tampoco: saca su
-- `payout_item`, ajusta el importe y borra el payout si se queda vacío, y eso
-- funciona igual con payouts más pequeños.

-- ── La columna ──────────────────────────────────────────────────────────────
alter table public.payouts
  add column if not exists funding_provider text,
  add column if not exists payee_country    char(2);

-- ⚠️ EL ORIGEN NO BASTA: HACE FALTA EL DESTINO. La revisión adversarial del
-- 1-sep cazó que agrupar por `(moneda, proveedor de cobro)` mete en la clave de
-- dónde SALE el dinero y olvida a dónde VA. Y a dónde va lo decide
-- `payment_routing_rules.payout_provider`, que se resuelve por `payee_country`
-- — un dato que viaja congelado en cada `payments` (RN-33) y que **cambia con el
-- tiempo**, porque desde `20260901140000` el tutor declara su país y puede
-- corregirlo.
--
-- Sin esta columna, el primer lote de CUALQUIER tutor que declare país mezcla
-- sus pagos de la era «sin declarar» —cuya fila de ruteo no promete payout— con
-- los de la era declarada, en una fila indistinguible de un payout limpio:
-- misma moneda, mismo `funding_provider`, `provider` a null. C2 solo podría
-- resolver el destino leyendo el perfil ACTUAL del tutor, o sea un campo que el
-- propio tutor edita desde el navegador. Se congela aquí, con el resto del
-- snapshot financiero.

comment on column public.payouts.funding_provider is
  'De qué balance sale este dinero: copia de payments.provider de sus líneas (= payment_routing_rules.charge_provider, congelado por create_booking). Todas las líneas de un payout comparten valor porque es parte de la clave de agrupación de build_payout_for_tutor. NO confundir con payouts.provider, que es quién ejecuta el pago. Un payout de dLocal Go se paga del balance de dLocal Go: si funding_provider no es un proveedor que sepa pagar (null, ''simulated'', o distinto del ejecutor), la orden es impagable y no debe mandarse.';

comment on column public.payouts.provider is
  'Quién EJECUTÓ el pago: se escribe al ejecutar, junto a provider_payout_id y paid_at, nunca al crear el payout (corresponde a payment_routing_rules.payout_provider, resuelto por payee_country). Null en todo lo que esté en ''scheduled''. NO es de dónde salió el dinero — eso es funding_provider, y no son lo mismo: la única regla de ruteo de dev dice charge_provider=''stripe'' con payout_provider=''simulated''.';

-- ── Backfill de lo ya construido ────────────────────────────────────────────
-- Solo donde no hay duda: todas las líneas del payout con el mismo proveedor y
-- ninguna con null. Lo que mezcla balances se queda en null a propósito —
-- inventarle un valor sería decidir por SQL algo que hay que mirar—; el filtro
-- por null va aparte porque `count(distinct)` ignora los nulls y un payout con
-- una línea 'stripe' y otra sin proveedor daría 1 sin serlo.
--
-- ⚠️ Este `update` NO dispara NTF-12: `notify_payout()` se guarda con
-- `if new.status is distinct from old.status` (`20260716170000:177`) y aquí el
-- estado no se toca. Sí mueve `updated_at` por el trigger de auditoría, que es
-- el precio de no dejar el histórico a ciegas.
--
-- Para ver cuáles quedaron sin backfillear —los que mezclan balances de verdad,
-- que es la fotografía del problema antes de arreglarlo:
--
--   select po.id, po.status, po.currency, po.amount,
--          array_agg(distinct p.provider) as balances
--     from public.payouts po
--     join public.payout_items pi on pi.payout_id = po.id
--     join public.payments p      on p.id = pi.payment_id
--    where po.funding_provider is null
--    group by 1, 2, 3, 4;
update public.payouts po
   set funding_provider = origen.prov
  from (
    select pi.payout_id, min(p.provider) as prov
      from public.payout_items pi
      join public.payments p on p.id = pi.payment_id
     group by pi.payout_id
    having count(distinct p.provider) = 1
       and count(*) filter (where p.provider is null) = 0
  ) origen
 where po.id = origen.payout_id
   and po.funding_provider is distinct from origen.prov;

-- ── build_payout_for_tutor: la moneda ya no basta como clave ────────────────
-- Cuerpo íntegro de `20260716140000:93-133` con el proveedor metido en la
-- agrupación y en el insert. Lo demás —definición de «liquidable», retención,
-- S-29, el `unnest` de las líneas— se conserva letra por letra: es la misma
-- definición que comparten `tutor_balance` y `account_deletion_state`, y tener
-- tres copias que digan lo mismo solo funciona si nadie mueve una sola.
create or replace function public.build_payout_for_tutor(
  p_tutor_id       uuid,
  p_retention_days int,
  p_status         public.payout_status default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
  v_rec    record;
  v_payout uuid;
begin
  -- Se agrupa por MONEDA, por PROVEEDOR DE COBRO y por PAÍS DE DESTINO. La
  -- moneda porque sumar monedas distintas no significa nada (RN-13); el
  -- proveedor porque el dinero vive en el balance de quien lo cobró, y un payout
  -- que mezcle dos balances no lo puede ejecutar ninguno de los dos; y el país
  -- porque es quien elige al EJECUTOR (`payment_routing_rules.payout_provider`),
  -- y mezclar destinos produce una orden que no se sabe a dónde mandar.
  --
  -- Los tres son la misma idea aplicada tres veces: en la clave va todo lo que
  -- tiene que ser IGUAL en las líneas para que la orden resultante sea pagable.
  -- Un payout de más es un inconveniente; un payout impagable es dinero parado
  -- sin que nadie se entere.
  for v_rec in
    select p.currency,
           p.provider       as funding_provider,
           p.payee_country  as payee_country,
           sum(p.tutor_net_amount) as total,
           array_agg(p.id)         as payment_ids
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where b.tutor_id = p_tutor_id
      and p.status = 'paid'                       -- reembolsados fuera (S-29)
      and b.status = 'completed'
      and b.completed_at <= v_cutoff              -- retención vencida (DP-02)
      and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
    group by p.currency, p.provider, p.payee_country
  loop
    insert into public.payouts (tutor_id, status, currency, amount,
                                funding_provider, payee_country,
                                retention_until, scheduled_for)
    values (p_tutor_id, p_status, v_rec.currency, v_rec.total,
            v_rec.funding_provider, v_rec.payee_country, v_cutoff, now())
    returning id into v_payout;
    -- `provider` se queda a null a propósito: lo escribe quien ejecute (C2).

    insert into public.payout_items (payout_id, payment_id, amount)
    select v_payout, pid, p.tutor_net_amount
    from unnest(v_rec.payment_ids) as pid
    join public.payments p on p.id = pid;
  end loop;

  -- Se crea un payout por cada (moneda, proveedor de cobro, país) y se devuelve
  -- el último.
  -- Quien lo llama solo mira si es null: `request_withdrawal` para saber si
  -- había saldo, `run_payout_batch` para contar tutores. Ninguno usa el id.
  return v_payout;
end;
$$;

comment on function public.build_payout_for_tutor(uuid, int, public.payout_status) is
  'Agrupa los pagos liquidables de un tutor en payouts, uno por cada (moneda, proveedor de cobro). La moneda por RN-13; el proveedor porque un payout se paga desde el balance del PSP que cobró ese dinero y mezclarlos produce una orden que nadie puede ejecutar. Los pagos con provider ''simulated'' o null caen en su propio grupo en vez de contaminar el dinero real: quedan visibles como payout que C2 rechazará, en lugar de saldo invisible que ningún lote recogería. Devuelve el id del último payout creado (null si no había nada liquidable).';

revoke execute on function public.build_payout_for_tutor(uuid, int, public.payout_status) from public;
revoke execute on function public.build_payout_for_tutor(uuid, int, public.payout_status) from anon;
revoke execute on function public.build_payout_for_tutor(uuid, int, public.payout_status) from authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · REGLA DE ORO 9 — LOS GRANTS QUE C2 VA A NECESITAR
-- ════════════════════════════════════════════════════════════════════════════
--
-- `payouts` y `payout_items` solo tienen `grant select … to authenticated`
-- (`20260716140000:84-85`). Para `service_role`, nada. Hoy no muerde porque
-- todo lo que las toca —`build_payout_for_tutor`, `run_payout_batch`,
-- `process_scheduled_payouts`, `manage_payout`, `refund_payment`— es
-- `security definer` y corre como el dueño de la función, que sí tiene
-- privilegios. C2 no: el pago de verdad tiene que vivir en un Route Handler
-- porque Postgres no puede llamar a la API de un PSP, y ahí el cliente es
-- `service_role`, que se salta la RLS pero NO los grants de tabla.
--
-- Comprobado contra dev antes de escribir esto:
--   GET /rest/v1/payouts?select=id&limit=1  con SUPABASE_SERVICE_ROLE_KEY
--   → 403 {"code":"42501","message":"permission denied for table payouts"}
--
-- Con el build en verde y el typecheck en verde. Es la sexta vez en este
-- proyecto (sessions, payments, profiles, payment_routing_rules…), y la
-- primera en que se pone el grant ANTES de que muerda.
--
-- Lo mínimo, y qué operación de C2 justifica cada uno:

-- Leer la cola: `select … from payouts where status='scheduled' and
-- scheduled_for <= now()` — de ahí salen tutor_id, currency, amount y
-- funding_provider, que es lo que decide a qué proveedor se manda la orden y si
-- se puede mandar. Sin SELECT no hay cola que procesar.
-- (Vale también para el PATCH: PostgREST necesita SELECT para devolver la fila.)
grant select on public.payouts to service_role;

-- Conciliar el importe contra sus líneas antes de mandar la orden. El total va
-- a la API del PSP y por regla de oro 2 tiene que salir de la BD: `payouts.amount`
-- es un agregado, `payout_items` es de dónde salió. También es lo que permite
-- que el reintento sepa qué pagos cubre una orden que ya se mandó.
grant select on public.payout_items to service_role;

-- Anotar el RESULTADO de la ejecución, y solo eso. Por columnas, como
-- `20260806170000:49` hace con `payments`:
--   · status              scheduled → processing antes de llamar, y el webhook
--                         processing → paid | failed
--   · provider            quién lo ejecutó (el payout_provider real)
--   · provider_payout_id  el id que devuelve el PSP — la llave de idempotencia
--                         que evita pagar dos veces si el Handler se reintenta
--   · provider_metadata   respuesta cruda del proveedor, para soporte
--   · paid_at / failed_at / failure_reason   el cierre y su porqué
--
-- Fuera queda todo lo que define CUÁNTO y A QUIÉN: `amount`, `currency`,
-- `tutor_id`, `funding_provider`, `retention_until`, `scheduled_for`. Eso lo
-- congela `build_payout_for_tutor` y el ejecutor no tiene por qué poder
-- moverlo; si algún día hay que corregirlo, es una RPC de admin, no un UPDATE
-- suelto desde un Handler. Tampoco hay INSERT ni DELETE: C2 ejecuta payouts, no
-- los crea (eso es el lote) ni los deshace (eso es el clawback de S-29, que ya
-- es `security definer`).
--
-- ⚠️ Este grant es lo que vuelve a armar NTF-12. `notify_payout()` dispara
-- «Se pagó tu liquidación» en cuanto `status` pasa a 'paid'
-- (`20260716170000:177-180`), y C1 acaba de desarmarlo justamente porque se
-- estaba mandando por dinero que no se movía. A partir de aquí el correo vuelve
-- a poder salir, y el único seguro es el código de C2: 'paid' se escribe cuando
-- el proveedor lo confirma, nunca antes de llamarlo ni «por si acaso» al
-- recibir un 2xx de la petición de creación.
grant update (
  status,
  provider,
  provider_payout_id,
  provider_metadata,
  paid_at,
  failed_at,
  failure_reason
) on public.payouts to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · CÓMO COMPROBAR QUE ESTO CORRE DE VERDAD (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `create or replace` valida la sintaxis, no ejecuta el cuerpo. Y el cuerpo
-- nuevo de `build_payout_for_tutor` no se va a ejecutar solo hasta el lote del
-- lunes 7-sep 03:00 UTC, porque hoy no hay nada con la retención vencida: lo
-- último ya liquidado se completó el 19-ago y lo primero que falta el 28-ago,
-- con el corte de 7 días (25-ago) cayendo en medio de un hueco de nueve días
-- sin una sola clase completada. Seis días de silencio son justo el hueco por
-- el que se cuela un fallo en tiempo de ejecución.
--
-- a) La forma que va a tener el lote, sin escribir nada. Si alguna pareja
--    (tutor, moneda) sale con dos filas, la migración era necesaria:
--
--      select b.tutor_id, p.currency, p.provider,
--             count(*), sum(p.tutor_net_amount)
--        from public.payments p
--        join public.bookings b on b.id = p.booking_id
--       where p.status = 'paid' and b.status = 'completed'
--         and not exists (select 1 from public.payout_items pi
--                          where pi.payment_id = p.id)
--       group by 1, 2, 3 order by 1, 2, 3;
--
-- b) Ejercitar el cuerpo AHORA, sin dejar rastro. Retención 0 para que entre
--    todo, y `rollback` para deshacerlo. Un INSERT en `payouts` no dispara
--    `notify_payout()` —el trigger es AFTER UPDATE— así que no encola nada:
--
--      begin;
--      select public.build_payout_for_tutor(
--               '11111111-0000-4000-8000-000000000001', 0, 'scheduled');
--      select currency, funding_provider, amount, provider, status
--        from public.payouts
--       where tutor_id = '11111111-0000-4000-8000-000000000001'
--       order by created_at desc;
--      rollback;
--
--    En dev ese tutor tiene 'simulated' y 'stripe' mezclados, así que tienen
--    que salir DOS filas nuevas en USD, no una.
--
-- c) Después del lote del lunes, mirar su corrida — y agregando, no leyendo las
--    diez últimas, que `run-payout-batch` es semanal y se cae de la ventana:
--
--      select j.jobname, d.status, count(*), max(d.start_time), max(d.return_message)
--        from cron.job_run_details d join cron.job j using (jobid)
--       where j.jobname in ('run-payout-batch', 'process-payouts')
--       group by 1, 2;
