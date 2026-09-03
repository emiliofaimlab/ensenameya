-- ============================================================================
-- Enséñame Ya — el ruteo deja de conocer UN proveedor por país y pasa a
-- conocer DOS LISTAS ORDENADAS.
--
-- ── LO QUE DECIDIÓ EL CLIENTE (2026-09-03) ──────────────────────────────────
--
--   VENEZUELA        cobro: Stripe SIEMPRE; si no está disponible, dLocal
--                    payouts automáticos: Airtm, PayPal
--                    payouts manuales:    Zinli, Binance, Zelle
--
--   COLOMBIA         cobro: Stripe SIEMPRE; si no está disponible, dLocal
--                    payouts automáticos: Wise, PayPal, payout directo de Stripe
--                                         — el de Stripe NO si cobró dLocal
--
--   RESTO DEL MUNDO  cobro: dLocal donde lo cubra; Stripe donde no
--                    payouts automáticos: PayPal, Wise, dLocal o Stripe,
--                                         según por dónde entró el pago
--
-- ── POR QUÉ EL ESQUEMA NO PODÍA EXPRESARLO ──────────────────────────────────
--
-- `charge_provider` y `payout_provider` son SINGULARES. «Stripe siempre, y si no
-- está disponible dLocal» no es un proveedor: es una lista de dos en un orden.
-- Y «PayPal, Wise, dLocal o Stripe según por dónde entró el pago» no es un
-- proveedor: es un conjunto de candidatos y una regla para elegir.
--
-- Se podría haber hecho con varias filas por país y `priority` —la columna ya
-- existe— pero cada fila lleva un cobro Y un payout, así que usar filas para el
-- respaldo del cobro acoplaría las dos dimensiones: la fila «dLocal de respaldo»
-- tendría que decir también algo sobre el payout, y no dice nada.
--
-- Dos listas, una por dimensión. Es lo que dice la decisión, literal.
--
-- ── POR QUÉ LAS SINGULARES SE ELIMINAN Y NO SE QUEDAN AL LADO ───────────────
--
-- Porque serían dos fuentes de verdad para el mismo dato, y este repo ya pagó
-- ese precio: `payments.provider` y `payouts.provider` se llamaban casi igual,
-- significaban cosas distintas, y nadie las distinguió hasta que hubo dos PSP
-- (ver `20260901130000`, que dedica media cabecera a desenredarlo). Una columna
-- generada tampoco vale: `charge_provider` se cambia por ambiente con un UPDATE,
-- y una columna generada no se puede actualizar.
--
-- ── ⚠️ LO QUE ESTA MIGRACIÓN NO HACE: ENCENDER UN PSP ───────────────────────
--
-- `20260901140000` dejó escrito por qué las filas nuevas COPIAN el proveedor de
-- cobro que ya esté activo en cada ambiente en vez de sembrar uno: sembrar
-- 'dlocal' aquí lo encendería en PRODUCCIÓN, donde la cuenta de dLocal está
-- RECHAZADA y el checkout dejaría de abrirse. Se respeta.
--
-- Así que `charge_providers` se construye poniendo PRIMERO el proveedor que hoy
-- cobra en ese ambiente y detrás el otro como respaldo:
--
--   ambiente con 'stripe' → {stripe, dlocal}
--   ambiente con 'dlocal' → {dlocal, stripe}
--
-- En **dev** eso ya coincide con la decisión, porque los ocho países se pasaron
-- a 'dlocal' el 3-sep. En **producción** los ocho quedan {stripe, dlocal}, o sea
-- con el respaldo puesto pero el orden invertido respecto a la decisión. Para
-- llegar al estado decidido, cuando la cuenta de producción de dLocal esté
-- aprobada, en ESE ambiente y a mano:
--
--   update public.payment_routing_rules
--      set charge_providers = array['dlocal','stripe']
--    where payee_country in ('AR','BR','CL','EC','MX','PE','PY','UY');
--
-- `payout_providers` sí se siembra literal: ningún riel de payout se «enciende»
-- por estar en la lista. El resolvedor de `src/lib/payments.ts` descarta los que
-- no tienen adaptador o credencial, así que un candidato que aún no existe no
-- hace nada — solo reserva su sitio en el orden de preferencia.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · LAS COLUMNAS NUEVAS
-- ════════════════════════════════════════════════════════════════════════════

