-- ============================================================================
-- Enséñame Ya — A0 · el ruteo de pagos deja de saber nombrar UN SOLO país, y
-- resulta que era el único al que no se puede pagar.
--
-- ── LO QUE HABÍA ────────────────────────────────────────────────────────────
--
-- `create_booking_line` abre con
--
--   v_payee char(2) := 'VE';   -- ponytail: payout_country del tutor llega en S3/C-13
--
-- y con ese literal busca en `payment_routing_rules`, congela
-- `bookings.payee_country` y congela `payments.payee_country`. El literal está
-- en CUATRO migraciones —`20260709160000:68`, `20260715170000:121`,
-- `20260827150000:347` y `20260831180000:172`— pero eso NO son cuatro sitios
-- que arreglar: son la misma función reescrita cuatro veces. Solo la última
-- está viva; las tres primeras ya las superseden sus sucesoras y no se tocan
-- (regla de oro 5: una migración aplicada es inmutable). Lo mismo con
-- `create_booking`, que desde `20260827150000:468` es un envoltorio de una
-- línea y ya no calcula nada.
--
-- Y la tabla de ruteo tiene UNA fila: la sembrada en `20260709160000:41-42`
-- como `('VE', null, 'simulated', 'simulated')` — hoy, en dev, con
-- `charge_provider='stripe'` desde el `UPDATE` del 7-ago. Es decir: el único
-- país que el ruteo sabe nombrar es el mismo desde el primer día.
--
-- ── POR QUÉ AHORA ES UN PROBLEMA Y NO UN «ponytail» MÁS ─────────────────────
--
-- Porque el análisis del P1 de pagos cerró qué se puede servir de verdad, y
-- Venezuela no está:
--
--   · dLocal Go SÍ paga a terceros (`POST /v1/payouts`, B2C) en OCHO países:
--     AR, BR, CL, EC, MX, PE, PY, UY. NO cubre VE ni CO.
--   · Stripe Connect no llega a LATAM por self-serve (payouts cross-border).
--   · Venezuela no la cubre ninguno de los dos.
--
-- O sea que el único país que el ruteo sabía nombrar es exactamente el único al
-- que hoy no se puede transferir un euro. Mientras `process_scheduled_payouts()`
-- fingía pagar (hasta C1, `20260901120000`) daba igual; desde que solo informa,
-- lo que queda es una tabla de ruteo que no puede describir a nadie a quien sí
-- podríamos pagar.
--
-- ── LAS TRES DECISIONES QUE TOMA ESTA MIGRACIÓN ────────────────────────────
--
-- 1. `tutor_profiles.payout_country` NULLABLE, y `null` significa «el tutor
--    todavía no ha dicho dónde cobra» — no «Venezuela», no «lo deducimos de su
--    zona horaria». Ver el bloque 1.
--
-- 2. `payment_routing_rules.payee_country` pasa a admitir null, y esa fila es
--    la regla de los tutores sin país declarado. Así el «qué hago si no lo sé»
--    vive en el DATO, que es el interruptor de esta tabla desde
--    `20260806180000`, y no en un `coalesce(..., 'VE')` dentro de la función —
--    que sería el mismo literal de antes escondido en otro sitio.
--
-- 3. Las filas nuevas COPIAN el `charge_provider` que ya esté activo en cada
--    ambiente. Esta migración no mueve el interruptor de cobro: hoy dev tiene
--    `charge_provider='stripe'` (se cambió por `UPDATE` el 7-ago) y prod tiene
--    lo que tenga. Sembrar 'simulated' a mano habría hecho que un tutor que
--    declara México cayera al checkout simulado mientras el resto cobra por
--    Stripe, y sembrar 'stripe' habría encendido Stripe en producción desde una
--    migración. Se copia, y quien quiera cambiarlo sigue haciendo un `UPDATE`.
--
-- ⚠️ CONSECUENCIA QUE HAY QUE CONOCER ANTES DE MERGEAR: a partir de aquí,
-- declarar un país SIN regla activa deja las mentorías de ese tutor sin vender.
-- No es un efecto nuevo ni un descuido — es RN-33 tal cual («sin regla activa →
-- bloqueada»), que lleva en `create_booking_line` desde el primer día y que
-- nadie había podido disparar porque el país era una constante. Por eso el
-- formulario del tutor ofrece SOLO los países que la tabla puede pagar
-- (`payoutCountries()` en `src/lib/payments.ts`), y por eso Colombia y
-- Venezuela no aparecen en esa lista: no es un olvido, es que no podemos
-- pagarles.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `tutor_profiles.payout_country` — dónde cobra el tutor
-- ════════════════════════════════════════════════════════════════════════════
--
-- Es la columna que el Doc 1 §1.4 ya describía («País donde cobra el tutor ->
-- decisivo para el ruteo, RN-15») y que EP-03 dejó explícitamente aparcada en
-- `20260706120000:15`, a la espera de C-13. Llega ahora con el mismo nombre.
--
-- ── POR QUÉ NULLABLE, Y QUÉ SIGNIFICA EL NULL ──────────────────────────────
--
-- `null` = **el tutor no lo ha declarado todavía**. No es «Venezuela» ni «lo
-- averiguamos por su zona horaria»: es la ausencia del dato, y se distingue de
-- cualquier país declarado a propósito.
--
-- No lleva `not null` porque no hay valor con el que nacer que no sea mentira.
-- Los tres candidatos y por qué se descartan:
--
--   · `default 'VE'` — es el literal que esta migración viene a quitar, y
--     además pondría a todos los tutores en el único país impagable.
--   · backfill con `country_from_timezone(profiles.timezone)`
--     (`20260723140000`) — esa función existe para una CIFRA DE VITRINA («30+
--     países» de la portada) y su propio comentario avisa de que se queda corta
--     antes que mentir. Derivar de ahí el destino del DINERO es otra cosa: un
--     tutor puede vivir en Lima y cobrar en una cuenta de Chile. Y no es
--     teórico — sobre los OCHO tutores aprobados de dev, ese backfill daría
--     VE, CO, MX, AR, ES, PE, CL y VE, o sea que a **dos de los ocho** (Mateo
--     Herrera en `America/Bogota` y Lucía Ferrer en `Europe/Madrid`) les
--     escribiría un país SIN regla de ruteo y sus mentorías dejarían de poder
--     venderse esa misma noche, por un dato que ninguno de los dos eligió.
--     Rellenar la columna con la foto de hoy congela además un valor que nadie
--     sabría distinguir después de una declaración real — el mismo criterio, y
--     por el mismo motivo, que N-04 (`20260817200000:33-40`) y el paso de
--     agenda (`20260831190000`).
--   · exigirlo (`not null`) — dejaría sin vender, de golpe, a todos los tutores
--     aprobados que hay hoy. Una migración no puede cerrar la tienda.
--
-- Así que el backfill correcto es NO HACER NADA, y el «qué pasa mientras tanto»
-- se responde en el bloque 2, que es donde se responde todo lo demás del ruteo.
--
-- ── EL CHECK ───────────────────────────────────────────────────────────────
--
-- Solo la FORMA: ISO-3166-1 alpha-2 en mayúsculas. No se comprueba que el país
-- sea uno de los servibles y no se puede: eso vive en `payment_routing_rules`,
-- una tabla, y un `check` no puede consultar otra tabla. Tampoco haría falta —
-- el ruteo ya falla cerrado (RN-33) — y un `check` con la lista dentro habría
-- que reescribirlo por migración cada vez que dLocal abra un país, que es justo
-- lo contrario de que el interruptor sea el dato.
--
-- `char(2)` rellena con espacios, así que una letra suelta se guarda como 'm '
-- y el regex la rechaza igual.
alter table public.tutor_profiles
  add column if not exists payout_country char(2)
    check (payout_country is null or payout_country ~ '^[A-Z]{2}$');

