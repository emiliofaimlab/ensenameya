-- ============================================================================
-- Enséñame Ya — Stripe vuelve, y esta vez el tutor no lo ve
--
-- Fase 5 de `docs/DICTADO-PAGOS.md`. **Decisión D-1: APROBADA por el cliente**
-- el 10-sep-2026 («si stripe entra como tercer riel»).
--
-- ── EN QUÉ SE PARECE Y EN QUÉ NO A LO QUE SE BORRÓ ─────────────────────────
--
-- El 9-sep se borró la familia 'conectada': el alta de Stripe Connect en la que
-- el tutor se daba de alta EN Stripe, veía su marca y les entregaba a ELLOS sus
-- coordenadas. Eso no vuelve.
--
-- Lo que vuelve es otra cosa: **la cuenta la creamos nosotros con los datos que
-- el tutor teclea en NUESTRO formulario**, y él no ve el nombre de Stripe en
-- ningún sitio. En su historial pone «Transferencia bancaria», igual que dLocal
-- y Wise. Es el punto 3b del dictado, literal: «jamás se enterará si fue hecho
-- con wise, con dlocal o con stripe».
--
-- ── LO QUE STRIPE PIDE, MEDIDO PAÍS POR PAÍS EL 10-SEP ─────────────────────
--
-- Se creó una cuenta de destinatario de verdad en cada país y se leyó su
-- `requirements.currently_due`. **Lo que pide NO es igual en todas partes**:
--
--     España            → nada más
--     México            → nada más
--     Colombia, Chile   → individual.id_number
--     Panamá            → individual.address.line1 y .city
--
-- 🔑 Y POR ESO EL ADAPTADOR NO LLEVA UN MAPA POR PAÍS. Stripe dice él mismo qué
-- le falta; nosotros mandamos todo lo que tenemos y dejamos que decida. Un mapa
-- nuestro sería una segunda lista de países que mantener sincronizada con la
-- suya, que es exactamente el error que ya se pagó con `wise_account_type`.
--
-- De todo eso, lo único que NO teníamos son dos cosas — y las dos las añade
-- esta migración: la **fecha de nacimiento** y la **aceptación de condiciones**.
-- El documento, la dirección, la ciudad, la provincia y el código postal ya
-- estaban desde las fases 2 y 3.
--
-- Receta completa verificada de punta a punta en España: crear la cuenta →
-- `business_type=individual` + nombre + fecha de nacimiento + aceptación →
-- adjuntar el IBAN → **`transfers: active`, `payouts_enabled: true`, cero
-- pendientes**.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · LOS DOS DATOS QUE FALTABAN
-- ════════════════════════════════════════════════════════════════════════════

alter table public.tutor_payout_accounts
  add column if not exists beneficiary_dob date,
  add column if not exists stripe_tos_accepted_at timestamptz,
  add column if not exists stripe_tos_ip inet;

-- ⚠️ NULLABLE, como sus vecinas de la fase 3 y por el mismo motivo: exigirlas
-- rompería el guardado a los tutores que ya tienen su fila y a los países que
-- cobran por dLocal o por Wise sin necesitarlas. Quien decide si hacen falta es
-- el RIEL en el momento de pagar, no el esquema.

comment on column public.tutor_payout_accounts.beneficiary_dob is
  'Fecha de nacimiento del titular. La exige Stripe para toda cuenta de destinatario de persona física (individual.dob.*), medido el 10-sep-2026: sin ella la cuenta se queda en requirements.past_due y transfers inactive. No la usan ni dLocal ni Wise. NULL = el tutor aún no la ha dado, y entonces el riel de Stripe se cae del ruteo con sin-datos en vez de atascar la orden.';

comment on column public.tutor_payout_accounts.stripe_tos_accepted_at is
  'Cuándo aceptó el tutor las condiciones de la cuenta de destinatario. Viaja a Stripe como tos_acceptance.date (en segundos). ⚠️ Es un dato LEGAL, no una marca de tiempo cualquiera: Stripe exige que sea el instante real en que la persona aceptó y que NO esté en el futuro (medido: rechaza con «Dates are expected to be integers, measured in seconds, not in the future»). Se escribe cuando el tutor marca la casilla, nunca por defecto.';