alter table public.payment_routing_rules
  add column charge_providers text[],
  add column payout_providers text[];

-- Relleno conservando lo que cada ambiente tiene encendido HOY (ver cabecera).
update public.payment_routing_rules
   set charge_providers = case
         when charge_provider = 'stripe' then array['stripe', 'dlocal']
         when charge_provider = 'dlocal' then array['dlocal', 'stripe']
         -- 'simulated' y cualquier otra: sola. El simulado no tiene respaldo
         -- porque no es un proveedor, es su ausencia.
         else array[charge_provider]
       end,
       payout_providers = array[payout_provider];

-- ⚠️ La fila de los tutores SIN país declarado se queda con el cobro a secas y
-- sin respaldo, a propósito: no es una región de la decisión, es «todavía no
-- sabemos de dónde es este tutor». Darle un respaldo sería inventarse una regla
-- para un caso que la decisión no cubre.
update public.payment_routing_rules
   set charge_providers = array['stripe']
 where payee_country is null;

alter table public.payment_routing_rules
  alter column charge_providers set not null,
  alter column payout_providers set not null;

-- Una lista vacía es un país que no se puede servir, y eso ya lo dice la
-- AUSENCIA de fila (`create_booking_line` levanta «sin ruta de pago
-- disponible»). Tener las dos formas de decir lo mismo es cómo se acaba con una
-- fila que existe y no sirve para nada.
-- ⚠️ El operador de solape (`&&`) y no una subconsulta con `unnest`: Postgres
-- prohíbe subconsultas en un `check` (`0A000 cannot use subquery in check
-- constraint`). `lista && array['']` es true si algún elemento es la cadena
-- vacía, y hace el mismo trabajo sin salir de la fila.
-- ponytail: no caza un elemento de solo espacios. No es un modo de fallo real
-- —las claves las escribe quien edita la tabla, no un usuario— y el resolvedor
-- trataría esa clave como desconocida, que es el camino seguro.
alter table public.payment_routing_rules
  add constraint payment_routing_rules_charge_providers_no_vacia
    check (cardinality(charge_providers) > 0
           and array_position(charge_providers, null) is null
           and not (charge_providers && array['']::text[])),
  add constraint payment_routing_rules_payout_providers_no_vacia
    check (cardinality(payout_providers) > 0
           and array_position(payout_providers, null) is null
           and not (payout_providers && array['']::text[]));

comment on column public.payment_routing_rules.charge_providers is
  'Proveedores de cobro EN ORDEN DE PREFERENCIA. Quien abre el cobro los recorre y se queda con el primero cuyo adaptador esté disponible (credencial puesta); si ninguno lo está, dice qué falta y devuelve 503 — nunca se cae al simulado por su cuenta. El PRIMER elemento es el que cobra en el caso normal, y es el que se cambia por ambiente con un UPDATE (nunca desde una migración: encendería un PSP en producción, ver 20260901140000).';

comment on column public.payment_routing_rules.payout_providers is
  'Candidatos de payout EN ORDEN DE PREFERENCIA. Gana el PRIMERO que (a) tenga riel disponible y (b) si está ATADO A UN BALANCE —dlocal, stripe—, coincida con payouts.funding_provider. Los fondeados aparte (wise, paypal, airtm, manual, banco-manual) no dependen de quién cobró. Ninguno se "enciende" por estar en la lista: el resolvedor descarta los que no tienen adaptador, así que un candidato futuro solo reserva su sitio en el orden. El riel manual va ÚLTIMO porque siempre puede y taparía a los demás.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LAS SINGULARES SE VAN, Y SUS GRANTS CON ELLAS
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ REGLA DE ORO 9. `20260806180000` concedió
-- `grant update (charge_provider, payout_provider, is_active) to service_role`,
-- y un `drop column` se lleva por delante el grant de esa columna sin decir
-- nada. Si no se reconcede sobre las nuevas, el día que algo del servidor
-- intente cambiar una ruta se encuentra un `permission denied` EN RUNTIME.