comment on column public.tutor_profiles.payout_country is
  'País donde cobra el tutor (ISO-3166-1 alpha-2), y por tanto la clave con la que create_booking_line resuelve payment_routing_rules (RN-15/RN-16). NULL = el tutor no lo ha declarado todavía: NO es Venezuela y NO se deduce de su zona horaria; su ruteo lo decide la fila de payment_routing_rules con payee_country NULL. Lo escribe el propio tutor desde /tutor/payouts (column-grant + RLS de fila propia). Cambiarlo NO reescribe nada ya vendido: el país viaja congelado en bookings.payee_country y payments.payee_country desde que se crea la reserva (regla de oro 2).';

-- ── Grants (auto-expose OFF · regla de oro 9) ──────────────────────────────
--
-- Mismo patrón, y por el mismo motivo, que `auto_accept_bookings`
-- (`20260724160000:18`), `teaching_level` (`20260722160000:80-81`) y `faqs`
-- (`20260826150000:56-57`): en `tutor_profiles` el `select` es de TABLA pero la
-- escritura del cliente se acota columna a columna (US-1403, anti-escalada), así
-- que una columna sin `grant` explícito es una columna que el tutor no puede
-- rellenar. Las políticas no hacen falta: `tutor_profiles_insert_own` y
-- `tutor_profiles_update_own` (`20260706140000:23-30`) ya limitan a la fila
-- propia y esto es una columna, no una tabla nueva.
grant insert (payout_country) on public.tutor_profiles to authenticated;
grant update (payout_country) on public.tutor_profiles to authenticated;