comment on column public.tutor_payout_accounts.stripe_tos_ip is
  'La IP desde la que el tutor aceptó las condiciones. Stripe la exige junto con la fecha (tos_acceptance.ip). Es el par que prueba la aceptación; sin cualquiera de los dos la cuenta no se activa.';

-- ── El grant, regla de oro 9 ───────────────────────────────────────────────
-- El job de payouts corre con `service_role` y lee estas columnas por la RPC de
-- abajo. Sin grant explícito se comería un `permission denied` EN TIEMPO DE
-- EJECUCIÓN —no en el build, no en el typecheck— que es la mordedura que este
-- proyecto ya se llevó tres veces el 6 de agosto.
grant select (beneficiary_dob, stripe_tos_accepted_at, stripe_tos_ip)
  on public.tutor_payout_accounts to service_role;

-- ⚠️ Y NINGÚN grant para `authenticated`: la fecha de nacimiento es un dato
-- personal y no hay una sola pantalla que necesite devolvérsela al navegador.
-- El formulario la manda; no la relee. Es el mismo criterio con el que
-- `beneficiary_document` y `bank_account` tampoco se leen desde el cliente.

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · EL BENEFICIARIO, EN LA FORMA QUE ESPERA STRIPE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Gemela de `payout_beneficiary` (dLocal) y `payout_beneficiary_wise`. Misma
-- disciplina que las dos: **revalida que la orden sea ejecutable antes de
-- soltar un solo dato**, que es lo que justifica que sea SECURITY DEFINER.
--
-- 🔑 DEVUELVE TODO LO QUE TENEMOS, no «lo que este país pide». Ver la cabecera:
-- quién decide qué hace falta es Stripe, y el adaptador manda el paquete entero.
-- Un campo de más se ignora; uno de menos deja la cuenta sin activar.

create or replace function public.payout_beneficiary_stripe(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.payouts;
  v_acc    public.tutor_payout_accounts;
  v_rules  public.payout_country_rules;
begin
  select * into v_payout from public.payouts where id = p_payout_id;
  if not found then
    raise exception 'no existe el payout %', p_payout_id using errcode = 'check_violation';
  end if;

  -- La misma puerta que las otras dos: una orden ya pagada no vuelve a soltar
  -- coordenadas bancarias.
  if v_payout.status not in ('scheduled'::public.payout_status, 'processing'::public.payout_status) then
    raise exception 'el payout está en % y no se puede ejecutar', v_payout.status
      using errcode = 'check_violation';
  end if;

  select * into v_acc from public.tutor_payout_accounts where tutor_id = v_payout.tutor_id;
  if not found then
    raise exception 'el tutor no tiene cuenta bancaria registrada' using errcode = 'check_violation';
  end if;

  select * into v_rules from public.payout_country_rules where country = v_acc.country;
  if not found then
    raise exception 'no hay reglas de cobro para %', v_acc.country using errcode = 'check_violation';
  end if;

  -- 🔴 LOS DOS DATOS QUE STRIPE NO PERDONA. Se comprueban aquí y no en el
  -- adaptador para que el fallo sea uno y con nombre: sin ellos la cuenta se
  -- queda en `past_due` y la transferencia falla con un mensaje de Stripe que no
  -- dice qué le pedimos al tutor.
  if v_acc.beneficiary_dob is null then
    raise exception 'falta la fecha de nacimiento del titular' using errcode = 'check_violation';
  end if;
  if v_acc.stripe_tos_accepted_at is null or v_acc.stripe_tos_ip is null then
    raise exception 'el tutor no ha aceptado las condiciones de la cuenta de cobro'
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'country',    v_acc.country,
    'currency',   lower(v_rules.currency),
    'first_name', v_acc.beneficiary_first_name,
    'last_name',  v_acc.beneficiary_last_name,
    'dob', jsonb_build_object(
      'day',   extract(day   from v_acc.beneficiary_dob)::int,
      'month', extract(month from v_acc.beneficiary_dob)::int,
      'year',  extract(year  from v_acc.beneficiary_dob)::int
    ),
    -- `id_number`: lo piden Colombia y Chile (medido). Es el mismo documento
    -- que ya le pedimos para dLocal, sin reformatear.
    'id_number', v_acc.beneficiary_document,
    'address', jsonb_build_object(
      'country',     v_acc.country,
      'line1',       v_acc.beneficiary_address_line,
      'city',        v_acc.beneficiary_city,
      'state',       v_acc.beneficiary_state,
      'postal_code', v_acc.beneficiary_postcode
    ),
    -- La cuenta destino. `bank_account` es el IBAN donde el formato es IBAN, y
    -- el número de cuenta donde no lo es; `bank_branch` es el segundo número
    -- (sort code, ruta ACH, BSB…), que Stripe llama `routing_number`.
    'account_number', v_acc.bank_account,
    'routing_number', nullif(btrim(coalesce(v_acc.bank_branch, '')), ''),
    'account_holder_name', v_acc.beneficiary_first_name || ' ' || v_acc.beneficiary_last_name,
    -- La aceptación, en el formato que pide Stripe: segundos, no milisegundos.
    'tos_date', extract(epoch from v_acc.stripe_tos_accepted_at)::bigint,
    'tos_ip',   host(v_acc.stripe_tos_ip)
  );