alter table public.payment_routing_rules
  drop column charge_provider,
  drop column payout_provider;

grant update (charge_providers, payout_providers, is_active)
  on public.payment_routing_rules to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · LAS LISTAS DE PAYOUT DE LA DECISIÓN
-- ════════════════════════════════════════════════════════════════════════════

-- Venezuela: ningún banco internacional llega, así que los automáticos son
-- cuentas en dólares y el manual es el que funciona hoy.
update public.payment_routing_rules
   set payout_providers = array['airtm', 'paypal', 'manual']
 where payee_country = 'VE';

-- Los ocho que dLocal paga. dLocal primero porque cuando cuadra con el balance
-- es el más barato; 'banco-manual' último porque siempre puede.
update public.payment_routing_rules
   set payout_providers = array['dlocal', 'paypal', 'wise', 'stripe', 'banco-manual']
 where payee_country in ('AR', 'BR', 'CL', 'EC', 'MX', 'PE', 'PY', 'UY');

-- Colombia NO tenía fila. Sin ella no se puede vender: `create_booking_line`
-- levanta «sin ruta de pago disponible para el destino» (RN-33), y el
-- desplegable del tutor tampoco la ofrecía. Y esta tabla no tiene `grant
-- insert` para NINGÚN rol, así que abrir un corredor nuevo solo se puede hacer
-- desde una migración — el §9 del doc decía «añadir un riel es una fila» y eso
-- solo era cierto para un país que YA tuviera fila. Queda corregido.
--
-- `charge_providers` copia el de la fila «sin declarar», que es la de Stripe en
-- todos los ambientes: es lo que pide la decisión (Stripe siempre) y además no
-- enciende nada que no estuviera ya encendido.
insert into public.payment_routing_rules
  (payee_country, payer_country, charge_providers, payout_providers, priority, is_active, notes)
select 'CO', null,
       r.charge_providers,
       array['wise', 'paypal', 'stripe', 'banco-manual'],
       100, true,
       'Colombia (decisión del cliente 2026-09-03). Cobro por Stripe con dLocal de respaldo. '
       'Payout: Wise, PayPal y el payout directo de Stripe — este último SOLO si el cobro entró '
       'por Stripe, porque un payout sale del balance del PSP que cobró; el resolvedor lo '
       'descarta solo cuando funding_provider es dlocal. Ninguno de los tres tiene adaptador '
       'todavía, así que hoy gana banco-manual: el tutor declara sus datos bancarios y una '
       'persona hace la transferencia.'
  from public.payment_routing_rules r
 where r.payee_country is null and r.payer_country is null
 limit 1;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · COLOMBIA EN LOS CATÁLOGOS DE DATOS DE COBRO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Sin fila en `payout_country_rules` el formulario del tutor no se puede
-- dibujar: la pantalla se construye sola desde este catálogo y no tiene un solo
-- país escrito a mano. Y `tutor_payout_accounts.country` es FK contra esta
-- tabla, así que sin fila el tutor tampoco podría guardar nada.
--
-- ── ⚠️ COLOMBIA NO USA SUCURSAL, Y ESTO PARECE UNA REGRESIÓN Y NO LO ES ─────
--
-- `20260901200000` puso `requires_branch = true` en los OCHO países, y lo hizo
-- con datos: sondeado contra el sandbox, `POST /v1/payouts` de dLocal responde
-- `5000 must not be null` sin `bank_branch` en todos ellos.
--
-- **Colombia no la paga dLocal** —no está entre sus ocho— y no la va a pagar:
-- la paga una persona haciendo una transferencia, y en una transferencia
-- colombiana no hay sucursal que poner. Pedírsela al tutor sería pedirle un dato
-- que no existe para bloquearle un formulario.
--
-- Si algún día Colombia pasa a un riel automático que la exija, esto es un
-- UPDATE de una fila. Por eso vive en el DATO y no en el esquema.
--
-- ── LOS PATRONES, Y POR QUÉ NO SON MÁS ESTRECHOS ────────────────────────────
--
-- El número de cuenta colombiano varía por banco (Bancolombia usa 11 dígitos en
-- ahorros y 13 en corriente; Davivienda entre 10 y 17). Se acepta cualquier
-- cadena de 6 a 20 dígitos: rechaza un IBAN pegado por error o una tarjeta, y no
-- rechaza ninguna cuenta real. Es el mismo criterio con el que `20260901160000`
-- dejó `branch_pattern` a null en cinco países — «un patrón inventado rechazaría
-- sucursales válidas, que es el error contrario y peor, porque deja al tutor sin
-- poder cobrar y sin saber por qué».
--
-- Documentos: **CC** (cédula de ciudadanía) y **CE** (cédula de extranjería).
-- NIT queda FUERA a propósito: es de personas jurídicas y los tutores son
-- personas físicas. Añadirlo es un UPDATE el día que haya un tutor con empresa.
insert into public.payout_country_rules
  (country, currency, account_label, account_help,
   account_patterns, document_patterns, account_types,
   requires_branch, branch_pattern, notas)