-- `service_role` NO recibe nada, y conviene decir por qué para que no se añada
-- «por si acaso»: hoy no tiene grant NINGUNO sobre `tutor_profiles`, y quien lee
-- esta columna no lo necesita — `create_booking_line` es `security definer`
-- (corre como el dueño, ni RLS ni grants le aplican) y la pantalla de payouts la
-- lee con el cliente del propio tutor. El día que un Route Handler o un job la
-- lea con el cliente admin, ESE día toca el grant, y morderá en tiempo de
-- ejecución (regla de oro 9, que ya mordió tres veces el 6-ago).

-- ⚠️ ESTA COLUMNA NACE PÚBLICA, Y ES LA FRONTERA QUE B1 NO PUEDE CRUZAR.
-- `tutor_profiles` tiene `grant select ... to anon` (`20260706120000:171`) y la
-- política `tutor_profiles_select_public` deja leer la fila entera de cualquier
-- tutor `approved`: cualquier visitante anónimo puede leer este país. Para un
-- ISO-3166 es asumible —la zona horaria del tutor ya es pública y dice casi lo
-- mismo—, pero marca el límite: los DATOS BANCARIOS de B1 (dLocal Go no guarda
-- beneficiarios, van enteros en cada `POST /v1/payouts`) NO pueden vivir en esta
-- tabla. Necesitan tabla propia, con RLS de dueño y sin `anon` en los grants.
-- Añadirlos aquí sería publicar un IBAN en la ficha pública.

-- Sin índice a propósito, aunque el Doc 1 §1.4 lo mencione. Nadie filtra por
-- esta columna: `create_booking_line` la lee por `profile_id`, que es la PK.
-- El día que el admin quiera contar tutores por país, ESE día se añade.


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · `payment_routing_rules` — las filas que sí sabemos servir
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── EL COMODÍN ES `payer_country`, Y SOLO ÉL ───────────────────────────────
--
-- La búsqueda del ruteo es, literalmente (`20260831180000:245-249`):
--
--   where is_active and payee_country = v_payee and payer_country is null
--
-- o sea que **una fila con `payer_country` puesto no la ve nadie**. Se puede
-- arreglar de dos maneras y aquí se elige la segunda: **solo se siembran filas
-- comodín**, y la consulta se queda como está salvo por el null del payee.
--
-- El motivo no es pereza, es que hoy no existe el dato del otro lado: el país
-- del PAGADOR no se guarda en ninguna parte. `profiles` tiene zona horaria y
-- nada más, `payments.payer_country` está a null en las 115 filas de dev, y el
-- alumno nunca declara un país en el registro. Una regla `('MX','ES',…)` sería
-- una regla que jamás podría evaluarse: no hay con qué. Y para el cobro tampoco
-- cambiaría nada — Stripe acepta tarjetas de donde sea; lo que decide quién
-- puede pagar al tutor es dónde cobra el TUTOR, que es lo que esta migración
-- viene a poner.
--
-- El día que exista un país de pagador de verdad (KYC del alumno, o el país de
-- la tarjeta que devuelve Stripe), lo que cambia es la consulta —pasar de
-- `payer_country is null` a preferir la fila específica y caer al comodín— y
-- estas filas siguen valiendo tal cual, como último recurso. Escribir hoy la
-- mitad específica sería dejar filas muertas en una tabla de dinero.
--
-- ── EL PAYEE SÍ ADMITE NULL, Y NO ES UN COMODÍN ────────────────────────────
--
-- Los dos nulls de esta tabla significan lo mismo —«no lo sé»— pero se buscan
-- distinto, y confundirlos es el error que este comentario existe para evitar:
--
--   · `payer_country is null`  → «esta regla no mira de dónde paga el alumno».
--     Es un comodín: casa con todos.
--   · `payee_country is null`  → «esta regla es la de los tutores que no han
--     declarado país». Es un valor exacto: casa SOLO con esos. Un tutor que
--     declara Colombia NO cae aquí — se queda sin ruta, que es lo correcto.
--
-- Por eso la consulta pasa a `payee_country is not distinct from v_payee` y no
-- a un `or`: es igualdad, con el null tratado como un valor más.
--
-- (Sí, `is not distinct from` no usa el índice `payment_routing_rules_lookup_idx`.
-- La tabla es configuración y tiene diez filas; el plan es un seq scan y así se
-- queda. No se «optimiza» esto convirtiéndolo en un `or` con `= v_payee`, que es
-- lo mismo escrito peor.)
--
-- ⚠️ Divergencia consciente con el Doc 1 §1.4.17, que da `payee_country` como
-- NOT NULL. Gana la migración (CLAUDE.md: los Docs son el objetivo, el código
-- manda), y el motivo es el de arriba: sin este null, el «no lo ha declarado»
-- tendría que vivir dentro de la función.
alter table public.payment_routing_rules
  alter column payee_country drop not null;