end $$;

comment on function public.payout_beneficiary_stripe(uuid) is
  'El beneficiario de un payout en la forma que espera la API de cuentas conectadas de Stripe. Gemela de payout_beneficiary (dLocal) y payout_beneficiary_wise: revalida que la orden sea ejecutable antes de soltar coordenadas, que es lo que justifica el SECURITY DEFINER. Devuelve TODO lo que tenemos y no «lo que este país pide»: quién decide eso es Stripe con requirements.currently_due, y un mapa nuestro por país sería una segunda lista que mantener. Levanta excepción con nombre propio cuando falta la fecha de nacimiento o la aceptación de condiciones, que son los dos únicos datos que Stripe no perdona.';

revoke execute on function public.payout_beneficiary_stripe(uuid) from public;
revoke execute on function public.payout_beneficiary_stripe(uuid) from anon;
revoke execute on function public.payout_beneficiary_stripe(uuid) from authenticated;
grant  execute on function public.payout_beneficiary_stripe(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · STRIPE VUELVE AL RUTEO — DETRÁS DE WISE
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔑 EL ORDEN NO ES CAPRICHO. La decisión D-5 del dictado dice que manda el FEE
-- entre los rieles que cubren el país. De los tres:
--
--   · dLocal va primero donde paga: el dinero ya está en su balance porque él lo
--     cobró, así que no hay que moverlo.
--   · Wise va después: su coste está medido corredor a corredor.
--   · **Stripe va el último de los tres**, y por una razón honesta: su fee de
--     payout no está publicado ni medido. Ponerlo por delante de Wise sería
--     ordenar por una estimación, que es justo lo que el dictado prohíbe.
--
-- El día que se mida y salga más barato, se adelanta con otra migración. Eso es
-- un `update` de una lista, no un cambio de código.
--
-- ⚠️ SOLO DONDE STRIPE PUEDE CREAR LA CUENTA. Medido el 9-sep con
-- `POST /v1/accounts` país por país: falla en **US y BR** —porque nuestra
-- plataforma es estadounidense y el acuerdo `recipient` no vale de US a US/BR—
-- y en VE, CU, RU, IR, UA, HN y NI. Meterlo donde no puede crear la cuenta
-- sería un candidato que se elige, no encuentra destino y deja la orden
-- esperando: el fallo silencioso que este proyecto ya conoce.

-- ⚠️ SOLO 17 FILAS, Y NO PORQUE STRIPE LLEGUE A 17 PAÍSES. Llega a 54 de los 60
-- probados. Lo que pasa es que esta tabla tiene **19 filas de país** y una fila
-- POR DEFECTO que cubre a todos los demás: España, Alemania, Japón y los otros
-- ~176 rutean por ahí, así que enumerarlos aquí no añadiría ni una fila. Se
-- listan los que SÍ tienen fila propia y donde Stripe puede crear la cuenta.
--
-- Fuera de la lista, medido el 9-sep con `POST /v1/accounts` uno a uno:
--   · **Brasil** — el acuerdo `recipient` no vale de una plataforma en US a BR.
--   · **Venezuela** — Stripe no admite cuentas venezolanas. Ver abajo.

with cubre_stripe(pais) as (
  values ('AR'),('BO'),('CL'),('CO'),('CR'),('DO'),('EC'),('GT'),('ID'),('KE'),
         ('MX'),('MY'),('NG'),('PA'),('PE'),('PY'),('UY')
)
update public.payment_routing_rules r
   set payout_providers = array_append(r.payout_providers, 'stripe')
  from cubre_stripe c
 where r.payee_country = c.pais
   and r.is_active
   and not ('stripe' = any(r.payout_providers));

-- La fila POR DEFECTO: es la que de verdad abre Stripe al mundo, porque cubre a
-- todo país sin regla propia — España incluida, que es donde se verificó la
-- receta entera contra la API.
--
-- ⚠️ Y METE AHÍ DENTRO A ESTADOS UNIDOS, donde Stripe NO puede crear la cuenta
-- (misma razón que Brasil: plataforma estadounidense). Es correcto y es a
-- propósito: el adaptador devolverá `sin-datos` para ese tutor y la orden bajará
-- al siguiente candidato, que es Wise — el único que paga a EE. UU. Separar la
-- fila de US solo para quitarle un candidato que ya se cae solo sería una fila
-- más que mantener a cambio de nada.
update public.payment_routing_rules
   set payout_providers = array_append(payout_providers, 'stripe')
 where es_por_defecto and is_active and not ('stripe' = any(payout_providers));

-- ⚠️ VENEZUELA NO. Ni Stripe, ni Wise, ni dLocal llegan: es el único país del
-- mundo que ninguno alcanza, y por eso es el único con canales manuales. La
-- autocomprobación de abajo lo fija para que nadie lo añada sin querer.

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · AUTOCOMPROBACIÓN
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_ve text[];
  v_es text[];
begin
  select payout_providers into v_ve from public.payment_routing_rules where payee_country = 'VE';
  if 'stripe' = any(v_ve) then
    raise exception 'Venezuela no puede tener a Stripe: no admite cuentas venezolanas';
  end if;
  if not ('manual' = any(v_ve)) then
    raise exception 'Venezuela perdió su riel manual, que es su única vía';
  end if;

  -- España es el caso que se verificó de punta a punta contra la API.
  --
  -- ⚠️ SE PREGUNTA POR `ruta_de_pago('ES')` Y NO POR SU FILA, porque España NO
  -- TIENE FILA: rutea por la de por defecto, como los otros ~176 países sin
  -- regla propia. Esta comprobación miraba `payee_country = 'ES'` y por eso
  -- levantó excepción con el ruteo bien escrito — la caza la hizo ella misma.
  select (public.ruta_de_pago('ES')).payout_providers into v_es;
  if v_es is null or not ('stripe' = any(v_es)) then
    raise exception 'España tendría que poder cobrar por Stripe y no lo resuelve';
  end if;

  -- Y Stripe va DETRÁS de Wise donde los dos están: es el orden por fee de D-5.
  if exists (
    select 1 from public.payment_routing_rules
     where is_active
       and 'stripe' = any(payout_providers) and 'wise' = any(payout_providers)
       and array_position(payout_providers, 'stripe') < array_position(payout_providers, 'wise')
  ) then
    raise exception 'hay un país con Stripe por delante de Wise: su fee no está medido y ese orden sería una estimación';
  end if;
end $$;