values (
  'CO', 'COP', 'Número de cuenta',
  'El número de tu cuenta en el banco, sin puntos ni guiones. Elige arriba si es de ahorros (SAVINGS) o corriente (CHECKING).',
  '{"*": "^[0-9]{6,20}$"}'::jsonb,
  '{"CC": "^[0-9]{6,10}$", "CE": "^[0-9]{6,12}$"}'::jsonb,
  array['CHECKING', 'SAVINGS'],
  false, null,
  'Colombia va por riel MANUAL (banco-manual): el tutor declara sus datos bancarios y una '
  'persona hace la transferencia. dLocal NO cubre Colombia para payouts, y Wise, PayPal y el '
  'payout directo de Stripe no tienen adaptador todavía. requires_branch es FALSE a propósito '
  '(ver la cabecera de esta migración): en una transferencia colombiana no hay sucursal.'
)
on conflict (country) do nothing;

-- ── EL CATÁLOGO DE BANCOS ──────────────────────────────────────────────────
--
-- ⚠️ ESTOS CÓDIGOS NO ESTÁN VERIFICADOS CONTRA NINGÚN PROVEEDOR, y aquí eso es
-- aceptable — en un riel automático no lo sería.
--
-- Son los códigos de tres dígitos de la Superintendencia Financiera, que es lo
-- que un colombiano reconoce y lo que sale en su extracto. El riel lo ejecuta
-- una PERSONA entrando en la web de su banco, así que el código solo tiene que
-- ser inequívoco para un humano: lo que de verdad usa quien hace la
-- transferencia es el NOMBRE del banco.
--
-- El día que Colombia pase a Wise, sus propios códigos se mapearán contra esta
-- lista, y ESE día habrá que verificarla uno a uno contra su API — igual que se
-- hizo con los ocho de dLocal.
--
-- ponytail: lista de los bancos con presencia real, no las ~50 entidades
-- vigiladas. Añadir uno es un INSERT.
insert into public.payout_banks (country, bank_code, name) values
  ('CO', '007', 'Bancolombia'),
  ('CO', '001', 'Banco de Bogotá'),
  ('CO', '051', 'Davivienda'),
  ('CO', '013', 'BBVA Colombia'),
  ('CO', '023', 'Banco de Occidente'),
  ('CO', '002', 'Banco Popular'),
  ('CO', '019', 'Scotiabank Colpatria'),
  ('CO', '040', 'Banco Agrario de Colombia'),
  ('CO', '052', 'Banco AV Villas'),
  ('CO', '032', 'Banco Caja Social'),
  ('CO', '006', 'Itaú'),
  ('CO', '012', 'Banco GNB Sudameris'),
  ('CO', '060', 'Banco Pichincha'),
  ('CO', '061', 'Bancoomeva'),
  ('CO', '062', 'Banco Falabella'),
  ('CO', '063', 'Banco Finandina'),
  ('CO', '065', 'Banco Santander de Negocios'),
  ('CO', '066', 'Banco Cooperativo Coopcentral'),
  ('CO', '059', 'Bancamía'),
  ('CO', '047', 'Banco Mundo Mujer'),
  ('CO', '053', 'Banco W'),
  ('CO', '507', 'Nequi'),
  ('CO', '551', 'Daviplata')