comment on column public.payment_routing_rules.payee_country is
  'País donde cobra el tutor (tutor_profiles.payout_country) al que aplica esta regla. NULL = la regla de los tutores que NO han declarado país; NO es un comodín (la búsqueda es exacta, is not distinct from). El comodín de esta tabla es payer_country, que sí significa «cualquier pagador». Un país sin fila activa no se puede vender: create_booking_line levanta «sin ruta de pago disponible para el destino» (RN-33).';

-- ── Las filas ──────────────────────────────────────────────────────────────
--
-- Ocho países + la regla del «sin declarar». `charge_provider` se COPIA del que
-- ya esté activo en este ambiente (ver decisión 3 de la cabecera): así, el día
-- que se aplique esto, ningún tutor cambia de pasarela de cobro por sorpresa.
--
-- `payout_provider = 'dlocal'` es un enunciado de hecho, no un interruptor: no
-- hay adaptador de payouts en el repo (`src/lib/payments/port.ts` lo dice y
-- explica por qué no se escribe a ciegas) y C1 dejó `process_scheduled_payouts()`
-- solo informando. Lo que declara es de qué balance tendría que salir el dinero
-- cuando exista C2 — que es exactamente lo que `payouts.funding_provider`
-- (`20260901130000`) necesita contrastar para saber si una orden es pagable.
--
-- ⚠️ VENEZUELA SE QUEDA, PERO SIN PROMETER PAGO; COLOMBIA NO ENTRA. La fila de
-- VE sigue viva —quitarla dejaría sin vender a quien la haya declarado— y se le
-- deja abajo el `payout_provider='simulated'` explícito, que es la verdad: allí
-- no transfiere nadie. CO ni siquiera entra, por lo mismo. Los tutores de esos
-- dos países siguen vendiendo con `payout_country` a null (la última fila de
-- este insert), que es la situación honesta: se les cobra a sus alumnos, su
-- saldo se acumula y no se les promete un pago que no podemos hacer.
--
-- Idempotente por `not exists` sobre la clave real de la búsqueda (payee +
-- comodín de payer): esta migración tiene que poder correr sobre una base donde
-- alguna de estas filas ya exista, y `on conflict` no vale porque no hay
-- constraint única que lo respalde.
--
-- `priority` se deja en su default (100) para todas. En esta tabla la prioridad
-- solo desempata entre filas del MISMO payee, y aquí cada payee aparece una vez:
-- ponerle 900 a la del «sin declarar» sugeriría una cascada que no existe.
with cobrador as (
  -- El cobrador vigente, tal cual. `coalesce` por si esta migración corre sobre
  -- una base sin ninguna regla (un ambiente recreado desde cero): en ese caso el
  -- valor honesto es el simulado, nunca uno que mueva dinero de verdad.
  select coalesce(
           (select r.charge_provider
              from public.payment_routing_rules r
             where r.is_active and r.payer_country is null
             order by r.priority
             limit 1),
           'simulated'
         ) as charge
)
insert into public.payment_routing_rules
  (payee_country, payer_country, charge_provider, payout_provider, notes)