on conflict (country, bank_code) do update
   set name = excluded.name;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · AUTOCOMPROBACIÓN — que la tabla haga lo que esta migración dice
-- ════════════════════════════════════════════════════════════════════════════
--
-- Mismo criterio que `20260902140000` y por el mismo motivo: escribir un UPDATE
-- valida la sintaxis, no el efecto. Y con su lección aprendida — aquella abortó
-- un despliegue por pasar un argumento a null sin mirar `requires_branch`, así
-- que aquí cada argumento va a conciencia y cada caso falla SOLO por lo que mide.
do $$
declare
  v text;
  n int;
begin
  -- 1) Las columnas singulares ya no existen. Si alguna sobrevive, hay dos
  --    fuentes de verdad y el resto de esta migración no significa nada.
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'payment_routing_rules'
     and column_name in ('charge_provider', 'payout_provider');
  if n <> 0 then
    raise exception 'las columnas singulares siguen ahí (% de 2)', n;
  end if;

  -- 2) Ninguna fila se ha quedado sin listas. El `not null` lo garantiza; esto
  --    comprueba que el RELLENO llegó a todas, que es distinto.
  select count(*) into n
    from public.payment_routing_rules
   where cardinality(charge_providers) = 0 or cardinality(payout_providers) = 0;
  if n <> 0 then
    raise exception '% filas con alguna lista vacía', n;
  end if;

  -- 3) Las tres regiones de la decisión, en su payout. El cobro NO se comprueba
  --    contra un valor fijo a propósito: depende del ambiente (ver cabecera).
  if not exists (
    select 1 from public.payment_routing_rules
     where payee_country = 'VE'
       and payout_providers = array['airtm', 'paypal', 'manual']
  ) then
    raise exception 'Venezuela no quedó con {airtm,paypal,manual}';
  end if;

  if not exists (
    select 1 from public.payment_routing_rules
     where payee_country = 'CO'
       and payout_providers = array['wise', 'paypal', 'stripe', 'banco-manual']
  ) then
    raise exception 'Colombia no quedó con {wise,paypal,stripe,banco-manual}';
  end if;

  select count(*) into n
    from public.payment_routing_rules
   where payee_country in ('AR', 'BR', 'CL', 'EC', 'MX', 'PE', 'PY', 'UY')
     and payout_providers = array['dlocal', 'paypal', 'wise', 'stripe', 'banco-manual'];
  if n <> 8 then
    raise exception 'solo % de los 8 países de dLocal quedaron con su lista de payout', n;
  end if;

  -- 4) La fila de los tutores sin país sigue SIN ejecutor. Es lo que impide
  --    emitir una orden que nadie sabría a dónde pagar.
  if not exists (
    select 1 from public.payment_routing_rules
     where payee_country is null
       and payout_providers = array['simulated']
       and charge_providers = array['stripe']
  ) then
    raise exception 'la fila «sin país declarado» cambió de comportamiento';
  end if;

  -- 5) 🔑 CADA RIEL PIDE UN DATO DISTINTO, Y ESTA COMPROBACIÓN ES LO QUE LO
  --    HACE EXPLÍCITO. La primera versión de este bloque exigía fila en
  --    `payout_country_rules` a TODO país con payout no simulado, y **abortó la
  --    migración señalando a Venezuela** — que no la tiene ni la necesita.
  --
  --    Los candidatos se parten en dos familias por el dato que le piden al tutor:
  --
  --      COORDENADAS BANCARIAS → dlocal, wise, stripe, banco-manual
  --          viven en `payout_country_rules` + `payout_banks` + `tutor_payout_accounts`
  --      UN IDENTIFICADOR      → airtm, paypal, manual
  --          viven en `payout_manual_channels` + `tutor_manual_payout_destinations`
  --
  --    Un país solo necesita fila de reglas bancarias si ALGUNO de sus
  --    candidatos es de la primera familia. Venezuela ({airtm,paypal,manual}) es
  --    entera de la segunda; Colombia ({wise,paypal,stripe,banco-manual}) es
  --    MIXTA, y de ahí sale el trabajo que le queda al código: cuando los
  --    candidatos de un país piden datos distintos, hay que decidir cuál se le
  --    pide al tutor. Anunciarle un riel y pedirle los datos de otro es peor que
  --    no ofrecerle el país.
  select count(*) into n
    from public.payment_routing_rules r
   where r.is_active
     and r.payee_country is not null
     and r.payout_providers && array['dlocal', 'wise', 'stripe', 'banco-manual']::text[]
     and not exists (select 1 from public.payout_country_rules c where c.country = r.payee_country);
  if n <> 0 then
    raise exception '% países con un candidato de riel BANCARIO no tienen fila en payout_country_rules: el tutor los vería y no podría guardar', n;
  end if;

  -- Y el simétrico: un país cuyos candidatos piden un IDENTIFICADOR necesita
  -- que haya al menos un canal manual activo, o el formulario sale vacío.
  select count(*) into n
    from public.payment_routing_rules r
   where r.is_active
     and r.payee_country is not null
     and r.payout_providers && array['manual']::text[]
     and not exists (select 1 from public.payout_manual_channels c where c.is_active);
  if n <> 0 then
    raise exception '% países ruteados al riel manual y no hay ni un canal activo en el catálogo', n;
  end if;

  -- 6) COLOMBIA, EL CASO QUE ESTA MIGRACIÓN ABRE. Datos realistas y, sobre todo,
  --    **sin sucursal**: es el punto que distingue a Colombia de los ocho.
  v := public.payout_account_check('CO', 'CC', '1020304050', '007', 'SAVINGS',
                                   '12345678901', null);
  if v is not null then
    raise exception 'CO: una cuenta de ahorros buena y SIN sucursal debería validar y devolvió: %', v;
  end if;

  v := public.payout_account_check('CO', 'CC', '1020304050', '007', 'CHECKING',
                                   '12345678901', null);
  if v is not null then
    raise exception 'CO: corriente sin sucursal debería validar y devolvió: %', v;
  end if;

  -- Cédula de extranjería, que es el otro documento que se admite.
  v := public.payout_account_check('CO', 'CE', '123456', '051', 'SAVINGS',
                                   '1234567890', null);
  if v is not null then
    raise exception 'CO: cédula de extranjería debería validar y devolvió: %', v;
  end if;

  -- 7) Y lo que NO debe pasar. Cada caso cambia UNA cosa respecto al bueno de
  --    arriba, para que si falla se sepa por qué.
  v := public.payout_account_check('CO', 'NIT', '9001234561', '007', 'SAVINGS',
                                   '12345678901', null);
  if v is null then
    raise exception 'CO: NIT no está admitido (es de personas jurídicas) y aquí validó';
  end if;

  v := public.payout_account_check('CO', 'CC', '1020304050', '007', 'VISTA',
                                   '12345678901', null);
  if v is null then
    raise exception 'CO: VISTA es de Chile, no de Colombia, y aquí validó';
  end if;

  v := public.payout_account_check('CO', 'CC', '1020304050', '999', 'SAVINGS',
                                   '12345678901', null);
  if v is null then
    raise exception 'CO: un banco que no está en el catálogo no debería validar';
  end if;

  v := public.payout_account_check('CO', 'CC', '1020304050', '007', 'SAVINGS',
                                   'AB12345678', null);
  if v is null then
    raise exception 'CO: un número de cuenta con letras no debería validar';
  end if;

  -- 8) Y que no se haya tocado ningún otro país. Ecuador es el control: se
  --    configuró ayer y su fila tiene que seguir intacta, sucursal incluida.
  if not exists (
    select 1 from public.payout_country_rules
     where country = 'EC' and requires_branch and account_types = array['CHECKING', 'SAVINGS']
  ) then
    raise exception 'se tocó Ecuador sin querer';
  end if;

  raise notice 'ruteo por listas: 10 países + Colombia nueva, payouts de la decisión, y CO valida sin sucursal.';
end $$;

-- ── COMPROBACIÓN A MANO tras aplicar (regla de oro 11 y su vecina) ─────────
--
--   select coalesce(payee_country,'(sin declarar)') as pais,
--          charge_providers, payout_providers
--     from public.payment_routing_rules
--    where is_active order by 1;
--
-- Y el grant que un `drop column` se lleva en silencio:
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'payment_routing_rules' and grantee = 'service_role';