select n.code, null::char(2), c.charge, n.payout, n.notes
from cobrador c
cross join (values
  ('AR'::char(2), 'dlocal'::text,    'dLocal Go · payout B2C (POST /v1/payouts)'::text),
  ('BR',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  ('CL',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  ('EC',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  ('MX',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  ('PE',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  ('PY',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  ('UY',          'dlocal',          'dLocal Go · payout B2C (POST /v1/payouts)'),
  (null::char(2), 'simulated',       'Tutor sin país de cobro declarado (tutor_profiles.payout_country a null). Deja vender; no promete payout.')
) as n(code, payout, notes)
where not exists (
  select 1 from public.payment_routing_rules r2
   where r2.payee_country is not distinct from n.code
     and r2.payer_country is null
);

-- ── Venezuela, escrita como lo que es ──────────────────────────────────────
--
-- Se fija `payout_provider = 'simulated'` en vez de dar por hecho que el seed
-- sigue así, y es deliberado que esta migración sí toque esa columna cuando no
-- toca `charge_provider`: no son la misma clase de dato. El cobrador es un
-- INTERRUPTOR de negocio (se enciende Stripe cuando se decide, por `UPDATE`);
-- el pagador de Venezuela es un HECHO comprobado —ni dLocal Go ni Stripe
-- transfieren allí— y de él depende que el desplegable del tutor no ofrezca un
-- país impagable (`payoutCountries()` filtra justo por esto). Donde el seed
-- siga intacto, esta sentencia no hace nada.
update public.payment_routing_rules
   set payout_provider = 'simulated'
 where payee_country = 'VE'
   and payer_country is null
   and payout_provider is distinct from 'simulated';

-- Y la nota de esa misma fila (`20260709160000:41-42`) decía «MVP — PSP
-- simulado (C-01/C-13 default)», cuando desde el `UPDATE` del 7-ago su
-- `charge_provider` en dev es 'stripe': describía una fila que ya no existía. Se
-- reescribe con lo único que sigue siendo cierto de ella, que además es el
-- motivo por el que no se borra. Con el `where` sobre el texto original, una
-- nota que alguien haya editado a mano se respeta.
update public.payment_routing_rules
   set notes = 'Venezuela: se puede COBRAR (charge_provider), pero no transferir — ni dLocal Go ni Stripe pagan allí (P1, 1-sep-2026). Se conserva para no dejar sin vender a quien ya la tenga declarada; payout_provider queda en simulado a propósito.'
 where payee_country = 'VE'
   and payer_country is null
   and notes = 'MVP — PSP simulado (C-01/C-13 default)';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · `create_booking_line` — el país sale del tutor
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ CUERPO ÍNTEGRO de `20260831180000:155-289`, que es la versión VIVA (las de
-- `20260709160000`, `20260715170000` y `20260827150000` ya están superseded).
-- Una función de Postgres no se parchea, se reescribe entera, así que se copia y
-- se marcan LOS DOS cambios:
--
--   A. `v_payee` deja de nacer con 'VE' y sale de `tutor_profiles.payout_country`;
--   B. la búsqueda del ruteo pasa de `payee_country = v_payee` a
--      `payee_country is not distinct from v_payee`, para que un tutor sin país
--      declarado case con su fila y no con ninguna.
--
-- Todo lo demás —el tier (RN-06), el total (RN-10), el snapshot congelado en
-- `payments`, el hold de `sessions`, los mensajes y el bloque `exception` que
-- traduce 23P01/23505— es idéntico a propósito.
--
-- ⚠️ EL MENSAJE DE CARRERA NO CAMBIA NI UNA LETRA: `esCarreraDeHorario`
-- (`lib/checkout/hold.ts:249-256`) lo reconoce por SUBCADENA y `create_order` lo
-- propaga tal cual (`20260827150000:682-688`). Lo mismo con «sin ruta de pago
-- disponible para el destino», que ahora sí puede dispararlo un tutor real.
--
-- ⚠️ EL PAÍS SE LEE EN CONSULTA APARTE, y no fusionado con la del tier, a
-- propósito. Fusionarlas obligaría a convertir el `join` del tier en `left join`
-- —hoy es INNER y ese INNER es lo que hace que un tutor sin `tier_id` caiga al
-- tier por defecto—, o sea a tocar la resolución del SPLIT para ahorrar una
-- lectura por PK en una tabla de ocho filas. En el cuerpo del dinero, un
-- lookup de más es más barato que un `join` reescrito.
--
-- La firma no se toca: la llaman `create_booking` y `create_order`.
create or replace function public.create_booking_line(
  p_student    uuid,
  p_product_id uuid,
  p_slots      timestamptz[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod     record;
  v_required int;
  v_total    bigint;
  v_split    numeric(5,2);          -- US-1103: lo resuelve el tier del tutor (RN-06)
  v_net      bigint;
  v_fee      bigint;
  v_payee    char(2);               -- Cambio A · lo declara el tutor; null = no lo ha dicho
  v_provider text;
  v_avail    int;
  v_booking  uuid;
  v_slot     timestamptz;
  v_seq      int := 0;
begin
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  -- US-1103 (RN-06): el split lo define el tier del tutor. Sin tier asignado
  -- cae al default; si tampoco hay default se PARA en vez de inventar un número
  -- — es dinero, no un valor cosmético.
  select tt.split_pct into v_split
    from public.tutor_profiles tp
    join public.tutor_tiers tt on tt.id = tp.tier_id
   where tp.profile_id = v_prod.tutor_id;

  if v_split is null then
    select split_pct into v_split from public.tutor_tiers where is_default;
  end if;

  if v_split is null then
    raise exception 'el tutor no tiene tier asignado y no hay tier por defecto'
      using errcode = 'check_violation';
  end if;

  v_required := case when v_prod.pricing_model = 'per_package'
                     then coalesce(v_prod.package_num_sessions, 1) else 1 end;
  if coalesce(array_length(p_slots, 1), 0) <> v_required then
    raise exception 'debes elegir % horario(s)', v_required using errcode = 'check_violation';
  end if;

  -- Cada slot pedido debe seguir disponible (reglas − excepciones − ocupados, S-41).
  --
  -- ⚠️ DENTRO DE UN PEDIDO, ESTA COMPROBACIÓN VE LAS LÍNEAS ANTERIORES. Las N
  -- reservas se crean en la misma transacción, así que al llegar a la línea 2
  -- las `sessions` de la línea 1 ya existen y `get_available_slots` las
  -- descuenta. Es lo correcto —un tutor no da dos clases a la vez— y es lo que
  -- hace que un carrito con dos mentorías del mismo tutor a la misma hora se
  -- caiga aquí en vez de venderse.
  --
  -- ⚠️ LO QUE NO VE, y por eso existe la constraint de exclusión: los slots de
  -- ESTA MISMA llamada. Se validan todos en esta sentencia y se insertan
  -- después, así que un paquete con dos horarios que se pisan entre sí pasa por
  -- aquí sin enterarse. El motor lo corta abajo, en el INSERT.
  select count(*) into v_avail
  from unnest(p_slots) as s(slot)
  where exists (
    select 1 from public.get_available_slots(p_product_id, current_date, current_date + 30) g
    where g.slot_start = s.slot
  );
  if v_avail <> v_required then
    raise exception 'algún horario ya no está disponible' using errcode = 'check_violation';
  end if;

  -- Montos (unidades menores) según modelo (RN-10).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount   -- per_session (1) o per_package (precio del paquete = total)
  end;
  v_net := round(v_total * v_split / 100.0);
  v_fee := v_total - v_net;

  -- Cambio A · A0: el país de cobro sale de quien cobra, no de un literal.
  -- Puede venir null (tutor que aún no lo ha declarado) y eso NO es un error:
  -- es el caso que atiende la fila con `payee_country` null. Lo que se congela
  -- abajo en `bookings`/`payments` es este valor tal cual, null incluido —
  -- escribir 'VE' ahí era inventarle un destino al dinero.
  select tp.payout_country into v_payee
    from public.tutor_profiles tp
   where tp.profile_id = v_prod.tutor_id;

  -- US-701: ruteo por geografía; sin regla activa → bloqueada (RN-33).
  -- Cambio B · `is not distinct from`: el null del tutor casa con la fila del
  -- «sin declarar» y con ninguna otra. Ver el bloque 2 sobre los dos nulls.
  select charge_provider into v_provider
  from public.payment_routing_rules
  where is_active and payee_country is not distinct from v_payee and payer_country is null
  order by priority
  limit 1;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible para el destino' using errcode = 'check_violation';
  end if;

  insert into public.bookings (
    student_id, product_id, tutor_id, status, pricing_model, num_sessions,
    session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct, payee_country
  ) values (
    p_student, v_prod.id, v_prod.tutor_id, 'pending_payment', v_prod.pricing_model, v_required,
    v_prod.session_duration_min, v_prod.currency, v_total, v_total, v_split, v_payee
  ) returning id into v_booking;

  -- US-702: split congelado en el pago (server-side).
  insert into public.payments (
    booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
    tier_split_pct, payee_country, provider
  ) values (
    v_booking, 'pending', v_prod.currency, v_total, v_fee, v_net, v_split, v_payee, v_provider
  );

  -- Sessions = hold del slot (S-41). La constraint de exclusión cierra la
  -- carrera Y el solape dentro del propio paquete.
  foreach v_slot in array p_slots loop
    v_seq := v_seq + 1;
    insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status)
    values (v_booking, v_prod.tutor_id, p_student, v_seq, v_slot,
            v_slot + make_interval(mins => v_prod.session_duration_min), 'scheduled');
  end loop;

  return v_booking;
exception
  -- Los dos disfraces del mismo suceso. `exclusion_violation` (23P01) es el
  -- choque de agenda desde que existe `sessions_sin_solape_por_tutor`;
  -- `unique_violation` (23505) sigue vivo por el `booking_id` único de
  -- `payments`. Mismo mensaje en los dos: desde fuera son lo mismo, y el texto
  -- es el que reconoce `esCarreraDeHorario`.
  when exclusion_violation or unique_violation then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
end;
$$;

comment on function public.create_booking_line(uuid, uuid, timestamptz[]) is
  'EY-176 · una línea de pedido: revalida huecos, congela el snapshot financiero y agenda las sesiones. Traduce 23P01/23505 al mensaje de carrera que reconoce esCarreraDeHorario. A0 (1-sep-2026): el payee_country sale de tutor_profiles.payout_country y ya no es el literal ''VE''; un tutor sin país declarado (null) rutea por la fila de payment_routing_rules con payee_country null, y uno que declare un país sin regla activa no se puede vender (RN-33).';

-- Interna: la llaman `create_booking` y `create_order`, las dos SECURITY
-- DEFINER del mismo dueño. `create or replace` conserva privilegios, pero se
-- repiten por si esta migración corre sobre una base donde la función no
-- existiera: en Postgres el `execute` nace concedido a PUBLIC, y sin estos
-- `revoke` cualquiera podría crear una reserva a nombre de OTRO alumno pasando
-- el uuid que quiera.
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from public;
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from anon;
revoke execute on function public.create_booking_line(uuid, uuid, timestamptz[]) from authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ EL INVARIANTE DE `confirm_simulated_payment`, RECOLOCADO
--
-- Lo cazaron los TRES revisores adversariales del 1-sep, por su cuenta y con
-- lentes distintas, así que va aquí y no en un ticket para mañana.
--
-- `20260806120000` dejó escrito el diseño con estas palabras: «el camino del
-- cliente **se desarma solo**. En cuanto `payment_routing_rules` deje de rutear
-- a 'simulated' … esta función empezará a rechazar sin que nadie toque nada. El
-- día del lanzamiento no hay que acordarse de revocar: lo impide el dato, no un
-- punto de una lista.»
--
-- Ese razonamiento era correcto **mientras la tabla tuvo UNA fila y nadie de
-- fuera pudiera elegir cuál se le aplica**. Esta misma migración rompe las dos
-- premisas a la vez: pasa la tabla a diez filas y concede
-- `update (payout_country)` a `authenticated`, o sea que el tutor elige su fila
-- desde el navegador. El `check` de la columna es solo de forma (`^[A-Z]{2}$`)
-- y el desplegable de `payoutCountries()` no es un control: se puede saltar con
-- un `PATCH` a PostgREST.
--
-- El ataque completo, que es barato y silencioso: se enciende Stripe en las
-- ocho filas de países servibles y se deja en 'simulated' la del «sin declarar»
-- —que es lo natural, porque a ese tutor no se le puede pagar—. El tutor elige
-- «Sin declarar», y desde ese instante sus reservas congelan
-- `payments.provider = 'simulated'`. Con una segunda cuenta suya de alumno
-- reserva su propia mentoría, llama a `confirm_simulated_payment` —que le
-- pertenece: es dueño de la reserva y el provider es simulado—, y tiene un pago
-- `paid` sin que se mueva un céntimo. De ahí sale sesión completada, saldo
-- devengado y, con C2, un payout con dinero real.
--
-- LA CORRECCIÓN NO ES QUITARLE LA COLUMNA AL TUTOR. Es que el interruptor deje
-- de ser POR FILA y pase a ser DE PLATAFORMA: si alguna regla activa cobra con
-- un proveedor de verdad, el camino simulado está cerrado **para todos**. Así
-- se conserva la propiedad que buscaba el diseño original —lo impide el dato,
-- no una lista— y además se refuerza: ya no hay ninguna fila que un usuario
-- pueda elegir para reabrirlo.
--
-- Efecto práctico: hoy, con todo en simulado, no cambia nada. El día que se
-- encienda Stripe en una sola fila, este camino muere en toda la plataforma —
-- que es exactamente lo que se quería del día del lanzamiento.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.confirm_simulated_payment(
  p_booking_id uuid,
  p_success    boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  -- Sigue siendo tuya o no existe (mismo mensaje: no se filtra si la reserva
  -- existe y es de otro).
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.student_id = (select auth.uid())
  ) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- ── Cerrojo 1 (NUEVO): ¿está la plataforma entera en simulado? ────────────
  -- Se mira ANTES que el snapshot de la reserva a propósito: es el que no
  -- depende de ningún dato que el usuario pueda mover. Si alguien encendió un
  -- cobrador real en cualquier corredor, aquí ya no se confirma nada.
  if exists (
    select 1 from public.payment_routing_rules r
     where r.is_active
       and r.charge_provider is distinct from 'simulated'
  ) then
    raise exception 'un cobro real solo lo confirma el proveedor de pago'
      using errcode = 'insufficient_privilege';
  end if;

  -- ── Cerrojo 2: el de siempre, sobre el snapshot de ESTA reserva ───────────
  -- Se conserva y no es redundante: cubre la reserva creada antes de que se
  -- encendiera el proveedor real, que sigue teniendo 'simulated' congelado en
  -- su `payments` y no debe confirmarse por esta puerta.
  select p.provider into v_provider
    from public.payments p where p.booking_id = p_booking_id;

  if v_provider is distinct from 'simulated' then
    raise exception 'un cobro real solo lo confirma el proveedor de pago'
      using errcode = 'insufficient_privilege';
  end if;

  return public.confirm_payment(p_booking_id, p_success);
end;
$$;

comment on function public.confirm_simulated_payment(uuid, boolean) is
  'Confirma un cobro SIMULADO. Exige tres cosas: ser el dueño de la reserva, que NINGUNA regla activa de payment_routing_rules cobre con un proveedor real (cerrojo de plataforma, añadido el 2026-09-01), y que el snapshot de este pago sea ''simulated''. El cerrojo de plataforma existe porque desde esta misma migración el tutor elige su payout_country desde el navegador y con él la fila de ruteo que se le aplica: sin él podría escoger una fila simulada, autoconfirmarse un pago falso y devengar saldo real. Se desarma solo al encender el primer cobrador de verdad, en cualquier corredor.';

-- Los grants no cambian (`20260806120000:...`), pero se repiten porque en
-- Postgres EXECUTE se concede a PUBLIC por defecto y un `drop`+`create` futuro
-- los perdería. Es la lección de US-605.
revoke execute on function public.confirm_simulated_payment(uuid, boolean) from public;
revoke execute on function public.confirm_simulated_payment(uuid, boolean) from anon;
grant  execute on function public.confirm_simulated_payment(uuid, boolean) to authenticated;
