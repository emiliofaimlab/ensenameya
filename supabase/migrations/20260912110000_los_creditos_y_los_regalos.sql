-- ============================================================================
-- Enséñame Ya — los CRÉDITOS (recompensa de referido) y los REGALOS
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- El diagrama aprobado el 11-sep dice dos cosas que hoy no existen en la base:
--
--   1) La campaña de referidos decide su premio. Puede ser **una mentoría
--      gratis** (con tope en dinero, 30 días, y en un paquete cubre UNA y el
--      alumno paga el resto) o **dinero**: a un TUTOR se le suma a su próximo
--      cobro y le llega solo; a un ALUMNO le queda como saldo y paga solo la
--      diferencia. O sea: pago partido en los dos casos.
--   2) Se puede REGALAR una mentoría: quien regala elige tutor y mentoría y
--      paga íntegro por adelantado; al destinatario le aparece en «Mis
--      reservas» pendiente de agendar y él elige día y hora. Caduca, con aviso.
--
-- Las tres promesas son la misma fila: `public.credits`. Lo que cambia entre
-- ellas es QUIÉN PUSO EL DINERO (`source`) y POR DÓNDE SALE (`destino`), que es
-- lo único que el payout necesita saber.
--
-- El fondeo —`payments.credit_amount`, `funding_provider`,
-- `platform_funded_amount`, `payouts.adjustment_amount` y
-- `payout_adjustments`— lo crea `20260912100000_el_fondeo_sabe_quien_pone_el_
-- dinero.sql`, que se aplica ANTES que esta. Aquí se dan por hechas.
--
-- ── LO QUE HAY QUE SABER (y muerde) ────────────────────────────────────────
--
-- 🔴 EL CERROJO DEL COBRO ABIERTO ESTABA VACÍO, Y ERA UNA IMPRENTA DE DINERO.
--    El diseño original refusaba `aplicar_credito`/`quitar_credito` cuando
--    `payments.provider_payment_id is not null` o `provider_metadata ?
--    'checkout'`. Ninguna de las dos se escribe al abrir un cobro por el camino
--    normal: `provider_payment_id` lo escriben los webhooks DESPUÉS de que el
--    dinero se mueva (`src/app/api/webhooks/stripe/route.ts:171`) —salvo dLocal,
--    que sí sella antes (`src/lib/payments/dlocal-provider.ts:256`)— y
--    `anotarCobrador` solo corre cuando gana un candidato distinto del snapshot
--    (`src/app/api/pagos/checkout/route.ts:872`), o sea casi nunca. Secuencia:
--    aplicar crédito → abrir Session de Stripe por `gross − credit` → quitar el
--    crédito → pagar la Session vieja. El crédito vuelve a `active` y la reserva
--    queda `paid`. Ilimitado, sin carrera y desde una cuenta de alumno normal.
--
--    Se cierra con un MARCADOR POSITIVO escrito al abrir el cobro
--    (`payments.checkout_opened_at` / `checkout_amount`, más abajo, con su RPC
--    `marcar_cobro_abierto`) y, en profundidad, con `confirm_payment`
--    CONCILIANDO el importe contra `gross_amount - credit_amount`. Eso último
--    cambia su firma → `drop function` + `create` y reponer los `grant execute`
--    (regla de oro 12; sus llamadores son los dos webhooks y
--    `confirm_order_payment`, `20260911180000:70`).
--
--    ⚠️ EL MARCADOR NO SE ESCRIBE SOLO. `/api/pagos/checkout` tiene que llamar
--    a `marcar_cobro_abierto` **siempre** que abra un cobro, justo antes de
--    devolver la pantalla. Mientras ese cambio no esté desplegado, el marcador
--    es null y la conciliación de `confirm_payment` no actúa: la migración es
--    compatible hacia atrás a propósito (los 127 pagos de dev no tienen
--    marcador), pero el agujero sigue abierto hasta que aterrice el Route
--    Handler. Está dicho aquí porque no hay build en rojo que lo recuerde.
--
--    ⚠️ Y TIENE CONSECUENCIA EN LA PANTALLA: con el marcador puesto, aplicar o
--    quitar un crédito DESPUÉS de abrir el cobro queda prohibido (salvo que el
--    importe ya cuadre). O sea que el selector de crédito va ANTES de llamar a
--    `/api/pagos/checkout`, no al lado del formulario de tarjeta. Es la única
--    forma segura: una Session de Stripe es inmutable una vez creada, así que
--    cualquier cambio posterior del crédito deja al alumno pagando un importe
--    que ya no es el debido.
--
-- ⚠️ `credits_mentoria_entera` hacía que la mentoría gratis NO FUNCIONARA NUNCA.
--    `check (kind <> 'mentoria' or consumed_amount in (0, amount))` contra un
--    `consumed_amount += lo que cubre` revienta en cuanto la mentoría elegida
--    cuesta menos que el tope (o sea siempre). Aquí el `amount` de un
--    `kind='mentoria'` es un TOPE: al canjear se consume ENTERO
--    (`consumed_amount := amount`) y el importe real vive en
--    `payments.credit_amount`. El sobrante es de la plataforma, que es lo que el
--    diagrama quiere decir con «una mentoría gratis».
--
-- ⚠️ `on conflict on constraint credits_recompensa_unica` NO COMPILA EN
--    EJECUCIÓN: la idempotencia es un ÍNDICE ÚNICO PARCIAL y un índice parcial
--    no tiene fila en `pg_constraint`. Se infiere por columnas + `where`. Y eso
--    es TODA la idempotencia de la recompensa: sin ella, `/api/cron/referrals-
--    sync` acuña un premio por pasada horaria y el workflow sale en verde igual.
--
-- ⚠️ `citext` NO ESTÁ INSTALADO (dev tiene pgcrypto, pg_cron, pg_trgm,
--    btree_gist, unaccent, uuid-ossp y nada más). El correo del regalo es `text`
--    normalizado con `lower(btrim(...))` y una constraint que lo obliga.
--
-- ⚠️ EL REGALO SE ATA AL CORREO AL **CONFIRMARLO**, NUNCA EN `handle_new_user`.
--    Ese trigger corre en el INSERT de `auth.users`, con el correo sin probar —
--    él mismo lo sabe: mira `new.email_confirmed_at` antes de encolar NTF-24
--    (`20260911200000`). Atar ahí un regalo pagado significa que quien registre
--    primero esa dirección se lo lleva (en dev, donde la confirmación está
--    apagada) o lo deja bloqueado para siempre (en prod, donde está encendida).
--    Se ata en `notify_email_confirmed()` —el trigger de la confirmación,
--    `20260911200000:171`— y con `reclamar_mis_regalos()`, que exige que el
--    correo del PROPIO `auth.uid()` esté confirmado.
--
-- ⚠️ `service_role` NO recibe `insert` ni `update` sobre `credits`. Todos los
--    escritores son `security definer` y corren como el dueño, así que los
--    grants de tabla no les hacen falta (la regla de oro 9 muerde en el acceso
--    DIRECTO, y aquí el único directo es de lectura). Con `grant update
--    (beneficiary_id)`, cualquier Route Handler con `createAdminClient()` podría
--    transferir cualquier crédito del sistema: es la misma forma del agujero de
--    `profiles` que se tapó el 11-sep (`20260911140000`).
--
-- ⚠️ Y AL NAVEGADOR NO SE LE DA `grant select` DE TABLA: se le dan las COLUMNAS
--    que necesita y dos vistas `security_invoker`. `provider`,
--    `provider_payment_id`, `provider_metadata`, `payer_country`,
--    `checkout_opened_at` y `checkout_amount` se quedan fuera: son del cobro del
--    regalo y el destinatario no tiene por qué verlos. (`purchased_by` sí entra,
--    y no es un descuido: lo necesita `mis_regalos_comprados`; el porqué está
--    junto al `grant`.)
--
-- ⚠️ REGLA 10 (embeds ambiguos): `credits` tiene TRES FK a `profiles`
--    (`beneficiary_id`, `referred_profile_id`, `purchased_by`) y una a
--    `products`. Cualquier `.select("…, products(title)")` de PostgREST sobre
--    esta tabla hay que NOMBRARLO —`products!credits_product_id_fkey(title)`— y
--    **mirar el `error`**: esto alimenta la tarjeta de «Mis reservas», que es
--    una cola de cosas por hacer, y un `const { data } = …` la deja vacía
--    mintiendo.
--
-- ⚠️ REGLA 11 (un cron que falla no se lo dice a nadie). Los dos barridos
--    nuevos son diarios, así que NO salen en «las diez últimas filas». Después
--    de aplicar, en dev Y en prod dos días después:
--
--      select j.jobname, d.status, count(*)
--        from cron.job_run_details d join cron.job j using (jobid)
--       where j.jobname in ('caducar-creditos','avisar-creditos-por-expirar')
--       group by 1, 2 order by 1, 2;
--
-- ⚠️ ORDEN DE DESPLIEGUE: **Vercel primero, `db:push` después** (igual que
--    `20260911180000`). Si la base encola `gift_received` y el despliegue no
--    tiene esa clave en `PLANTILLAS`, `renderEmail` devuelve null, el job marca
--    `failed` PERMANENTE y la `idempotency_key` gastada impide reencolarlo: el
--    regalo se pierde y nadie se entera.
--
-- ── LO QUE ENTRÓ EN LA REVISIÓN CRUZADA (y por qué está aquí y no allí) ─────
--
-- 🔴 `refund_payment` VIVE AHORA EN ESTE FICHERO (§6.1). La versión de
--    `20260912100000` devolvía el crédito con `consumed_amount − lo que cubrió`
--    y eso revienta con `check_violation` contra `credits_mentoria_entera` en
--    CUALQUIER mentoría gratis que no cueste exactamente el tope, o sea en el
--    caso normal: el reembolso del admin moría en pantalla. Aquí delega en
--    `reembolsar_con_credito`, que es también lo que deja UNA SOLA fórmula de
--    reparto en toda la plataforma (la acumulada).
--
-- 🔴 LAS DOS FK A `credits` LAS PONE ESTA MIGRACIÓN (§15 bis). El bloque
--    condicional de `20260912100000` solo actúa si `credits` ya existe, y
--    aplicándose antes —el único orden que funciona— eso es false.
--
-- 🔴 EL FONDEO NO SE REIMPLEMENTA (§8.2): `aplicar_credito` llama a
--    `public.fondeo_del_cobro()`. Había dos aritméticas y la de aquí sumaba las
--    dos cajas; un payout se ejecuta contra UNA, y esa diferencia es una orden
--    `failed` por saldo semanas después.
--
-- 🔴 EL CERROJO DEL COBRO ABIERTO YA CUBRE EL REGALO (§10.1):
--    `credits.checkout_opened_at` / `checkout_amount` + `marcar_cobro_regalo` y
--    `marcar_cobro_regalo_abierto`, y `confirm_gift_payment` concilia.
--
-- Además: `aplicar_credito` mira `expires_at` (el barrido es diario, así que
-- «active» no significa «vigente»); `notify_payment()` deja de mandar el PRECIO
-- como si fuera lo cobrado (§13); la baja de cuenta ve el dinero de `credits`
-- (§14); hay `revertir_regalo` para el contracargo de un regalo ya canjeado
-- (§10.5); `expire_stale_bookings` no puede tumbar la pasada entera por una fila
-- (§11); y `comprar_regalo` tiene tope de regalos sin pagar.
--
-- ⚠️ Y DOS COSAS MÁS PARA EL DESPLIEGUE:
--    · NTF-04 y NTF-10 cambian el VALOR de `amount` y `refunded` (ahora dicen
--      lo que de verdad se cobró y se devolvió) y ganan claves aditivas. Las
--      plantillas de hoy siguen renderizando; las dos líneas —«135 a tu tarjeta,
--      45 a tu saldo»— son trabajo de plantilla, Vercel primero.
--    · `refund_payment` devuelve `credit_lost` y `cancel_booking`
--      `refund_credit_perdido`: lo que una mentoría gratis NO puede reponer a
--      medias. Si la pantalla no lo enseña, el alumno ve un importe menor que el
--      prometido sin explicación.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 0 · La política del regalo, en un sitio y no en seis
-- ════════════════════════════════════════════════════════════════════════════
--
-- El diagrama dice «caduca, con aviso por correo» y no dice el número. 90 días
-- es lo que se implementa. Vive en una función y no en un literal repetido
-- porque lo leen `confirm_gift_payment`, la pantalla y los legales, y porque el
-- día que el cliente lo cambie tiene que cambiar en UN sitio.
--
-- ⚠️ Su espejo en el navegador es `GIFT_POLICY.diasParaAgendar` en
-- `src/lib/policy.ts` (donde ya viven `HOLD_POLICY` y RN-37). Los dos números
-- tienen que decir lo mismo; no hay nada que lo compruebe solo.
create or replace function public.gift_expiry_days()
returns int
language sql
immutable
as $fn$ select 90 $fn$;

comment on function public.gift_expiry_days() is
  'Días que tiene el destinatario de un regalo para AGENDARLO desde que se cobra. Espejo de GIFT_POLICY.diasParaAgendar en src/lib/policy.ts: si cambia uno hay que cambiar el otro a mano.';

revoke execute on function public.gift_expiry_days() from public;
revoke execute on function public.gift_expiry_days() from anon;
grant  execute on function public.gift_expiry_days() to authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `public.credits` — la promesa
-- ════════════════════════════════════════════════════════════════════════════
--
-- Sin enums nuevos: `text` + `check`, igual que `referral_campaigns.audience`
-- (`20260911120000:56`) y por la misma razón que dejó `payments.provider` en
-- `text`: el cliente va a añadir un cuarto tipo de recompensa y
-- `alter type … add value` es un trago que esta migración no tiene por qué
-- dejar preparado.
--
-- FUERA A PROPÓSITO: nada de `credit_redemptions`. Una tabla con FK a
-- `payments` **y** a `payouts` sería un SEGUNDO puente entre esas dos tablas —y
-- ya hay uno, `payout_items`, que `src/app/(app)/tutor/payouts/page.tsx:260`
-- embebe— o sea el `PGRST201` de la regla de oro 10 servido en bandeja. El
-- consumo se lleva con `payments.credit_id` (alumno) y `payout_adjustments`
-- (tutor): un camino cada uno.
create table if not exists public.credits (
  id                   uuid        primary key default gen_random_uuid(),

  -- QUIÉN lo tiene. Null SOLO mientras un regalo espera a que su destinatario
  -- exista y confirme su correo (ver `beneficiary_email` y §S3 de la cabecera).
  beneficiary_id       uuid        references public.profiles (id) on delete restrict,
  beneficiary_email    text,

  -- DE DÓNDE SALE EL DINERO, que es lo único que el payout necesita saber:
  -- 'referral' lo pone la plataforma; 'gift' ya se cobró.
  source               text        not null check (source in ('referral','gift')),

  -- QUÉ ES. 'mentoria' = todo o nada contra el precio de UNA sesión (el
  -- `amount` es el TOPE); 'saldo' = se consume por partes.
  kind                 text        not null check (kind in ('mentoria','saldo')),

  -- POR DÓNDE SALE. 'cobro' financia un `payments`; 'payout' se suma al próximo
  -- cobro del tutor. Se CONGELA al emitir y no se deriva del rol en el momento
  -- del canje: un tutor que además es alumno no puede gastarse como saldo lo
  -- que el diagrama manda pagarle por su banco.
  destino              text        not null check (destino in ('cobro','payout')),

  status               text        not null default 'active'
                       check (status in ('pending_payment','active','consumed',
                                         'expired','refunded','revoked')),

  amount               bigint      not null check (amount > 0),
  consumed_amount      bigint      not null default 0 check (consumed_amount >= 0),
  currency             char(3)     not null,

  -- Solo 'gift': la mentoría concreta que se regaló. Null en las recompensas,
  -- que valen para cualquier mentoría hasta el tope.
  product_id           uuid        references public.products (id) on delete restrict,

  -- Trazabilidad de la recompensa (solo 'referral').
  referral_campaign_id integer     references public.referral_campaigns (rf_campaign_id) on delete restrict,
  referred_profile_id  uuid        references public.profiles (id) on delete restrict,

  -- El cobro DEL REGALO. Vive aquí y no en `payments` porque `payments` es el
  -- dinero de UNA RESERVA (`booking_id` es `not null unique`,
  -- `20260709140000:97`) y un regalo todavía no es una reserva. Hacer
  -- `booking_id` nullable dejaría sin significado a `tutor_net_amount`,
  -- `tier_split_pct` y `payee_country` en esas filas, y haría que
  -- `build_payout_for_tutor` las excluyera POR ACCIDENTE (vía su join a
  -- `bookings`) en vez de por decisión.
  purchased_by         uuid        references public.profiles (id) on delete restrict,
  gift_message         text,
  provider             text,
  provider_payment_id  text,
  provider_metadata    jsonb,
  -- El marcador POSITIVO del cobro del regalo: los hermanos de
  -- `payments.checkout_opened_at` / `checkout_amount` (§3). Sin ellos el cerrojo
  -- del cobro abierto NO cubría el regalo: `marcar_cobro_abierto` solo acepta
  -- `booking_ids` y un regalo no tiene reserva. Los escriben
  -- `marcar_cobro_regalo_abierto` y `marcar_cobro_regalo` (§10.1), y los
  -- concilia `confirm_gift_payment` antes de activar nada.
  checkout_opened_at   timestamptz,
  checkout_amount      bigint,
  payer_country        char(2),

  expires_at           timestamptz,
  issued_at            timestamptz,
  consumed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint credits_consumo_acotado check (consumed_amount <= amount),

  -- Un crédito con dueño o con correo, nunca sin ninguno de los dos.
  constraint credits_tiene_dueno check (
    beneficiary_id is not null or beneficiary_email is not null),

  -- `citext` no existe en esta base: la normalización se declara.
  constraint credits_correo_normalizado check (
    beneficiary_email is null or beneficiary_email = lower(btrim(beneficiary_email))),

  -- 'mentoria' es todo o nada. Y «todo» significa el TOPE ENTERO: ver la
  -- cabecera. Lo que de verdad cubrió vive en `payments.credit_amount`.
  constraint credits_mentoria_entera check (
    kind <> 'mentoria' or consumed_amount in (0, amount)),

  -- Un regalo SIEMPRE apunta a un producto y a quien lo pagó; una recompensa
  -- nunca apunta a producto y SIEMPRE tiene campaña y dueño. Lo segundo no es
  -- adorno: sin `beneficiary_id not null`, el índice único de abajo dejaría de
  -- serlo (en Postgres dos NULL no colisionan) y la recompensa se emitiría dos
  -- veces.
  constraint credits_forma_por_origen check (
    (source = 'gift'
       and product_id is not null and purchased_by is not null
       and referral_campaign_id is null and referred_profile_id is null)
 or (source = 'referral'
       and product_id is null and referral_campaign_id is not null
       and referred_profile_id is not null and beneficiary_id is not null)),

  -- Un crédito destinado al payout no caduca (el diagrama: «le llega solo»)…
  constraint credits_payout_no_caduca check (destino <> 'payout' or expires_at is null),
  -- …y es dinero, nunca una mentoría.
  constraint credits_payout_es_saldo check (destino <> 'payout' or kind = 'saldo'),

  -- Un regalo nace SIN COBRAR y con su riel elegido; una recompensa nace ya
  -- activa y sin riel, porque no hay nada que cobrar.
  constraint credits_regalo_con_riel check (
    source <> 'gift' or provider is not null)
);

comment on table public.credits is
  'La promesa de dinero que todavía no es una reserva: la recompensa de un referido y el regalo de una mentoría. `payments` = el dinero de una reserva; `credits` = dinero que aún no lo es. El consumo se lleva en payments.credit_id (alumno) y payout_adjustments (tutor): un camino cada uno, para no crear un segundo puente entre payments y payouts (regla de oro 10).';

comment on column public.credits.beneficiary_id is
  'Quién puede gastarlo. Null solo en un regalo cuyo destinatario todavía no tiene cuenta CON EL CORREO CONFIRMADO: lo aterriza reclamar_regalos_por_correo() desde el trigger de la confirmación, nunca handle_new_user.';
comment on column public.credits.beneficiary_email is
  'Correo del destinatario de un regalo, en minúsculas y sin espacios (citext no está instalado en esta base). Es la llave con la que el regalo encuentra a su dueño cuando éste confirma su correo.';
comment on column public.credits.source is
  'QUIÉN PUSO EL DINERO: ''referral'' lo pone la plataforma (hay que fondearlo antes del ciclo de payouts); ''gift'' ya entró por un PSP y su caja está en `provider`.';
comment on column public.credits.kind is
  '''mentoria'': todo o nada contra el precio de UNA mentoría, y `amount` es el TOPE (el sobrante no se devuelve). ''saldo'': dinero que se gasta por partes.';
comment on column public.credits.destino is
  'POR DÓNDE SALE, congelado al emitir: ''cobro'' financia un payments del alumno; ''payout'' se suma al próximo cobro del tutor por payout_adjustments. No se deriva del rol al canjear: un tutor que además es alumno no puede gastarse como saldo lo que toca pagarle al banco.';
comment on column public.credits.amount is
  'Unidades mínimas de `currency` (convención de esquema: dinero en bigint, nunca float). Con kind=''mentoria'' es un TOPE, no un importe a consumir.';
comment on column public.credits.consumed_amount is
  'Lo gastado. Con kind=''saldo'' crece por partes; con kind=''mentoria'' solo vale 0 o `amount` — al canjear se gasta el tope ENTERO y el importe real queda en payments.credit_amount. Ver credits_mentoria_entera.';
comment on column public.credits.product_id is
  'Solo en un regalo: la mentoría concreta que se regaló. Una recompensa vale para cualquiera hasta el tope, y por eso aquí es null.';
comment on column public.credits.provider is
  'Solo en un regalo: el PSP que COBRÓ el regalo, o sea DÓNDE ESTÁ LA CAJA con la que se pagará al tutor cuando se canjee. Lo lee aplicar_credito para decidir payments.funding_provider.';
comment on column public.credits.provider_metadata is
  'El rastro del cobro del regalo, con la misma forma que payments.provider_metadata: `checkout.cobrador` es el candidato de la cadena que lo abrió, y es lo que permite que recargar la pantalla de pago reencuentre el cobro abierto en vez de abrir otro. La escribe marcar_cobro_regalo (§10.1); NO hay grant de update para service_role, a propósito (S7).';
comment on column public.credits.provider_payment_id is
  'El identificador del cargo en el PSP (pi_…, el token de dLocal). Lo sella marcar_cobro_regalo ANTES de redirigir —dLocal lo exige (src/lib/payments/dlocal-provider.ts:256)— y es por donde el webhook del regalo reencuentra su fila (credits_provider_pid_idx).';
comment on column public.credits.checkout_opened_at is
  'Cuándo se abrió un cobro para este regalo (UTC). El hermano de payments.checkout_opened_at: marcador POSITIVO, escrito al abrir, que es lo único que dice «hay un checkout vivo por ahí». Lo escribe marcar_cobro_regalo_abierto.';
comment on column public.credits.checkout_amount is
  'Unidades mínimas por las que se abrió ese cobro, sacadas de la BASE (credits.amount), nunca del Route Handler. confirm_gift_payment lo concilia contra amount y contra lo que diga el webhook antes de activar el regalo: es la simetría que le faltaba a confirm_payment.';
comment on column public.credits.expires_at is
  'UTC. Null = no caduca (es lo que exige credits_payout_no_caduca para destino=''payout''). Lo barre caducar_creditos() y lo avisa avisar_creditos_por_expirar().';
comment on column public.credits.referred_profile_id is
  'El REFERIDO cuya conversión disparó la recompensa (el premio es para beneficiary_id, que es el referidor). Es la tercera pata del índice credits_recompensa_unica, y por eso su FK es restrict: con `set null` los NULL dejarían de colisionar y el premio se podría emitir dos veces.';


-- ── Idempotencia de la recompensa ───────────────────────────────────────────
--
-- 🔴 ESTO ES TODA LA IDEMPOTENCIA DEL PREMIO DE REFERIDO. `/api/cron/referrals-
-- sync` corre cada hora y responde 200 aunque no haga nada (CLAUDE.md), así que
-- sin este índice el workflow saldría en VERDE acuñando un premio por pasada.
--
-- ⚠️ Es un ÍNDICE PARCIAL, no una constraint: en PostgreSQL una unique
-- constraint no admite `WHERE`, así que NO hay fila en `pg_constraint` y
-- `on conflict on constraint credits_recompensa_unica` levantaría
-- «constraint … does not exist» EN EJECUCIÓN — `create function` valida la
-- sintaxis, no ejecuta el cuerpo (regla de oro 11). Se infiere por columnas +
-- el mismo predicado: ver `emitir_credito_de_referido`.
create unique index if not exists credits_recompensa_unica
  on public.credits (beneficiary_id, referral_campaign_id, referred_profile_id)
  where source = 'referral'
    and beneficiary_id is not null
    and referral_campaign_id is not null
    and referred_profile_id is not null;

-- Lo que pregunta el selector del checkout: mis créditos usables, hoy.
create index if not exists credits_usables_idx
  on public.credits (beneficiary_id, currency)
  where status = 'active' and destino = 'cobro';

-- Lo que pregunta el lote de payouts (build_payout_for_tutor, run_payout_batch).
create index if not exists credits_payout_idx
  on public.credits (beneficiary_id, currency)
  where status = 'active' and destino = 'payout';

-- El regalo sin reclamar, por correo.
create index if not exists credits_por_correo_idx
  on public.credits (beneficiary_email)
  where beneficiary_id is null;

-- Los dos barridos de pg_cron.
create index if not exists credits_caducidad_idx
  on public.credits (expires_at)
  where status = 'active' and expires_at is not null;

-- El webhook del regalo reencuentra su crédito por aquí.
create index if not exists credits_provider_pid_idx
  on public.credits (provider_payment_id)
  where provider_payment_id is not null;

drop trigger if exists credits_set_updated_at on public.credits;
create trigger credits_set_updated_at
  before update on public.credits
  for each row execute function public.set_updated_at();


-- ── RLS: default-deny, y SIN políticas de escritura ─────────────────────────
--
-- Un crédito NACE en una RPC `security definer`. Si `authenticated` pudiera
-- insertar, se acuñaría dinero desde el navegador: es el mismo razonamiento que
-- deja a `user_roles` sin políticas de escritura (RN-31/S-31).
alter table public.credits enable row level security;

drop policy if exists "credits_select_own" on public.credits;
create policy "credits_select_own" on public.credits for select
  using ( (select auth.uid()) = beneficiary_id );

-- El comprador ve el regalo que pagó (estado y caducidad), no otra cosa: las
-- columnas del cobro no están en su `grant`.
drop policy if exists "credits_select_comprador" on public.credits;
create policy "credits_select_comprador" on public.credits for select
  using ( (select auth.uid()) = purchased_by );

drop policy if exists "credits_select_admin" on public.credits;
create policy "credits_select_admin" on public.credits for select
  using ( public.has_role('admin') );


-- ── Grants (auto-expose OFF; la RLS es la barrera, el grant solo deja llegar) ─
--
-- ⚠️ AL NAVEGADOR, POR COLUMNAS. Un `grant select` de tabla le daría al
-- destinatario del regalo el `provider_payment_id` y el `payer_country` de
-- quien lo pagó, y al comprador el `beneficiary_id` — que es una respuesta
-- gratis a «¿tiene esta dirección cuenta en Enséñame Ya?». Las columnas del
-- cobro se quedan fuera y la forma se la dan las dos vistas de abajo.
--
-- ⚠️ `purchased_by` ENTRA EN LA LISTA Y NO ES UN DESCUIDO: `mis_regalos_
-- comprados` lo usa en su `where`, y con `security_invoker = true` los
-- privilegios de columna se comprueban contra QUIEN INVOCA, no contra el dueño
-- de la vista — o sea que sin él la vista responde «permission denied». Un uuid
-- suelto no dice nada de nadie: `profiles` es own-only (sus únicas políticas de
-- select son profiles_select_own y profiles_select_admin).
grant select (
  id, beneficiary_id, beneficiary_email, purchased_by, source, kind, destino,
  status, amount, consumed_amount, currency, product_id, referral_campaign_id,
  gift_message, expires_at, issued_at, consumed_at, created_at
) on public.credits to authenticated;

-- ⚠️ REGLA DE ORO 9, y solo `select`. `service_role` se salta la RLS pero NO
-- los grants de tabla, y con «auto-expose new tables» en OFF un job comería
-- `permission denied` EN EJECUCIÓN. Lo lee `/api/pagos/checkout` para abrir el
-- cobro del regalo y `/api/cron/*` para sus cuentas.
--
-- ⚠️ Y NADA MÁS QUE `select`. Ni `insert` ni `update`: todos los escritores
-- (emitir_credito_de_referido, comprar_regalo, confirm_gift_payment,
-- aplicar_credito, quitar_credito, marcar_cobro_regalo[_abierto],
-- revertir_regalo, los dos barridos) son `security definer` y corren como el
-- dueño, así que no necesitan grant. Con `grant update (beneficiary_id)`,
-- cualquier Route Handler con `createAdminClient()` podría transferirse
-- cualquier crédito del sistema. Y por eso el sellado del cobro del regalo es
-- una RPC y no un `update` desde el Route Handler: sin ella, `provider_payment_id`
-- y `provider_metadata` eran dos columnas que NADIE podía escribir.
grant select on public.credits to service_role;

-- `anon` no recibe nada, a propósito.


-- ── Las dos vistas por las que el navegador ve sus créditos ─────────────────
--
-- `security_invoker = true` SIEMPRE y columnas explícitas, nunca `c.*`
-- (precedente: `tutors_public`, `20260804120000`): sin el invoker la vista
-- correría con los privilegios de su dueño y publicaría lo que las políticas
-- tapaban, y con `*` lo que se añada mañana a la tabla se colaría solo.
create or replace view public.mis_creditos
with (security_invoker = true) as
  select c.id,
         c.source,
         c.kind,
         c.destino,
         c.status,
         c.amount,
         c.consumed_amount,
         (c.amount - c.consumed_amount) as restante,
         c.currency,
         c.product_id,
         c.referral_campaign_id,
         c.gift_message,
         c.expires_at,
         c.issued_at,
         c.consumed_at,
         c.created_at
    from public.credits c
   where c.beneficiary_id = (select auth.uid());

comment on view public.mis_creditos is
  'Mis créditos: la recompensa de referido y el regalo que me hicieron. security_invoker: hereda la RLS de credits (credits_select_own). Es lo que pinta la tarjeta de /reservas y el selector del checkout; las columnas del cobro del regalo no salen por aquí.';

create or replace view public.mis_regalos_comprados
with (security_invoker = true) as
  select c.id,
         c.status,
         c.amount,
         c.currency,
         c.product_id,
         c.beneficiary_email,
         c.gift_message,
         c.expires_at,
         c.issued_at,
         c.consumed_at,
         c.created_at,
         (c.consumed_at is not null) as canjeado
    from public.credits c
   where c.source = 'gift'
     and c.purchased_by = (select auth.uid());

comment on view public.mis_regalos_comprados is
  'Los regalos que YO pagué: en qué estado están y hasta cuándo. security_invoker: hereda la RLS de credits (credits_select_comprador). NO expone beneficiary_id: saber si esa dirección tiene cuenta es un oráculo de existencia y no hace falta para nada que la pantalla enseñe.';

grant select on public.mis_creditos            to authenticated;
grant select on public.mis_regalos_comprados   to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Qué recompensa da cada campaña — lo que el admin edita
-- ════════════════════════════════════════════════════════════════════════════
--
-- `audience` NO se toca: sigue decidiendo la REGLA DE CONVERSIÓN
-- (`referral_conversions_pending`, `20260911120000:283-295`). `reward_kind`
-- decide el PREMIO. Son dos preguntas distintas y mezclarlas es lo que rompería
-- la campaña 50784.
alter table public.referral_campaigns
  add column if not exists reward_kind         text     not null default 'ninguna',
  add column if not exists reward_amount       bigint,
  add column if not exists reward_currency     char(3),
  add column if not exists reward_expires_days smallint not null default 30;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'referral_campaigns_reward_kind_check') then
    alter table public.referral_campaigns
      add constraint referral_campaigns_reward_kind_check
      check (reward_kind in ('ninguna','mentoria','saldo'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'referral_campaigns_reward_amount_check') then
    alter table public.referral_campaigns
      add constraint referral_campaigns_reward_amount_check
      check (reward_amount is null or reward_amount > 0);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'referral_campaigns_reward_dias_check') then
    alter table public.referral_campaigns
      add constraint referral_campaigns_reward_dias_check
      check (reward_expires_days between 1 and 365);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'referral_campaigns_premio_completo') then
    alter table public.referral_campaigns
      add constraint referral_campaigns_premio_completo
      check (reward_kind = 'ninguna'
             or (reward_amount is not null and reward_currency is not null));
  end if;
end $$;

comment on column public.referral_campaigns.reward_kind is
  'Qué ofrece la campaña (diagrama del 11-sep). ''mentoria'' = 1 mentoría gratis con TOPE en dinero = reward_amount; ''saldo'' = dinero. ''ninguna'' es el default a propósito: una campaña traída de RF no reparte nada hasta que el admin lo diga, igual que `visible` nace en false.';
comment on column public.referral_campaigns.reward_amount is
  'Unidades mínimas de reward_currency. Con ''mentoria'' es el TOPE: si la mentoría elegida cuesta más, el crédito no se puede usar ahí (no se prorratea). Con ''saldo'' es el importe del premio.';
comment on column public.referral_campaigns.reward_currency is
  'ISO-4217, al lado del importe (convención de esquema). NO se convierte nada al canjear: un crédito en USD no sirve para una reserva en COP y el selector lo dice con motivo=''tu saldo está en otra moneda''. /admin/referidos debería rechazar una moneda que no use ningún producto activo.';
comment on column public.referral_campaigns.reward_expires_days is
  '30 por defecto, el del diagrama. Solo aplica a créditos con destino=''cobro'': la recompensa del tutor va a su payout y no caduca (credits_payout_no_caduca).';

comment on column public.referral_campaigns.reward_text is
  'La línea que LEE el usuario, la sigue editando el admin (DP-32.1). ⚠️ Ahora hay dos cosas acopladas: /admin/referidos tiene que avisar si reward_text dice «US$ 10» y reward_amount dice 1500. No hay constraint que pueda comprobar eso.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · EL MARCADOR DEL COBRO ABIERTO — el cerrojo que faltaba (crítico)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 Ver la cabecera. El cerrojo del diseño original miraba la AUSENCIA de dos
-- señales que se escriben tarde o no se escriben. Aquí se escribe una señal
-- POSITIVA al abrir el cobro, con el importe por el que se abrió, y
-- `aplicar_credito` / `quitar_credito` / `confirm_payment` la miran.
--
-- El importe se guarda POR LÍNEA (`gross_amount - credit_amount` de ESA fila) y
-- no el total del pedido: así la conciliación de `confirm_payment` vale igual
-- para una reserva suelta y para cada línea de un `orders`, que es por donde
-- pasa `confirm_order_payment` (`20260911180000:70`).
alter table public.payments
  add column if not exists checkout_opened_at timestamptz,
  add column if not exists checkout_amount    bigint;

comment on column public.payments.checkout_opened_at is
  'Cuándo se abrió un cobro para esta línea (UTC). Marcador POSITIVO: es lo único que dice «hay una Session/checkout viva por ahí». No se puede deducir de provider_payment_id (lo escriben los webhooks DESPUÉS del pago; dLocal es la excepción) ni de provider_metadata.checkout (anotarCobrador solo corre cuando gana un candidato distinto del snapshot). Lo escribe marcar_cobro_abierto.';
comment on column public.payments.checkout_amount is
  'Unidades mínimas por las que se abrió ese cobro, o sea gross_amount - credit_amount EN EL MOMENTO DE ABRIRLO. Cambiar el crédito después de abrir el cobro es lo que permitía pagar una Session vieja por menos de lo debido; aplicar_credito y quitar_credito solo lo consienten si el importe sigue cuadrando, y confirm_payment lo concilia antes de marcar paid.';

create or replace function public.marcar_cobro_abierto(p_booking_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n int := 0;
begin
  if p_booking_ids is null or array_length(p_booking_ids, 1) is null then
    return 0;
  end if;

  -- Solo sobre cobros vivos: un pago ya resuelto no tiene checkout que marcar,
  -- y reescribirle el marcador sería mentir sobre lo que se cobró.
  --
  -- El importe sale de la BASE, no del navegador ni del Route Handler (regla de
  -- oro 2): quien abre el cobro pasa los sujetos, no el dinero.
  update public.payments p
     set checkout_opened_at = now(),
         checkout_amount    = p.gross_amount - coalesce(p.credit_amount, 0)
   where p.booking_id = any(p_booking_ids)
     and p.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function public.marcar_cobro_abierto(uuid[]) is
  'Sella en payments que se ha abierto un cobro y por cuánto. ⚠️ /api/pagos/checkout tiene que llamarla SIEMPRE que abra un cobro (reserva, pedido o regalo), justo antes de devolver la pantalla, y no solo cuando gana un candidato de respaldo: mientras no lo haga, el marcador es null y el cerrojo de aplicar_credito/quitar_credito vuelve a estar vacío. No hay build en rojo que lo recuerde.';

revoke execute on function public.marcar_cobro_abierto(uuid[]) from public;
revoke execute on function public.marcar_cobro_abierto(uuid[]) from anon;
revoke execute on function public.marcar_cobro_abierto(uuid[]) from authenticated;
grant  execute on function public.marcar_cobro_abierto(uuid[]) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Devolver un crédito que financiaba un cobro que se cayó
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 EL AGUJERO QUE CIERRA. `expire_stale_bookings` cancela toda reserva
-- `pending_payment` de más de 7 MINUTOS (no 20: `20260826120000:76`) y su cron
-- corre CADA MINUTO. El destinatario de un regalo agenda → `aplicar_credito`
-- consume el crédito → el checkout devuelve `{modo:"credito"}` → y el navegador
-- tiene que hacer una SEGUNDA llamada a `/api/pagos/credito`. Si cierra la
-- pestaña, se le cae el wifi o el Route Handler falla entre las dos, en ≤ 7
-- minutos el cron cancela la reserva y el regalo que alguien pagó de verdad
-- queda `consumed` para siempre. Lo mismo con `confirm_payment(false)` cuando
-- la tarjeta se rechaza. En dev, 42 de 127 pagos están en `failed`: una de cada
-- tres reservas muere sin pagar. No es un caso raro.
--
-- ⚠️ ORDEN DE BLOQUEO: `payments` → `credits`, SIEMPRE, en las tres puertas.
-- `aplicar_credito` bloquea en ese orden y `refund_payment` ya bloquea
-- `payments` → `payouts`; invertirlo aquí crearía el ciclo que hoy no existe.
create or replace function public.liberar_credito_de_pago(p_payment_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_p record;
  v_c record;
begin
  -- `payments` primero, y con candado: es el mismo orden que toma
  -- `aplicar_credito`.
  select p.id, p.credit_id, coalesce(p.credit_amount, 0) as credit_amount, p.provider,
         p.status
    into v_p
  from public.payments p
  where p.id = p_payment_id
  for update;

  if v_p.id is null or v_p.credit_id is null or v_p.credit_amount = 0 then
    return 0;
  end if;

  select c.* into v_c from public.credits c where c.id = v_p.credit_id for update;
  if v_c.id is null then
    return 0;
  end if;

  update public.credits c
     set consumed_amount = case
           -- 'mentoria' es todo o nada: el tope volvió entero.
           when c.kind = 'mentoria' then 0
           else greatest(0, c.consumed_amount - v_p.credit_amount)
         end,
         -- ⚠️ 'expired' TAMBIÉN vuelve a 'active'. Si no, un crédito que el
         -- barrido nocturno marcó caducado mientras financiaba un cobro que
         -- luego se cayó se quedaría muerto con el dinero dentro.
         status = case when c.status in ('consumed','expired') then 'active' else c.status end,
         consumed_at = null,
         -- Siete días de gracia para que la caducidad no se lo coma al minuto
         -- siguiente de devolverlo. Solo en 'cobro': un crédito de payout no
         -- caduca y ponerle fecha violaría credits_payout_no_caduca.
         expires_at = case
           when c.destino = 'cobro' and c.expires_at is not null
             then greatest(c.expires_at, now() + interval '7 days')
           else c.expires_at
         end
   where c.id = v_c.id;

  -- Y el pago deja de decir que lo financia un crédito. Se pone a cero TAMBIÉN
  -- `platform_funded_amount` y se devuelve `funding_provider` a `provider`:
  -- si no, `fondeo_del_ciclo` seguiría pidiéndole a operaciones que ponga
  -- dinero para un cobro que ya no existe.
  --
  -- ⚠️ Y EL MARCADOR DEL COBRO ABIERTO SE LIMPIA, PERO SOLO SI EL PAGO YA ESTÁ
  -- MUERTO. Hoy las tres puertas automáticas dejan `payments.status = 'failed'`
  -- antes de llamar aquí, así que la invariante «marcador limpio ⇒ no hay
  -- checkout vivo» se sostenía por accidente; esto la hace explícita.
  --
  -- 🔴 PERO NO SE PUEDE LIMPIAR SIEMPRE, y esto es lo contrario de intuitivo:
  -- `quitar_credito` llama aquí con el pago todavía `pending`. Si le borrásemos
  -- el marcador, la Session que está viva ahí fuera —por el BRUTO, que es lo
  -- único que el cerrojo de `quitar_credito` consiente— dejaría de verse, y la
  -- llamada siguiente a `aplicar_credito` vería `v_abierto = false`, aplicaría
  -- un crédito y dejaría al alumno pagando el bruto por una reserva que ya debe
  -- menos: `confirm_payment` abortaría el webhook para siempre. O sea que
  -- limpiarlo de más reabre por otro sitio justo lo que §3 cierra.
  update public.payments p
     set credit_id              = null,
         credit_amount          = 0,
         platform_funded_amount = 0,
         funding_provider       = v_p.provider,
         checkout_opened_at     = case when v_p.status = 'pending'
                                       then p.checkout_opened_at else null end,
         checkout_amount        = case when v_p.status = 'pending'
                                       then p.checkout_amount else null end
   where p.id = v_p.id;

  return v_p.credit_amount;
end;
$fn$;

comment on function public.liberar_credito_de_pago(uuid) is
  'Devuelve al crédito lo que financiaba un cobro que NUNCA se cobró (expire_stale_bookings rama 1, confirm_payment(false), cancel_booking sin pagar, quitar_credito). Bloquea payments y luego credits, que es el orden de aplicar_credito. Revive también los créditos que el barrido nocturno hubiera marcado expired mientras el cobro seguía abierto. Limpia el marcador de cobro abierto SOLO si el pago ya está muerto: con el pago pendiente (quitar_credito) el checkout sigue vivo y borrarlo reabriría el agujero de §3.';

revoke execute on function public.liberar_credito_de_pago(uuid) from public;
revoke execute on function public.liberar_credito_de_pago(uuid) from anon;
revoke execute on function public.liberar_credito_de_pago(uuid) from authenticated;
grant  execute on function public.liberar_credito_de_pago(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · `enqueue_refund` — el cinturón: no se devuelve efectivo que nunca entró
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 Reserva de 180 pagada con 45 de crédito y 135 de tarjeta. El alumno
-- cancela a menos de 24 h → RN-37 al 50 % → `round(180 * 50 / 100) = 90` contra
-- un cargo de 135. El PSP lo acepta: **el alumno puso 135 y recibe 90**, cuando
-- lo suyo eran 67,5. Y al 100 % es peor: 180 contra un cargo de 135, que Stripe
-- rechaza en cada pasada del cron, para siempre, con `payments.status` diciendo
-- `refunded`.
--
-- El tope de esta función ya existía por este mismo razonamiento; lo único que
-- le faltaba era saber que parte del cobro no la puso una tarjeta. Con la línea
-- cambiada, cada uno de esos casos —y el cuarto llamador que alguien añada en
-- marzo— es una transacción abortada a gritos en vez de efectivo saliendo
-- callado.
--
-- `create or replace`: la firma NO cambia, así que la regla 12 no se dispara y
-- los privilegios se conservan.
create or replace function public.enqueue_refund(p_payment_id uuid, p_amount bigint, p_reason text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_pay      record;
  v_provider text;
  v_status   public.refund_request_status;
  v_tope     bigint;
begin
  -- Sin importe no hay reembolso que encolar. Pasa constantemente y no es un
  -- error: cancelar una reserva que nunca se cobró, un segundo camino que llega
  -- cuando ya se devolvió todo, o —desde los créditos— un cobro financiado al
  -- 100 % por un regalo, donde la parte en efectivo es exactamente 0.
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  select p.id, p.booking_id, p.currency, p.gross_amount, p.provider, p.provider_payment_id,
         coalesce(p.credit_amount, 0) as credit_amount
    into v_pay
  from public.payments p
  where p.id = p_payment_id;

  if v_pay.id is null then
    raise exception 'pago % no encontrado al encolar el reembolso', p_payment_id
      using errcode = 'no_data_found';
  end if;

  -- 🔴 EL TOPE, Y AHORA SABE DE CRÉDITOS. Lo que la pasarela cobró de verdad es
  -- `gross_amount - credit_amount`; devolver por encima de eso es devolver
  -- dinero que el alumno nunca puso. Este parámetro lo calcula el llamador y un
  -- error suyo aquí es la clase de fallo que no se descubre hasta que lo dice
  -- el PSP —o hasta que no lo dice nadie—. Que reviente la transacción entera y
  -- no se cancele nada es infinitamente mejor.
  --
  -- ⚠️ DOS HALLAZGOS SE CONTRADICEN AQUÍ Y HAY QUE ELEGIR. Uno pide este tope
  -- (`gross - credit`); el otro lo pide con `- refunded_amount` dentro. Va sin
  -- él, y no por comodidad: `cancel_booking` escribe `refunded_amount` ANTES de
  -- encolar el tramo (es el orden que tiene desde X-01, y cambiarlo rompe su
  -- acumulado), así que con `- refunded_amount` una cancelación legítima al
  -- 50 % de un cobro de 180 con 45 de crédito abortaría: el tope saldría 45 y
  -- el tramo en efectivo es 68. El caso que ese otro hallazgo describe —el
  -- admin devolviendo 45 de un mixto— NO lo cierra un tope, lo cierra PARTIR EL
  -- TRAMO: `public.reembolsar_con_credito`. Este tope es el cinturón para el
  -- llamador que se olvide de usarla.
  v_tope := v_pay.gross_amount - v_pay.credit_amount;
  if p_amount > v_tope then
    raise exception 'reembolso de % sobre un cobro de % con % de crédito (pago %): a la pasarela solo le entraron %',
      p_amount, v_pay.gross_amount, v_pay.credit_amount, p_payment_id, v_tope
      using errcode = 'check_violation',
            hint = 'La parte del crédito se devuelve al crédito, no a la tarjeta: usa public.reembolsar_con_credito().';
  end if;

  v_provider := coalesce(v_pay.provider, 'simulated');

  -- ⚠️ LOS COBROS SIMULADOS NO EXISTEN EN NINGÚN PSP. Se encolan igual —la cola
  -- es el registro completo de todo lo que se prometió devolver— pero nacen
  -- resueltos. Si se dejaran 'pending', el job los reintentaría contra Stripe
  -- para siempre, fallando en cada pasada por un `pi_…` que nunca existió, y
  -- ese ruido acabaría tapando un reembolso de verdad atascado. Toda la base
  -- de dev está llena de estos.
  --
  -- ⚠️ Y DESDE LOS CRÉDITOS, UN SEGUNDO CASO CON LA MISMA FORMA: un cobro sin
  -- `provider_payment_id`. Un pago que llegó a `paid` siempre lo tiene (lo sella
  -- el webhook, o dLocal antes de redirigir); si no lo tiene es que nadie cobró
  -- nada —el caso del canje 100 % crédito, que va a `paid` por
  -- `confirm_credit_booking` sin pasar por ninguna pasarela—. Encolarlo
  -- 'pending' envenenaría la cola exactamente igual.
  if v_provider = 'simulated' or v_pay.provider_payment_id is null then
    v_status := 'skipped';
  else
    v_status := 'pending';
  end if;

  insert into public.refund_requests (
    payment_id, booking_id, idempotency_key, provider, provider_payment_id,
    amount, currency, reason, status, processed_at
  )
  values (
    v_pay.id, v_pay.booking_id, p_key, v_provider, v_pay.provider_payment_id,
    p_amount, v_pay.currency, p_reason, v_status,
    case when v_status = 'skipped' then now() end
  )
  on conflict (idempotency_key) do nothing;   -- camino 1 de la idempotencia
end;
$fn$;

comment on function public.enqueue_refund(uuid, bigint, text, text) is
  'X-01 · encola un reembolso. Desde los créditos su tope es gross_amount - credit_amount (lo que de verdad entró por la pasarela) y no gross_amount: devolver por encima de eso es efectivo saliendo por dinero que el alumno nunca puso. Un cobro sin provider_payment_id nace ''skipped'' por la misma razón que los simulados: no hay nada que devolver y la cola no se envenena.';


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Reembolsar partiendo el tramo: lo que fue tarjeta a la tarjeta, lo que
--     fue crédito al crédito
-- ════════════════════════════════════════════════════════════════════════════
--
-- Los tres caminos de reembolso (cancel_booking RN-37, expire_stale_bookings
-- rama 2 RN-38, y refund_payment del admin) calculaban su tramo sobre
-- `gross_amount`. Ninguno sabía qué era un crédito. Aquí el cálculo se hace UNA
-- vez y los llamadores no calculan nada.
--
-- 🔴 UNA SOLA FÓRMULA DE REPARTO, Y ES LA ACUMULADA. Había dos escritas: ésta
-- repartía POR TRAMO (`round(delta * efectivo / gross)`) y `refund_payment`
-- sobre el ACUMULADO. Mezcladas sobre el mismo pago difieren: tres parciales de
-- un tercio sobre un cobro impar pueden sumar un céntimo más que el efectivo que
-- de verdad entró, y ese céntimo lo rechaza el PSP —o no lo rechaza nadie—. La
-- acumulada es exacta por construcción:
--
--     cash(este tramo) = round((ya_devuelto + delta) * efectivo / gross)
--                      - round( ya_devuelto          * efectivo / gross)
--
-- Con gross 180, crédito 45 (efectivo 135) y dos cancelaciones del 50 %: 68 y
-- 67. Suman 135, ni uno más.
--
-- ⚠️ POR ESO `p_ya_devuelto` ES UN ARGUMENTO Y NO SE LEE DE LA FILA: los tres
-- llamadores escriben `payments.refunded_amount` en momentos distintos
-- (`cancel_booking` ANTES de llamar aquí —es su orden desde X-01—;
-- `expire_stale_bookings` y `refund_payment` DESPUÉS), así que la fila no puede
-- decir sola si lo que lleva dentro es el acumulado de antes o el de después.
-- Pedirlo explícito hace imposible equivocarse, y de paso deja de importar el
-- orden.
--
-- ⚠️ `drop function` + `create` y no `create or replace` (regla de oro 12): la
-- versión de trabajo de esta migración tuvo cuatro argumentos y en una base
-- donde se hubiera aplicado, un `create or replace` con cinco dejaría una
-- SOBRECARGA y PostgREST respondería `PGRST203`. El `drop` de la vieja es
-- inofensivo donde nunca existió.
drop function if exists public.reembolsar_con_credito(uuid, bigint, text, text);

create or replace function public.reembolsar_con_credito(
  p_payment_id  uuid,
  p_delta       bigint,
  p_ya_devuelto bigint,
  p_reason      text,
  p_key         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_p        record;
  v_c        record;
  v_efectivo bigint := 0;   -- lo que la pasarela cobró de verdad
  v_ya       bigint := greatest(0, coalesce(p_ya_devuelto, 0));
  v_cash     bigint := 0;
  v_credito  bigint := 0;
  v_perdido  bigint := 0;   -- lo que le tocaba al crédito y no se puede reponer
begin
  if p_delta is null or p_delta <= 0 then
    return jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
  end if;

  select p.id, p.gross_amount, coalesce(p.credit_amount, 0) as credit_amount,
         p.credit_id, p.refunded_amount
    into v_p
  from public.payments p
  where p.id = p_payment_id
  for update;

  if v_p.id is null then
    raise exception 'pago % no encontrado al repartir el reembolso', p_payment_id
      using errcode = 'no_data_found';
  end if;

  v_efectivo := v_p.gross_amount - v_p.credit_amount;

  -- El reparto es proporcional a cómo se pagó, sobre el ACUMULADO (ver arriba).
  -- Con `gross_amount` a 0 (no existe hoy, pero el `check` de payments permite
  -- 0) no se divide por cero, y sin crédito el tramo es entero: la aritmética
  -- de siempre, sin un redondeo de más.
  if v_p.credit_amount = 0 or v_p.gross_amount = 0 then
    v_cash := p_delta;
  else
    v_cash := round((v_ya + p_delta)::numeric * v_efectivo / v_p.gross_amount)
            - round( v_ya::numeric            * v_efectivo / v_p.gross_amount);
  end if;
  v_cash    := least(greatest(v_cash, 0), p_delta);
  v_credito := p_delta - v_cash;

  -- El tramo en efectivo, por la cola de siempre. Su tope ya sabe de créditos.
  perform public.enqueue_refund(v_p.id, v_cash, p_reason, p_key);

  -- El tramo del crédito, de vuelta al crédito. Un premio no puede morir porque
  -- el tutor canceló.
  if v_credito > 0 and v_p.credit_id is not null then
    select c.* into v_c from public.credits c where c.id = v_p.credit_id for update;

    if v_c.id is not null then
      if v_c.kind = 'mentoria' then
        -- ⚠️ TODO O NADA, Y ESO TIENE CONSECUENCIA. `credits_mentoria_entera`
        -- no admite medias: un 'mentoria' solo puede volver ENTERO. Así que
        -- solo se repone cuando vuelve todo lo que financió — o sea en las
        -- cancelaciones al 100 %. En una cancelación tardía al 50 % el premio
        -- se pierde, que es exactamente lo que le pasa a la mitad del dinero de
        -- quien pagó con tarjeta. Prorratearlo sería violar la constraint;
        -- reponerlo entero sería regalar una mentoría por cancelar tarde.
        if v_credito >= v_p.credit_amount then
          update public.credits c
             set consumed_amount = 0,
                 status = case when c.status in ('consumed','expired') then 'active' else c.status end,
                 consumed_at = null,
                 expires_at = case
                   when c.destino = 'cobro' and c.expires_at is not null
                     then greatest(c.expires_at, now() + interval '7 days')
                   else c.expires_at
                 end
           where c.id = v_c.id;
        else
          -- Se pierde, y el jsonb lo dice honestamente en vez de callárselo: es
          -- lo que la pantalla tiene que poder enseñar («45 de tu recompensa no
          -- se reponen»), porque si no el alumno ve un importe devuelto menor
          -- que el prometido y no hay dónde leer por qué.
          v_perdido := v_credito;
          v_credito := 0;
        end if;
      else
        update public.credits c
           set consumed_amount = greatest(0, c.consumed_amount - v_credito),
               status = case when c.status in ('consumed','expired') then 'active' else c.status end,
               consumed_at = case
                 when greatest(0, c.consumed_amount - v_credito) = 0 then null
                 else c.consumed_at end,
               expires_at = case
                 when c.destino = 'cobro' and c.expires_at is not null
                   then greatest(c.expires_at, now() + interval '7 days')
                 else c.expires_at
               end
         where c.id = v_c.id;
      end if;
    end if;
  elsif v_p.credit_id is null then
    -- Sin crédito detrás no hay a dónde devolver este tramo. No se pierde: el
    -- `credit_amount` solo puede ser > 0 con `credit_id` no nulo
    -- (`payments_credito_con_dueno`), así que aquí v_credito ya era 0.
    v_credito := 0;
  end if;

  -- ⚠️ `payments.credit_amount` NO se toca: es el SNAPSHOT de cuánto financió
  -- el crédito, y de él cuelga el tope de `enqueue_refund` para los tramos que
  -- vengan después (un reembolso parcial no es el último).
  return jsonb_build_object('cash', v_cash, 'credit', v_credito,
                            'credito_perdido', v_perdido);
end;
$fn$;

comment on function public.reembolsar_con_credito(uuid, bigint, bigint, text, text) is
  'Parte un reembolso entre lo que cobró la pasarela y lo que puso un crédito, y devuelve cada tramo a donde salió. LA ÚNICA fórmula de reparto de la plataforma, y es la acumulada: la usan cancel_booking (RN-37), expire_stale_bookings (RN-38) y refund_payment (US-704). `p_ya_devuelto` es el acumulado ANTERIOR y va explícito porque los tres llamadores escriben refunded_amount en momentos distintos. Devuelve {cash, credit, credito_perdido}: el tercero es lo que una mentoría gratis no puede reponer a medias.';

revoke execute on function public.reembolsar_con_credito(uuid, bigint, bigint, text, text) from public;
revoke execute on function public.reembolsar_con_credito(uuid, bigint, bigint, text, text) from anon;
revoke execute on function public.reembolsar_con_credito(uuid, bigint, bigint, text, text) from authenticated;
grant  execute on function public.reembolsar_con_credito(uuid, bigint, bigint, text, text) to service_role;


-- ── 6.1 · `refund_payment` — el reembolso del admin, por la misma puerta ────
--
-- 🔴 LO QUE ESTO ARREGLA REVIENTA EN PANTALLA EN EL CASO NORMAL. La versión de
-- `20260912100000:959` devuelve el crédito con
-- `consumed_amount - <lo que cubrió>`, y `aplicar_credito` consume el TOPE
-- ENTERO en un `kind='mentoria'` (`consumed_amount := amount`; ver §8.2 y la
-- cabecera). Los dos números solo coinciden si la mentoría cuesta exactamente
-- el tope. Con tope 1500 y mentoría de 1200: `1500 − 1200 = 300`, y
-- `credits_mentoria_entera` —que solo admite 0 o `amount`— levanta
-- `check_violation`. **El reembolso del admin muere en pantalla**, y es el caso
-- normal de esta funcionalidad, no un borde. Lo mismo con un regalo cuyo
-- producto bajó de precio.
--
-- Se arregla donde tenía que arreglarse: delegando en
-- `public.reembolsar_con_credito`, que ya trae la rama `kind='mentoria'`
-- correcta (todo o nada) y la fórmula acumulada. Con eso, además, LAS TRES
-- RUTAS DE REEMBOLSO DE LA PLATAFORMA REPARTEN CON LA MISMA ARITMÉTICA, que era
-- la otra mitad del problema: antes había dos fórmulas (acumulada aquí, por
-- tramo allí) y mezclarlas sobre el mismo pago derivaba un céntimo.
--
-- Se reescribe en ESTA migración y no en la de antes porque
-- `reembolsar_con_credito` nace aquí: allí todavía no existe. Todo lo demás
-- —el candado del payout, el guardián de 'processing', H-5 y S-4— se copia
-- LETRA POR LETRA de `20260912100000:817-1035`, que a su vez partió de la
-- versión viva. La firma NO cambia → `create or replace`, la regla de oro 12 no
-- se dispara y el ACL ({postgres=X, authenticated=X}) sobrevive.
create or replace function public.refund_payment(
  p_payment_id uuid,
  p_amount     bigint default null::bigint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_pay            record;
  v_remaining      bigint;
  v_amount         bigint;
  v_new_total      bigint;
  v_full           boolean;
  v_new_status     public.payment_status;
  v_clawback       boolean := false;
  v_item           record;
  -- El estado del payout releído DESPUÉS de bloquearlo. Es el que manda.
  v_estado_payout  public.payout_status;
  -- El reparto, calculado por la única función que lo sabe hacer.
  v_reparto        jsonb := jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin reembolsa' using errcode = 'insufficient_privilege';
  end if;

  select id, booking_id, status, gross_amount, refunded_amount,
         credit_id, credit_amount, platform_funded_amount
    into v_pay
  from public.payments where id = p_payment_id;
  if v_pay.id is null then
    raise exception 'pago no encontrado' using errcode = 'no_data_found';
  end if;

  -- Solo se reembolsa lo que se cobró.
  if v_pay.status not in ('paid', 'partially_refunded') then
    raise exception 'el pago no está cobrado (está: %)', v_pay.status using errcode = 'check_violation';
  end if;

  -- El techo sigue siendo el PRECIO pendiente, no el efectivo pendiente: lo que
  -- se le promete al alumno es el importe de su reserva. Lo que cambia es por
  -- dónde sale cada parte, y eso lo decide `reembolsar_con_credito`.
  v_remaining := v_pay.gross_amount - v_pay.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);   -- por defecto, el resto
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe inválido: entre 1 y % (queda por reembolsar)', v_remaining
      using errcode = 'check_violation';
  end if;

  v_new_total := v_pay.refunded_amount + v_amount;
  v_full := v_new_total >= v_pay.gross_amount;
  v_new_status := case when v_full then 'refunded' else 'partially_refunded' end;

  -- El item del payout se busca UNA vez y arriba, porque de él depende si este
  -- reembolso puede siquiera empezar. `payout_items.payment_id` es único
  -- (`20260716140000:48`), así que esto devuelve como mucho una fila.
  if v_full then
    -- 🔴 EL CANDADO (defecto 2). `for update of po, pi` bloquea la orden de pago
    -- y su línea hasta el final de esta transacción. Sin él, entre este `select`
    -- y los `delete` de más abajo cabe entero el reclamo del ejecutor: leeríamos
    -- 'scheduled', el job pondría 'processing' y crearía el payout en el
    -- proveedor, y este reembolso borraría después la fila con su
    -- `provider_payout_id` dentro. El dinero saldría igual y no quedaría ni la
    -- fila para conciliarlo.
    select pi.id as item_id, pi.amount as item_amount, po.id as payout_id, po.status as payout_status
      into v_item
    from public.payout_items pi
    join public.payouts po on po.id = pi.payout_id
    where pi.payment_id = p_payment_id
    for update of po, pi;

    if v_item.payout_id is not null then
      select po.status into v_estado_payout
        from public.payouts po
       where po.id = v_item.payout_id;
    end if;

    -- 🔴 EL GUARDIÁN (de `20260902130000`). 'processing' es una orden que el
    -- proveedor tiene entre manos: ni se le quita el item, ni se le resta el
    -- importe, ni —lo irreversible— se borra la fila con su identificador.
    if v_estado_payout = 'processing'::public.payout_status then
      raise exception
        'hay una orden de pago en ejecución para este importe (payout %): espera a que el proveedor la confirme —el job la deja en pagada o rechazada, y entonces este reembolso ya sabe qué hacer— y repite. Si lleva más de un día parada, mírala desde el panel o con select * from public.payouts_backlog().',
        v_item.payout_id
        using errcode = 'check_violation';
    end if;
  end if;

  update public.payments
     set status = v_new_status, refunded_amount = v_new_total
   where id = p_payment_id;

  -- 🔴 EL REPARTO Y LOS DOS MOVIMIENTOS, EN UNA SOLA LLAMADA. A la pasarela solo
  -- el tramo que la pasarela cobró (H-1/H-7/S-5) y al crédito lo que puso el
  -- crédito, con la regla de «todo o nada» de una mentoría gratis dentro. Si el
  -- tramo en efectivo es 0 —reserva pagada al 100 % con un regalo—,
  -- `enqueue_refund` sale por su puerta de arriba y no encola nada, que es lo
  -- correcto: no hay cargo que revertir.
  --
  -- `p_ya_devuelto` es el acumulado de ANTES (`v_pay.refunded_amount`, leído
  -- arriba), no el de la fila: el `update` de encima ya la movió.
  -- La clave NO se versiona: ver el bloque 6 de `20260912100000`.
  v_reparto := public.reembolsar_con_credito(
    v_pay.id,
    v_amount,
    v_pay.refunded_amount,
    'US-704 · reembolso manual desde el panel admin',
    'X01:payment:' || v_pay.id || ':' || v_new_total
  );

  -- S-29: solo en reembolso TOTAL se toca el payout (el prorrateo parcial del
  -- neto es DP-03, manual). El item ya está leído y bloqueado arriba.
  if v_full then
    if v_item.item_id is not null then
      if v_estado_payout = 'paid'::public.payout_status then
        -- Ya se pagó al tutor → clawback manual (no automatizado, MVP/S-29).
        v_clawback := true;
      else
        -- 'pending', 'scheduled', 'on_hold' o 'failed': nadie está pagando esto.
        -- ('processing' no llega aquí: lo cortó el guardián de arriba.)
        delete from public.payout_items where id = v_item.item_id;

        -- 🔑 H-5 · `platform_funded_amount` BAJA CON `amount`. El fondeo de una
        -- orden es la suma del de sus líneas más el ajuste; al quitar una línea
        -- hay que quitar SU parte. Sin esto la orden superviviente le sigue
        -- diciendo a operaciones que transfiera dinero para una línea que ya no
        -- existe.
        update public.payouts
           set amount = amount - v_item.item_amount,
               platform_funded_amount =
                 greatest(0, platform_funded_amount - coalesce(v_pay.platform_funded_amount, 0))
         where id = v_item.payout_id;

        -- 🔴 S-4 / H-5 · SI LA ORDEN LLEVA UNA RECOMPENSA DENTRO, NO SE BORRA.
        -- Sin el segundo `not exists`, el reembolso de un ALUMNO borraba la
        -- orden y se llevaba por delante la recompensa de un TUTOR que no tiene
        -- nada que ver. `payout_adjustments.payout_id` es además
        -- `on delete restrict`: si alguien reintroduce el borrado sin este
        -- filtro, revienta a gritos en vez de perder dinero en silencio.
        delete from public.payouts po
         where po.id = v_item.payout_id
           and not exists (select 1 from public.payout_items x where x.payout_id = po.id)
           and not exists (select 1 from public.payout_adjustments a where a.payout_id = po.id);
      end if;
    end if;

    -- M4: reembolso total → la reserva pasa a refunded (cierre financiero).
    update public.bookings set status = 'refunded'
     where id = v_pay.booking_id and status <> 'refunded';
  end if;

  -- `payments.platform_funded_amount` se deja como está: es el snapshot de lo
  -- que era cierto cuando se aplicó el crédito, y la fila ya no alimenta ningún
  -- payout (`build_payout_for_tutor` solo mira `status = 'paid'`).
  --
  -- NTF-10 lo dispara el trigger de `payments`, no esta función — y desde §13
  -- ese aviso ya manda el EFECTIVO y no el precio, que era H-11.
  return jsonb_build_object(
    'refunded_amount', v_amount,
    'refunded_cash',   coalesce((v_reparto ->> 'cash')::bigint, 0),
    'credit_returned', coalesce((v_reparto ->> 'credit')::bigint, 0),
    'credit_lost',     coalesce((v_reparto ->> 'credito_perdido')::bigint, 0),
    'total_refunded',  v_new_total,
    'status',          v_new_status::text,
    'clawback_needed', v_clawback
  );
end;
$fn$;

comment on function public.refund_payment(uuid, bigint) is
  'Reembolso manual desde el panel admin. Reparte el importe con public.reembolsar_con_credito —la única aritmética, la acumulada— y devuelve cada tramo por su sitio: el efectivo a la pasarela y el crédito al crédito, con la regla de «todo o nada» de una mentoría gratis. Antes reponía el crédito a mano con una resta que violaba credits_mentoria_entera en cuanto la mentoría costaba menos que el tope, o sea siempre. No borra una orden de pago que lleve recompensas dentro (S-4) y baja platform_funded_amount junto a amount al quitar una línea (H-5). `credit_lost` es nuevo: lo que una mentoría gratis no puede reponer a medias.';

-- `create or replace` conserva el ACL, pero el `revoke` a PUBLIC se repite por
-- si esta migración se aplicara sobre una base donde la función no existiera: en
-- PostgreSQL el `execute` nace concedido a PUBLIC. La llama el panel del admin
-- con el cliente de la SESIÓN (el `has_role('admin')` va dentro, que es la forma
-- correcta), así que el grant es a `authenticated` y no a `service_role`.
revoke execute on function public.refund_payment(uuid, bigint) from public;
revoke execute on function public.refund_payment(uuid, bigint) from anon;
grant  execute on function public.refund_payment(uuid, bigint) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · `confirm_payment` — concilia el importe y suelta el crédito si falla
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ CAMBIA LA FIRMA → `drop function` + `create`, JAMÁS `create or replace`
-- (regla de oro 12): con `create or replace` PostgreSQL crearía una SOBRECARGA
-- y PostgREST respondería `PGRST203`, y como supabase-js no serializa las claves
-- `undefined`, fallaría según los campos que el llamador rellene — o sea a
-- veces. Y el `drop` se lleva los `grant execute` por delante: se reponen abajo.
--
-- Sus llamadores son tres y los tres siguen valiendo: los dos webhooks
-- (`src/app/api/webhooks/stripe/route.ts` y `.../dlocalgo/route.ts`) la llaman
-- con tres argumentos por nombre, y `confirm_order_payment`
-- (`20260911180000:70`) con tres posicionales. El cuarto tiene `default null`,
-- y con null la conciliación por importe simplemente no actúa.
--
-- 🔴 LA CONCILIACIÓN ES LA PROFUNDIDAD DEL CERROJO DE §3. Hasta hoy esta
-- función nunca comparaba lo cobrado con lo debido: tomaba `p_success` y
-- escribía `paid`. Eso es lo que convertía «abrir el cobro con crédito y
-- quitarlo después» en dinero gratis. Ahora, antes de marcar `paid`:
--   · si el llamador dice cuánto se cobró (`p_amount_charged`), tiene que ser
--     exactamente `gross_amount - credit_amount`;
--   · y si hay marcador de cobro abierto (`checkout_amount`), tiene que decir
--     lo mismo.
-- Un descuadre ABORTA la transacción. Es a gritos a propósito: el webhook
-- devolverá error, Stripe reintentará y alguien lo verá — que es infinitamente
-- mejor que una reserva pagada de menos que nadie mira nunca (regla de oro 11).
--
-- ⚠️ Y HAY QUE SABER LO QUE CUESTA, PORQUE NO ES GRATIS. Al abortar se revierte
-- también el `insert` en `payment_webhook_events`, así que el evento NO queda
-- marcado como procesado: Stripe reintentará eternamente con el dinero ya
-- cobrado y la reserva sin confirmar. Es lo correcto (mejor un webhook que
-- grita que una reserva pagada de menos), pero la salida es MANUAL y conviene
-- tenerla escrita: el admin mira `payments.checkout_amount` contra
-- `gross_amount - credit_amount`, decide cuál de los dos es la verdad y o bien
-- cuadra el crédito (`quitar_credito`/`aplicar_credito` sobre la reserva) o bien
-- pone `checkout_amount = null` para que la conciliación por marcador deje de
-- actuar. Va también en `docs/QA-LANZAMIENTO.md`.
drop function if exists public.confirm_payment(uuid, boolean, text);

create or replace function public.confirm_payment(
  p_booking_id     uuid,
  p_success        boolean default true,
  p_event_id       text    default null,
  p_amount_charged bigint  default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_pay        record;
  v_new        public.booking_status;
  v_auto       boolean;
  v_esperado   bigint;
begin
  if not exists (select 1 from public.bookings b where b.id = p_booking_id) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- US-703: dedup por event-id (procesar cada evento una sola vez).
  if p_event_id is not null then
    insert into public.payment_webhook_events (event_id, booking_id)
    values (p_event_id, p_booking_id)
    on conflict (event_id, booking_id) do nothing;
    if not found then
      select status into v_new from public.bookings where id = p_booking_id;
      return v_new::text;  -- evento ya procesado → no-op
    end if;
  end if;

  select p.id, p.status, p.gross_amount, coalesce(p.credit_amount, 0) as credit_amount,
         p.checkout_amount
    into v_pay
  from public.payments p
  where p.booking_id = p_booking_id;

  -- Idempotencia por estado: un pago ya RESUELTO no se reprocesa. 'failed' es
  -- tan definitivo como 'paid' (X-02) — significa que el horario ya se liberó,
  -- y acreditarlo ahora cobraría por una clase que no existe.
  if v_pay.status in ('paid', 'refunded', 'partially_refunded', 'failed') then
    select status into v_new from public.bookings where id = p_booking_id;
    return v_new::text;
  end if;

  if p_success then
    -- 🔴 LA CONCILIACIÓN. Ver la cabecera de este bloque.
    v_esperado := v_pay.gross_amount - v_pay.credit_amount;

    if p_amount_charged is not null and p_amount_charged <> v_esperado then
      raise exception
        'el cobro de la reserva % dice % y lo debido es % (bruto % menos % de crédito)',
        p_booking_id, p_amount_charged, v_esperado, v_pay.gross_amount, v_pay.credit_amount
        using errcode = 'check_violation',
              hint = 'El crédito cambió después de abrir el cobro: no se marca paid.';
    end if;

    if v_pay.checkout_amount is not null and v_pay.checkout_amount <> v_esperado then
      raise exception
        'el cobro de la reserva % se abrió por % y ahora lo debido es %',
        p_booking_id, v_pay.checkout_amount, v_esperado
        using errcode = 'check_violation',
              hint = 'Marcador de marcar_cobro_abierto contra payments.credit_amount: alguien movió el crédito con el cobro ya abierto.';
    end if;

    update public.payments set status = 'paid', paid_at = now() where booking_id = p_booking_id;

    -- M-02 · ¿esta MENTORÍA acepta sola? (antes: ¿este tutor?)
    --
    -- Subconsulta envuelta en `coalesce` y no `select … into` a secas: si el
    -- join no devolviera fila, `into` dejaría la variable en null y el `case`
    -- de abajo se iría por la rama del else igualmente, pero por accidente.
    -- Así el respaldo es EXPLÍCITO y es el conservador: sin producto legible,
    -- la reserva espera a que un humano la acepte.
    select coalesce(
             (select p.auto_accept_bookings
                from public.bookings b
                join public.products p on p.id = b.product_id
               where b.id = p_booking_id),
             false)
      into v_auto;

    update public.bookings
      set status = case when v_auto then 'confirmed' else 'pending_acceptance' end::public.booking_status
      where id = p_booking_id and status = 'pending_payment'
      returning status into v_new;
  else
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;

    -- 🔴 LA TERCERA PUERTA POR LA QUE SE PERDÍA UN CRÉDITO. La tarjeta se
    -- rechaza en un cobro mixto de 180 con 45 de crédito y, hasta hoy, esos 45
    -- se quedaban `consumed` sin que nada los devolviera. El orden es el de
    -- siempre: `payments` (ya bloqueado por el update de arriba) y luego
    -- `credits`.
    perform public.liberar_credito_de_pago(v_pay.id);

    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = p_booking_id
      returning status into v_new;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  return v_new::text;
end;
$fn$;

comment on function public.confirm_payment(uuid, boolean, text, bigint) is
  'Confirma (o tumba) el cobro de UNA reserva. Desde los créditos hace dos cosas más: concilia lo cobrado contra gross_amount - credit_amount antes de marcar paid —con el importe que le pase el webhook y con el marcador de marcar_cobro_abierto— y, cuando el pago falla, devuelve el crédito que lo financiaba. El cuarto argumento es nuevo y tiene default: los dos webhooks y confirm_order_payment siguen llamándola con tres.';

-- ⚠️ El `drop` de arriba se llevó los privilegios. Se reponen sobre la que
-- sobrevive, y el `revoke` no es adorno: en PostgreSQL el `execute` de una
-- función nace concedido a PUBLIC.
revoke execute on function public.confirm_payment(uuid, boolean, text, bigint) from public;
revoke execute on function public.confirm_payment(uuid, boolean, text, bigint) from anon;
revoke execute on function public.confirm_payment(uuid, boolean, text, bigint) from authenticated;
grant  execute on function public.confirm_payment(uuid, boolean, text, bigint) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · La aritmética del canje, en UN sitio
-- ════════════════════════════════════════════════════════════════════════════
--
-- El selector del checkout y `aplicar_credito` tienen que decir EXACTAMENTE lo
-- mismo: si el selector pinta «usable» y la RPC levanta una excepción, el
-- alumno ve un 500 en la pantalla de pagar. Por eso el cálculo vive en una
-- función pura, `immutable`, sin acceso a tablas, y las dos la llaman.
--
-- Decisiones que hay dentro y conviene saber:
--
--  · MONEDA. No se convierte nada. Inventar un tipo de cambio aquí es lo mismo
--    que `create_order` rechaza al exigir moneda única (`20260827150000:709`).
--    Pero el crédito se DEVUELVE con `usable = false` y su motivo, en vez de
--    omitirlo: un premio que el alumno no ve es un premio que caduca a los 30
--    días sin que nadie sepa por qué.
--
--  · EL PAQUETE. El diagrama dice «cubre una de ellas y se paga el resto», y en
--    este repo no existe un precio por sesión: `create_booking_line` cobra el
--    paquete como un solo `v_total` (`20260910120000:176`). El reparto es
--    `gross - (n-1) * (gross / n)` con división ENTERA, y no `round(gross/n)`,
--    porque así los N tramos suman exactamente `gross` y no queda un céntimo
--    colgando: con gross=10000 y n=3 el crédito cubre 3334 y el alumno paga
--    2 × 3333. El residuo va al tramo cubierto a propósito (el alumno nunca
--    paga el céntimo suelto) y además hace la comprobación del tope
--    conservadora.
--    ⚠️ Sigue siendo un número que la plataforma se inventa y que no coincide
--    con lo que el tutor cobra por una suelta. Si el cliente se queja, la
--    salida sin código es poner `reward_kind = 'saldo'` en /admin/referidos.
create or replace function public.credito_aplicable(
  p_kind             text,
  p_source           text,
  p_amount           bigint,
  p_consumed         bigint,
  p_credit_currency  char(3),
  p_credit_product   uuid,
  p_gross            bigint,
  p_num_sessions     int,
  p_booking_currency char(3),
  p_booking_product  uuid
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_resto bigint := greatest(0, coalesce(p_amount, 0) - coalesce(p_consumed, 0));
  v_n     int    := greatest(1, coalesce(p_num_sessions, 1));
  v_una   bigint;
  v_cubre bigint;
begin
  if p_credit_currency is distinct from p_booking_currency then
    return jsonb_build_object('cubre', 0, 'usable', false,
                              'motivo', 'tu saldo está en otra moneda');
  end if;

  if p_kind = 'saldo' then
    v_cubre := least(v_resto, coalesce(p_gross, 0));
    return jsonb_build_object(
      'cubre', v_cubre,
      'usable', v_cubre > 0,
      'motivo', case when v_cubre > 0 then null else 'este saldo ya está gastado' end);
  end if;

  -- kind = 'mentoria'
  if p_source = 'gift' then
    v_cubre := least(coalesce(p_amount, 0), coalesce(p_gross, 0));
    if p_credit_product is distinct from p_booking_product then
      return jsonb_build_object('cubre', v_cubre, 'usable', false,
                                'motivo', 'este regalo es para otra mentoría');
    end if;
    return jsonb_build_object('cubre', v_cubre, 'usable', v_cubre > 0,
                              'motivo', case when v_cubre > 0 then null else 'este regalo no cubre nada' end);
  end if;

  -- kind = 'mentoria', source = 'referral': el `amount` es el TOPE.
  v_una := coalesce(p_gross, 0) - (v_n - 1) * (coalesce(p_gross, 0) / v_n);
  if v_una > v_resto then
    return jsonb_build_object('cubre', v_una, 'usable', false,
                              'motivo', 'esta mentoría supera el tope de tu recompensa');
  end if;
  return jsonb_build_object('cubre', v_una, 'usable', v_una > 0,
                            'motivo', case when v_una > 0 then null else 'esta mentoría no cuesta nada' end);
end;
$fn$;

comment on function public.credito_aplicable(text, text, bigint, bigint, char, uuid, bigint, int, char, uuid) is
  'La ÚNICA aritmética del canje: cuánto cubre este crédito sobre este cobro, si se puede usar y por qué no. La llaman creditos_disponibles (para pintar) y aplicar_credito (para escribir), y por eso es pura: si las dos no dicen lo mismo, el alumno ve un 500 en la pantalla de pagar.';

revoke execute on function public.credito_aplicable(text, text, bigint, bigint, char, uuid, bigint, int, char, uuid) from public;
revoke execute on function public.credito_aplicable(text, text, bigint, bigint, char, uuid, bigint, int, char, uuid) from anon;
grant  execute on function public.credito_aplicable(text, text, bigint, bigint, char, uuid, bigint, int, char, uuid) to authenticated, service_role;


-- ── 8.1 · `creditos_disponibles` — lo que pinta el selector ─────────────────
create or replace function public.creditos_disponibles(p_booking_id uuid)
returns table (
  credit_id uuid,
  kind      text,
  source    text,
  etiqueta  text,
  cubre     bigint,
  usable    boolean,
  motivo    text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_b   record;
  v_p   record;
  v_c   record;
  v_r   jsonb;
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  -- La reserva tiene que ser SUYA. Esta función es `definer`, así que la RLS no
  -- la está protegiendo: la comprobación es explícita.
  select b.id, b.product_id, b.num_sessions
    into v_b
  from public.bookings b
  where b.id = p_booking_id and b.student_id = v_uid;
  if v_b.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select p.gross_amount, p.currency, coalesce(p.credit_amount, 0) as credit_amount
    into v_p
  from public.payments p
  where p.booking_id = p_booking_id;

  for v_c in
    select c.id, c.kind, c.source, c.amount, c.consumed_amount, c.currency,
           c.product_id, c.referral_campaign_id, c.expires_at,
           pr.title as producto,
           rc.reward_text
      from public.credits c
      left join public.products pr            on pr.id = c.product_id
      left join public.referral_campaigns rc  on rc.rf_campaign_id = c.referral_campaign_id
     where c.beneficiary_id  = v_uid
       and c.status          = 'active'
       and c.destino         = 'cobro'
     order by c.expires_at nulls last, c.created_at
  loop
    v_r := public.credito_aplicable(
             v_c.kind, v_c.source, v_c.amount, v_c.consumed_amount,
             v_c.currency, v_c.product_id,
             v_p.gross_amount, v_b.num_sessions, v_p.currency, v_b.product_id);

    credit_id := v_c.id;
    kind      := v_c.kind;
    source    := v_c.source;
    etiqueta  := case
                   when v_c.source = 'gift'
                     then 'Regalo: ' || coalesce(v_c.producto, 'una mentoría')
                   when v_c.kind = 'mentoria'
                     then coalesce(nullif(btrim(v_c.reward_text), ''), 'Una mentoría gratis')
                   else coalesce(nullif(btrim(v_c.reward_text), ''), 'Saldo de tus invitaciones')
                 end;
    cubre     := (v_r ->> 'cubre')::bigint;
    usable    := (v_r ->> 'usable')::boolean;
    motivo    := v_r ->> 'motivo';

    -- ⚠️ LA FECHA MANDA SOBRE EL ESTADO, y aquí se ve por qué importa que esta
    -- función y `aplicar_credito` digan lo mismo: `caducar_creditos` corre a las
    -- 03:17, así que entre la medianoche y esa hora hay créditos vencidos que
    -- siguen diciendo 'active'. `aplicar_credito` ya los rechaza; si el selector
    -- los pintara usables, el alumno se comería un 500 en la pantalla de pagar.
    -- Se DEVUELVE con motivo, y no se omite, por la misma razón que la moneda
    -- distinta: un premio que desaparece sin explicación es una pregunta a
    -- soporte.
    if v_c.expires_at is not null and v_c.expires_at <= now() then
      usable := false;
      motivo := 'este crédito ha caducado';
    end if;

    return next;
  end loop;
end;
$fn$;

comment on function public.creditos_disponibles(uuid) is
  'Los créditos que el alumno puede aplicar a ESTA reserva, con cuánto cubre cada uno y por qué no se puede usar el que no se puede. Devuelve también los NO usables —moneda distinta, tope superado, regalo de otra mentoría, caducado— a propósito: un premio invisible es un premio que caduca sin que nadie sepa por qué. La caducidad se mira por FECHA y no por status: el barrido es diario (03:17) y hasta que pasa hay créditos vencidos que siguen diciendo active. ⚠️ No toma candados: dos pestañas pintan lo mismo y la segunda se cae en aplicar_credito, que es donde está el for update.';

revoke execute on function public.creditos_disponibles(uuid) from public;
revoke execute on function public.creditos_disponibles(uuid) from anon;
grant  execute on function public.creditos_disponibles(uuid) to authenticated;


-- ── 8.2 · `aplicar_credito` — la ÚNICA puerta por la que un crédito toca un pago
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
         v_c.amount,         -- lo que se cobró POR EL REGALO
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

comment on function public.aplicar_credito(uuid, uuid) is
  'Aplica UN crédito a UNA reserva: es la única puerta por la que un crédito toca payments. Recalcula el importe en servidor (el navegador solo manda un credit_id), congela el fondeo (funding_provider y platform_funded_amount) y consume el crédito. Un pago usa como mucho un crédito a propósito: dos orígenes de fondeo en una fila romperían la cuenta del ciclo.';

revoke execute on function public.aplicar_credito(uuid, uuid) from public;
revoke execute on function public.aplicar_credito(uuid, uuid) from anon;
grant  execute on function public.aplicar_credito(uuid, uuid) to authenticated;


-- ── 8.3 · `quitar_credito` — el inverso exacto ─────────────────────────────
create or replace function public.quitar_credito(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_b         record;
  v_p         record;
  v_abierto   boolean;
  v_devuelto  bigint;
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  select b.id into v_b from public.bookings b
   where b.id = p_booking_id and b.student_id = v_uid;
  if v_b.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select p.* into v_p from public.payments p where p.booking_id = p_booking_id for update;
  if v_p.id is null then
    raise exception 'esta reserva no tiene cobro' using errcode = 'no_data_found';
  end if;

  if v_p.status <> 'pending' then
    raise exception 'el pago de esta reserva ya está en %', v_p.status
      using errcode = 'check_violation';
  end if;

  if v_p.credit_id is null then
    return jsonb_build_object('credit_id', null, 'devuelto', 0,
                              'a_pagar', v_p.gross_amount, 'gross_amount', v_p.gross_amount);
  end if;

  -- 🔴 CERROJO 2, y aquí es donde estaba la imprenta de dinero: quitar el
  -- crédito con una Session ya creada por `gross - credit` deja al alumno
  -- pagando el importe VIEJO por una reserva que ahora debe el importe entero.
  -- Solo se consiente si el cobro abierto ya era por el bruto (o sea: se abrió
  -- antes de aplicar el crédito y quitarlo lo devuelve a cuadrar).
  v_abierto := v_p.provider_payment_id is not null
            or coalesce(v_p.provider_metadata, '{}'::jsonb) ? 'checkout'
            or v_p.checkout_opened_at is not null;

  if v_abierto and coalesce(v_p.checkout_amount, -1) <> v_p.gross_amount then
    raise exception 'ya hay un cobro abierto para esta reserva por otro importe'
      using errcode = 'check_violation',
            hint = 'Ciérralo o espera a que caduque la reserva antes de quitar el crédito.';
  end if;

  -- Devolver el crédito y limpiar el pago es exactamente lo que hace la
  -- liberación de las tres puertas: se reusa en vez de reescribirla.
  v_devuelto := public.liberar_credito_de_pago(v_p.id);

  return jsonb_build_object(
    'credit_id',    v_p.credit_id,
    'devuelto',     v_devuelto,
    'gross_amount', v_p.gross_amount,
    'a_pagar',      v_p.gross_amount
  );
end;
$fn$;

comment on function public.quitar_credito(uuid) is
  'Quita el crédito de una reserva y lo devuelve entero. Sin esto, equivocarse de crédito quema el premio. Comparte los dos cerrojos de aplicar_credito: solo antes de cobrar y solo si no hay un cobro abierto por otro importe.';

revoke execute on function public.quitar_credito(uuid) from public;
revoke execute on function public.quitar_credito(uuid) from anon;
grant  execute on function public.quitar_credito(uuid) to authenticated;


-- ── 8.4 · Cobrar CERO: el sustituto legítimo de confirm_simulated_payment ───
--
-- `confirm_simulated_payment` está muerta en toda la plataforma (su tercer
-- cerrojo exige `provider = 'simulated'` y en dev no queda ni una regla de
-- ruteo que lo produzca) y NO se reabre: ese es exactamente el ataque que
-- documenta `20260901140000`. Estas dos no repiten su agujero porque el usuario
-- **no puede acuñar un crédito**: `credits` no tiene política ni grant de
-- insert para `authenticated`.
--
-- ⚠️ LLEVAN EL ALUMNO EN LA FIRMA (S6). Corren con `service_role`, o sea sin
-- `auth.uid()`: sin este argumento, con un uuid de reserva ajena cualquiera
-- podría forzar el `paid`/`pending_acceptance` de otro en el momento que
-- quisiera. El Route Handler resuelve la reserva con el cliente RLS (el patrón
-- de `cobroDeReserva`, `src/app/api/pagos/checkout/route.ts:306-312`) y pasa el
-- dueño; aquí se REVERIFICA, no se confía.
create or replace function public.confirm_credit_booking(p_booking_id uuid, p_student uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_p record;
begin
  if p_student is null then
    raise exception 'falta el alumno' using errcode = '28000';
  end if;

  if not exists (select 1 from public.bookings b
                  where b.id = p_booking_id and b.student_id = p_student) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select p.id, p.gross_amount, coalesce(p.credit_amount, 0) as credit_amount, p.credit_id
    into v_p
  from public.payments p where p.booking_id = p_booking_id;

  if v_p.id is null then
    raise exception 'esta reserva no tiene cobro' using errcode = 'no_data_found';
  end if;

  -- Se reverifica DENTRO, no se confía en el Route Handler.
  if v_p.credit_amount is distinct from v_p.gross_amount then
    raise exception 'este cobro no está cubierto al 100 %% por un crédito (% de %)',
      v_p.credit_amount, v_p.gross_amount using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.credits c
                  where c.id = v_p.credit_id and c.status in ('active','consumed')) then
    raise exception 'el crédito de esta reserva no está vivo' using errcode = 'check_violation';
  end if;

  -- El cuarto argumento es 0 y es verdad: por la pasarela no entró nada. La
  -- conciliación de confirm_payment lo comprueba contra gross - credit.
  return public.confirm_payment(p_booking_id, true, 'credit:' || v_p.id, 0::bigint);
end;
$fn$;

comment on function public.confirm_credit_booking(uuid, uuid) is
  'Marca pagada una reserva cuyo total lo cubre un crédito al 100 %: no hay nada que cobrar y abrir un cargo de 0 en Stripe es un 400. Reverifica la cobertura y la propiedad de la reserva dentro, porque corre con service_role y no tiene auth.uid().';

revoke execute on function public.confirm_credit_booking(uuid, uuid) from public;
revoke execute on function public.confirm_credit_booking(uuid, uuid) from anon;
revoke execute on function public.confirm_credit_booking(uuid, uuid) from authenticated;
grant  execute on function public.confirm_credit_booking(uuid, uuid) to service_role;


create or replace function public.confirm_credit_order(p_order_id uuid, p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_mal int;
  v_n   int;
begin
  if p_student is null then
    raise exception 'falta el alumno' using errcode = '28000';
  end if;

  if not exists (select 1 from public.orders o
                  where o.id = p_order_id and o.student_id = p_student) then
    raise exception 'pedido no encontrado' using errcode = 'no_data_found';
  end if;

  select count(*) filter (where coalesce(p.credit_amount, 0) is distinct from p.gross_amount),
         count(*)
    into v_mal, v_n
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.order_id = p_order_id;

  if v_n = 0 then
    raise exception 'el pedido % no tiene líneas', p_order_id using errcode = 'no_data_found';
  end if;
  if v_mal > 0 then
    raise exception '% de las % líneas del pedido no están cubiertas al 100 %% por un crédito', v_mal, v_n
      using errcode = 'check_violation';
  end if;

  -- Se delega en `confirm_order_payment` y no se repite su cuerpo: así el
  -- recibo único del pedido (NTF-04b) sigue saliendo una sola vez y con la
  -- misma clave.
  return public.confirm_order_payment(p_order_id, true, 'credit:' || p_order_id);
end;
$fn$;

comment on function public.confirm_credit_order(uuid, uuid) is
  'La hermana de confirm_credit_booking para un pedido multi-línea: exige que TODAS las líneas estén cubiertas al 100 % y delega en confirm_order_payment para no duplicar el recibo NTF-04b. Nombres distintos y no una sobrecarga, por la regla de oro 12.';

revoke execute on function public.confirm_credit_order(uuid, uuid) from public;
revoke execute on function public.confirm_credit_order(uuid, uuid) from anon;
revoke execute on function public.confirm_credit_order(uuid, uuid) from authenticated;
grant  execute on function public.confirm_credit_order(uuid, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 9 · La recompensa del referido
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un solo argumento a propósito: el referidor y la campaña se resuelven DENTRO,
-- así que el cron no puede emparejarlos mal.
--
-- 🔴 Y LA INVARIANTE DE LA CONVERSIÓN VIVE AQUÍ DENTRO, no solo en quien la
-- llama. Hasta ahora la regla («el alumno referido pagó» / «el tutor referido
-- dio una clase») existía únicamente en `referral_conversions_pending`
-- (`20260911120000:276-296`), o sea en el SELECT del cron. Una función de dinero
-- cuya invariante vive en el llamador es exactamente la forma del agujero de
-- `confirm_simulated_payment`. Y hay una razón más concreta: en PostgreSQL un
-- `grant execute … to service_role` NO quita el EXECUTE que PUBLIC tiene por
-- defecto —medido en esta misma base: `tutor_balance` lo tiene hoy y `anon`
-- puede llamarla— así que un `revoke` olvidado convertiría esto en una imprenta
-- abierta a cualquier sesión.
create or replace function public.emitir_credito_de_referido(p_referido uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_p         record;
  v_m         record;
  v_c         record;
  v_destino   text;
  v_es_tutor  boolean;
  v_id        uuid;
begin
  select pr.id, pr.referral_code, pr.referral_converted_at
    into v_p
  from public.profiles pr where pr.id = p_referido;

  if v_p.id is null or v_p.referral_code is null then
    return null;                     -- sin código no hay a quién premiar
  end if;

  -- 🔴 INVARIANTE 1 · LA CONVERSIÓN TIENE QUE HABER OCURRIDO. La marca la pone
  -- `/api/cron/referrals-sync` DESPUÉS de que Referral Factory la acepte, y por
  -- eso el orden de esa ruta (primero el update de referral_converted_at, luego
  -- esta RPC) es LOAD-BEARING y no estilo: RF es la fuente de verdad de la
  -- conversión y repartir premios por conversiones que RF rechaza es dinero que
  -- no vuelve.
  if v_p.referral_converted_at is null then
    return null;
  end if;

  select m.profile_id, m.rf_campaign_id
    into v_m
  from public.referral_memberships m
  where m.code = v_p.referral_code;

  if v_m.profile_id is null then
    return null;                     -- código inventado: misma validación que
  end if;                            -- referral_conversions_pending

  if v_m.profile_id = p_referido then
    return null;                     -- nadie se refiere a sí mismo
  end if;

  select rc.rf_campaign_id, rc.audience, rc.reward_kind, rc.reward_amount,
         rc.reward_currency, rc.reward_expires_days
    into v_c
  from public.referral_campaigns rc
  where rc.rf_campaign_id = v_m.rf_campaign_id;

  if v_c.rf_campaign_id is null or v_c.reward_kind = 'ninguna' then
    return null;                     -- la campaña no reparte. NO es un error.
  end if;

  -- 🔴 INVARIANTE 2 · EL HECHO QUE LA CAMPAÑA EXIGE, REAFIRMADO. Copia literal
  -- de los dos `exists` de referral_conversions_pending: si mañana alguien
  -- llama a esta función desde otro sitio, la regla sigue puesta.
  if v_c.audience = 'alumnos' then
    if not exists (select 1
                     from public.payments pay
                     join public.bookings b on b.id = pay.booking_id
                    where b.student_id = p_referido and pay.status = 'paid') then
      return null;
    end if;
  elsif v_c.audience = 'tutores' then
    if not exists (select 1 from public.sessions s
                    where s.tutor_id = p_referido and s.status = 'completed') then
      return null;
    end if;
  else
    return null;
  end if;

  -- A un TUTOR, el dinero se le suma a su próximo cobro y le llega solo; a un
  -- alumno le queda como saldo. `has_role` mira `auth.uid()` y aquí no hay
  -- sesión, así que se lee el rol por uuid. La función es `definer`: corre como
  -- el dueño y no necesita grant sobre `user_roles`.
  select exists (select 1 from public.user_roles ur
                  where ur.user_id = v_m.profile_id and ur.role = 'tutor')
    into v_es_tutor;

  v_destino := case when v_c.reward_kind = 'saldo' and v_es_tutor then 'payout' else 'cobro' end;

  -- ⚠️ `ON CONFLICT (columnas) WHERE predicado`, y NO `on constraint`: la
  -- idempotencia es un índice único PARCIAL y un índice parcial no tiene fila
  -- en `pg_constraint`. `on constraint credits_recompensa_unica` levantaría
  -- «constraint … does not exist» en ejecución. El predicado tiene que ser
  -- LITERALMENTE el del índice para que Postgres lo infiera.
  insert into public.credits (
    beneficiary_id, source, kind, destino, status, amount, currency,
    referral_campaign_id, referred_profile_id, expires_at, issued_at
  ) values (
    v_m.profile_id,
    'referral',
    case when v_c.reward_kind = 'mentoria' then 'mentoria' else 'saldo' end,
    v_destino,
    'active',
    v_c.reward_amount,
    v_c.reward_currency,
    v_c.rf_campaign_id,
    p_referido,
    -- Un crédito al payout NO caduca: el diagrama dice «le llega solo».
    case when v_destino = 'cobro'
         then now() + make_interval(days => v_c.reward_expires_days) end,
    now()
  )
  on conflict (beneficiary_id, referral_campaign_id, referred_profile_id)
    where source = 'referral'
      and beneficiary_id is not null
      and referral_campaign_id is not null
      and referred_profile_id is not null
  do nothing
  returning id into v_id;

  -- `v_id` null = ya estaba emitida. El cron puede llamarla mil veces.
  if v_id is null then
    return null;
  end if;

  perform public.enqueue_notification(
    v_m.profile_id, 'NTF-31', 'email', 'reward_earned',
    jsonb_build_object('credit_id', v_id, 'kind', v_c.reward_kind,
                       'amount', v_c.reward_amount, 'currency', v_c.reward_currency,
                       'destino', v_destino),
    'CRED:reward:' || v_id
  );

  return v_id;
end;
$fn$;

comment on function public.emitir_credito_de_referido(uuid) is
  'Emite la recompensa que la campaña promete al REFERIDOR del perfil que se pasa. Idempotente por el índice parcial credits_recompensa_unica: el cron horario puede llamarla mil veces. Lleva dentro las dos invariantes de la conversión (referral_converted_at y el hecho que exige la audiencia) y no solo en referral_conversions_pending, que es quien la llama hoy.';

-- ⚠️ LOS TRES `revoke` NO SON ADORNO: un `grant … to service_role` a secas deja
-- intacto el EXECUTE que PUBLIC tiene por defecto, y esta función acuña dinero.
revoke execute on function public.emitir_credito_de_referido(uuid) from public;
revoke execute on function public.emitir_credito_de_referido(uuid) from anon;
revoke execute on function public.emitir_credito_de_referido(uuid) from authenticated;
grant  execute on function public.emitir_credito_de_referido(uuid) to service_role;

-- De paso, la misma enfermedad medida en esta base: `tutor_balance` tiene hoy
-- EXECUTE para PUBLIC (`=X/postgres` en su ACL), o sea que `anon` puede
-- llamarla. Hoy es inofensiva porque levanta 28000 con `auth.uid()` null, pero
-- §4 va a hacerle sumar los créditos con destino='payout' y entonces deja de
-- serlo. Se cierra aquí, que es donde se descubrió.
revoke execute on function public.tutor_balance(int) from public;
revoke execute on function public.tutor_balance(int) from anon;


-- ════════════════════════════════════════════════════════════════════════════
-- 10 · El regalo: comprar, confirmar, reclamar
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.comprar_regalo(
  p_product_id      uuid,
  p_recipient_email text,
  p_message         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buyer    uuid := (select auth.uid());
  v_correo   text := lower(btrim(coalesce(p_recipient_email, '')));
  v_mio      text;
  v_prod     record;
  v_total    bigint;
  v_payer    char(2);
  v_provider text;
  v_abiertos int;
  v_id       uuid;
begin
  if v_buyer is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  if v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'ese correo no parece un correo' using errcode = 'check_violation';
  end if;

  select lower(btrim(u.email)) into v_mio from auth.users u where u.id = v_buyer;
  if v_correo = v_mio then
    raise exception 'no puedes regalarte a ti mismo' using errcode = 'check_violation';
  end if;

  -- ⚠️ EL TOPE DE REGALOS SIN PAGAR, Y NO ES ADORNO. Esta RPC la puede llamar
  -- cualquier sesión y CREA FILAS EN LA TABLA DEL DINERO: sin límite, un usuario
  -- con sesión las fabrica a ritmo de petición. Nacen sin cobrar y
  -- `caducar_creditos` las revoca a los 30 días, pero entretanto están ahí, se
  -- las pinta `mis_regalos_comprados` enteras y son el material perfecto para
  -- que un incidente de verdad pase desapercibido entre el ruido.
  --
  -- Tres a la vez es generoso para el caso real (se compra uno, se paga, y si
  -- el pago se cae se reintenta) y ridículo para un bucle. No es un `check` de
  -- tabla porque un `check` no puede contar filas de la propia tabla.
  select count(*) into v_abiertos
    from public.credits c
   where c.purchased_by = v_buyer
     and c.status = 'pending_payment'
     and (c.expires_at is null or c.expires_at > now());
  if v_abiertos >= 3 then
    raise exception 'tienes % regalos sin pagar: termina o abandona uno antes de empezar otro', v_abiertos
      using errcode = 'check_violation',
            hint = 'Un regalo sin pagar se abandona solo a los 30 días.';
  end if;

  -- ⚠️ NO SE RESUELVE AQUÍ SI ESE CORREO TIENE CUENTA. Escribir
  -- `beneficiary_id` antes de cobrar convierte esta pantalla en un oráculo
  -- gratis de existencia de cuentas para cualquier dirección: el comprador lee
  -- su propia fila por `credits_select_comprador` y ve si vino resuelta, sin
  -- llegar a pagar nunca. Hoy `profiles` es own-only y esto sería una
  -- regresión. Se resuelve en `confirm_gift_payment`, después de que el dinero
  -- se mueva, que es lo que le pone precio a la pregunta.
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  if v_prod.tutor_id = v_buyer then
    raise exception 'no puedes regalar tu propia mentoría' using errcode = 'check_violation';
  end if;

  -- Precio congelado AQUÍ y no en el navegador (regla de oro 2), con la misma
  -- aritmética de `create_booking_line` (`20260910120000:176-180`).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount
  end;
  if v_total <= 0 then
    raise exception 'esa mentoría no tiene precio' using errcode = 'check_violation';
  end if;

  -- El cobro lo decide el país del que PAGA (docs/DICTADO-PAGOS.md), y quien
  -- paga aquí es el comprador.
  select public.pais_de_cobro_por_zona(pr.timezone) into v_payer
    from public.profiles pr where pr.id = v_buyer;

  select (public.ruta_de_pago(v_payer)).charge_providers[1] into v_provider;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible' using errcode = 'check_violation';
  end if;

  -- ⚠️ NO CREA RESERVA, NI `sessions`, NI TOCA LA AGENDA DEL TUTOR. El regalo
  -- no bloquea un hueco: eso lo hace el destinatario cuando agende. Y por eso
  -- `expire_stale_bookings` no tiene nada que caducar aquí; si el comprador
  -- abandona el pago, la fila se queda en 'pending_payment' y la barre
  -- `caducar_creditos()`.
  insert into public.credits (
    beneficiary_email, source, kind, destino, status, amount, currency,
    product_id, purchased_by, gift_message, provider, payer_country, expires_at
  ) values (
    v_correo, 'gift', 'mentoria', 'cobro', 'pending_payment', v_total, v_prod.currency,
    v_prod.id, v_buyer, nullif(left(btrim(coalesce(p_message, '')), 500), ''),
    v_provider, v_payer,
    -- Caducidad provisional del cobro sin terminar: si nadie paga, esto lo barre
    -- el cron. Al confirmarlo se reescribe con la de verdad (gift_expiry_days).
    now() + interval '30 days'
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.comprar_regalo(uuid, text, text) is
  'Abre el regalo de una mentoría: congela el precio en servidor, elige el riel por el país del COMPRADOR y deja la fila en pending_payment con su correo de destino. No resuelve si ese correo tiene cuenta —eso sería un oráculo de existencia gratis— ni crea reserva ni toca la agenda del tutor. Tope de 3 regalos sin pagar a la vez: es la única RPC que deja a una sesión crear filas en la tabla del dinero.';

revoke execute on function public.comprar_regalo(uuid, text, text) from public;
revoke execute on function public.comprar_regalo(uuid, text, text) from anon;
grant  execute on function public.comprar_regalo(uuid, text, text) to authenticated;


-- ── 10.1 · El cobro del regalo: quién lo abrió, por cuánto y con qué id ─────
--
-- 🔴 EL CERROJO DE §3 NO CUBRÍA EL REGALO. `marcar_cobro_abierto` solo acepta
-- `booking_ids` y un regalo NO TIENE RESERVA, así que el único camino de cobro
-- de la plataforma que nace en esta migración era también el único sin marcador.
-- Peor: `credits.provider_payment_id` y `provider_metadata` existían con su
-- comentario explicando para qué sirven y **no las escribía nadie**, y
-- `service_role` solo tiene `select` sobre `credits` (correcto, S7), o sea que
-- tampoco podía escribirlas por fuera. Consecuencias medibles:
--
--   · dLocal sella su token ANTES de redirigir
--     (`src/lib/payments/dlocal-provider.ts:256`) y aquí no tenía dónde.
--   · recargar `/regalar/<id>/pagar` abría un cobro NUEVO en vez de reencontrar
--     el abierto, porque la cadena arranca por `checkout.cobrador` y nadie lo
--     había anotado (D-2).
--   · `credits_provider_pid_idx` indexaba una columna que nadie escribía.
--
-- Son dos funciones y no una porque son dos momentos: primero se abre el cobro
-- (se sabe QUIÉN y POR CUÁNTO), después el PSP devuelve su identificador.
create or replace function public.marcar_cobro_regalo_abierto(
  p_credit_id uuid,
  p_provider  text
)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n int := 0;
begin
  if p_credit_id is null or p_provider is null then
    return 0;
  end if;

  -- Solo sobre un regalo que todavía no se ha cobrado: reescribirle el marcador
  -- a uno ya activo sería mentir sobre lo que se cobró.
  --
  -- ⚠️ EL IMPORTE SALE DE LA BASE (`c.amount`), no del Route Handler (regla de
  -- oro 2): quien abre el cobro pasa el SUJETO y el RIEL, nunca el dinero. Y el
  -- riel sí viene de fuera a propósito: lo elige la cadena de candidatos en
  -- servidor y es la única forma de que `credits.provider` acabe diciendo dónde
  -- está la caja de verdad. De esa columna cuelga el `funding_provider` del
  -- payout cuando el regalo se canjee (§8.2), así que dejarla apuntando al
  -- candidato preferido cuando cobró el segundo es dinero buscado en el balance
  -- equivocado.
  update public.credits c
     set checkout_opened_at = now(),
         checkout_amount    = c.amount,
         provider           = p_provider
   where c.id = p_credit_id
     and c.source = 'gift'
     and c.status = 'pending_payment';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function public.marcar_cobro_regalo_abierto(uuid, text) is
  'El marcar_cobro_abierto del REGALO: sella en credits que se ha abierto un cobro, por cuánto (de la BASE) y por qué riel. ⚠️ /api/pagos/checkout tiene que llamarla siempre que abra el cobro de un regalo, y mover aquí el provider es lo que impide que el payout busque la caja en el PSP equivocado cuando cobró el segundo candidato de la cadena.';

revoke execute on function public.marcar_cobro_regalo_abierto(uuid, text) from public;
revoke execute on function public.marcar_cobro_regalo_abierto(uuid, text) from anon;
revoke execute on function public.marcar_cobro_regalo_abierto(uuid, text) from authenticated;
grant  execute on function public.marcar_cobro_regalo_abierto(uuid, text) to service_role;


create or replace function public.marcar_cobro_regalo(
  p_credit_id          uuid,
  p_provider_payment_id text,
  p_metadata           jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n int := 0;
begin
  if p_credit_id is null or nullif(btrim(coalesce(p_provider_payment_id, '')), '') is null then
    return false;
  end if;

  -- EL CERROJO: `status = 'pending_payment'`. Un regalo ya cobrado —o revocado,
  -- o caducado— no cambia de identificador de cargo: eso sería reapuntar un
  -- crédito vivo a otro cobro, que es la forma del agujero que `payments` cerró
  -- no ampliando su `grant update` por columnas.
  --
  -- El `metadata` se MEZCLA y no se pisa (`||` sobre el objeto de antes): el
  -- rastro de un candidato anterior no se borra, exactamente por el mismo
  -- criterio que `anotarCobrador` («anotar no borra el rastro»,
  -- `src/app/api/pagos/checkout/route.ts:800`). Y si nadie había marcado el
  -- cobro como abierto, se marca aquí: dLocal sella su token antes de redirigir
  -- y ése es, de hecho, el momento en que el cobro existe.
  update public.credits c
     set provider_payment_id = p_provider_payment_id,
         provider_metadata   = coalesce(c.provider_metadata, '{}'::jsonb)
                             || coalesce(p_metadata, '{}'::jsonb),
         checkout_opened_at  = coalesce(c.checkout_opened_at, now()),
         checkout_amount     = coalesce(c.checkout_amount, c.amount)
   where c.id = p_credit_id
     and c.source = 'gift'
     and c.status = 'pending_payment';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

comment on function public.marcar_cobro_regalo(uuid, text, jsonb) is
  'Sella en el regalo el identificador del cargo en el PSP y el rastro del checkout, solo mientras sigue pending_payment. Es lo que le faltaba a dLocal (sella su token ANTES de redirigir) y lo que permite que recargar la pantalla de pago reencuentre el cobro abierto en vez de abrir otro. El metadata se mezcla, no se pisa: el rastro de un candidato anterior hay que conciliarlo, no borrarlo.';

revoke execute on function public.marcar_cobro_regalo(uuid, text, jsonb) from public;
revoke execute on function public.marcar_cobro_regalo(uuid, text, jsonb) from anon;
revoke execute on function public.marcar_cobro_regalo(uuid, text, jsonb) from authenticated;
grant  execute on function public.marcar_cobro_regalo(uuid, text, jsonb) to service_role;


-- ── 10.2 · El webhook del regalo ───────────────────────────────────────────
--
-- ⚠️ IDEMPOTENCIA POR ESTADO Y NO POR TABLA, y no es pereza: la PK de
-- `payment_webhook_events` es `(event_id, booking_id)` con `booking_id NOT
-- NULL` desde `20260827160000:59-68`, y un regalo NO TIENE RESERVA. Ahí no se
-- puede deduplicar. El cerrojo de estado es el segundo que `confirm_payment` ya
-- usa (`20260827180000:86`), y aquí basta porque un regalo tiene un solo cobro
-- y un solo sujeto: la matriz (evento × N líneas) que obligó a la clave
-- compuesta no existe.
--
-- 🔴 Y CONCILIA EL IMPORTE, COMO SU HERMANA. `confirm_payment` ganó una
-- conciliación en §7 y ésta se quedaba sin ninguna: el webhook decía `success` y
-- el regalo se activaba por `credits.amount`, mirase lo que mirase el PSP. Hoy
-- no es explotable —el precio se congela en servidor en `comprar_regalo` y nada
-- lo mueve— pero es LA MISMA ASIMETRÍA que convirtió el cobro con crédito en una
-- imprenta de dinero: la señal existía y nadie la comparaba. Cuesta seis líneas.
--
-- ⚠️ `drop function` + `create` y no `create or replace` (regla de oro 12): gana
-- un cuarto argumento, y sobre una base donde la versión de tres se hubiera
-- aplicado, `create or replace` dejaría una SOBRECARGA → `PGRST203`, y fallaría
-- justo cuando el llamador omitiera el opcional (supabase-js no serializa
-- `undefined`).
drop function if exists public.confirm_gift_payment(uuid, boolean, text);

create or replace function public.confirm_gift_payment(
  p_credit_id      uuid,
  p_success        boolean default true,
  p_event_id       text    default null,
  p_amount_charged bigint  default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_c    record;
  v_dest uuid;
begin
  select c.* into v_c from public.credits c where c.id = p_credit_id for update;
  if v_c.id is null then
    raise exception 'regalo no encontrado' using errcode = 'no_data_found';
  end if;
  if v_c.source <> 'gift' then
    raise exception 'ese crédito no es un regalo' using errcode = 'check_violation';
  end if;

  -- Reentrega del mismo evento, o un segundo evento sobre el mismo cargo: ya
  -- resuelto, no-op limpio.
  if v_c.status <> 'pending_payment' then
    return v_c.status;
  end if;

  if not p_success then
    update public.credits set status = 'revoked' where id = p_credit_id;
    return 'revoked';
  end if;

  -- 🔴 LA CONCILIACIÓN, antes de activar nada. Los dos lados son opcionales y
  -- con los dos a null esto no actúa (compatible hacia atrás a propósito,
  -- exactamente igual que en `confirm_payment`): lo que el webhook diga que se
  -- cobró, y lo que el marcador dijo que se abrió, tienen que valer los dos lo
  -- que vale el regalo. Un descuadre ABORTA — el webhook devolverá error, el PSP
  -- reintentará y alguien lo verá, que es infinitamente mejor que un regalo
  -- activado por un importe que nadie cobró.
  if p_amount_charged is not null and p_amount_charged <> v_c.amount then
    raise exception 'el cobro del regalo % dice % y el regalo vale %',
      p_credit_id, p_amount_charged, v_c.amount
      using errcode = 'check_violation',
            hint = 'No se activa un regalo por un importe que no es el suyo.';
  end if;

  if v_c.checkout_amount is not null and v_c.checkout_amount <> v_c.amount then
    raise exception 'el cobro del regalo % se abrió por % y el regalo vale %',
      p_credit_id, v_c.checkout_amount, v_c.amount
      using errcode = 'check_violation',
            hint = 'Marcador de marcar_cobro_regalo_abierto contra credits.amount.';
  end if;

  -- 🔴 AQUÍ, Y NO ANTES, SE RESUELVE EL DESTINATARIO — y solo si su correo está
  -- CONFIRMADO. Con la confirmación apagada (dev) o con una cuenta creada por
  -- el checkout de invitado (`email_confirm: true` sin que nadie pruebe nada),
  -- `email_confirmed_at` es lo único que separa «esta persona demostró que la
  -- dirección es suya» de «alguien escribió esa dirección». Si no hay cuenta o
  -- no está confirmada, se queda null y lo aterriza el reclamo.
  select u.id into v_dest
    from auth.users u
   where lower(btrim(u.email)) = v_c.beneficiary_email
     and u.email_confirmed_at is not null
     and exists (select 1 from public.profiles pr where pr.id = u.id)
   limit 1;

  update public.credits
     set status     = 'active',
         issued_at  = now(),
         expires_at = now() + make_interval(days => public.gift_expiry_days()),
         beneficiary_id = coalesce(beneficiary_id, v_dest),
         -- El checkout dejó de estar abierto: se cobró. El marcador se limpia
         -- para que no quede afirmando lo contrario (aquí sí se puede, al revés
         -- que en `liberar_credito_de_pago`: no hay nada vivo ahí fuera).
         checkout_opened_at = null,
         checkout_amount    = null
   where id = p_credit_id;

  -- Al comprador siempre.
  perform public.enqueue_notification(
    v_c.purchased_by, 'NTF-34', 'email', 'gift_purchased',
    jsonb_build_object('credit_id', p_credit_id, 'product_id', v_c.product_id,
                       'recipient_email', v_c.beneficiary_email,
                       'amount', v_c.amount, 'currency', v_c.currency),
    'GIFT:buy:' || p_credit_id);

  -- Y al destinatario, SI existe. `enqueue_notification` devuelve sin hacer
  -- nada con `recipient_id` null (`20260716170000:62`), así que cuando el
  -- destinatario todavía no tiene cuenta ESE CORREO LO TIENE QUE MANDAR EL
  -- ROUTE HANDLER con Resend directo — el mismo caso y el mismo patrón que
  -- `guest_account_created` en `src/app/api/checkout/invitado/route.ts:292`.
  -- Si no, el regalo llega y nadie se entera.
  perform public.enqueue_notification(
    v_dest, 'NTF-35', 'email', 'gift_received',
    jsonb_build_object('credit_id', p_credit_id, 'product_id', v_c.product_id,
                       'gift_message', v_c.gift_message),
    'GIFT:recv:' || p_credit_id);

  return 'active';
end;
$fn$;

comment on function public.confirm_gift_payment(uuid, boolean, text, bigint) is
  'Confirma (o tumba) el cobro de un regalo. Idempotente POR ESTADO y no por payment_webhook_events, cuya PK exige booking_id not null y un regalo no tiene reserva. Concilia el importe contra credits.amount —por lo que diga el webhook y por el marcador de marcar_cobro_regalo_abierto— antes de activar nada. Resuelve aquí al destinatario, y solo si su correo está confirmado, porque hacerlo en la compra sería un oráculo de existencia de cuentas. ⚠️ Si el destinatario no tiene cuenta, gift_received NO se encola: lo manda el Route Handler con Resend.';

revoke execute on function public.confirm_gift_payment(uuid, boolean, text, bigint) from public;
revoke execute on function public.confirm_gift_payment(uuid, boolean, text, bigint) from anon;
revoke execute on function public.confirm_gift_payment(uuid, boolean, text, bigint) from authenticated;
grant  execute on function public.confirm_gift_payment(uuid, boolean, text, bigint) to service_role;


-- ── 10.3 · Aterrizar el regalo en su dueño ─────────────────────────────────
--
-- 🔴 NUNCA EN `handle_new_user`. Ese trigger corre en el INSERT de
-- `auth.users`, cuando el correo puede no estar probado —él mismo lo sabe: mira
-- `new.email_confirmed_at` antes de encolar NTF-24—. Atar ahí un regalo pagado
-- significa que quien registre primero esa dirección se lo lleva (dev, con la
-- confirmación apagada) o que queda bloqueado para siempre en una cuenta que
-- nadie confirmará (prod, con la confirmación encendida) mientras el
-- destinatario de verdad ya no puede registrar ese correo. Adivinar la
-- dirección es trivial: la teclea el comprador.
create or replace function public.reclamar_regalos_por_correo(p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_correo text;
  v_n      int := 0;
  v_r      record;
begin
  select lower(btrim(u.email)) into v_correo
    from auth.users u
   where u.id = p_user
     and u.email_confirmed_at is not null;   -- ← el cerrojo entero

  if v_correo is null then
    return 0;
  end if;

  -- El perfil tiene que existir: `credits.beneficiary_id` es FK contra él.
  if not exists (select 1 from public.profiles pr where pr.id = p_user) then
    return 0;
  end if;

  for v_r in
    update public.credits c
       set beneficiary_id = p_user
     where c.beneficiary_id is null
       and c.source = 'gift'
       and c.beneficiary_email = v_correo
       and c.status in ('pending_payment', 'active')
    returning c.id, c.status, c.product_id, c.gift_message
  loop
    v_n := v_n + 1;
    if v_r.status = 'active' then
      perform public.enqueue_notification(
        p_user, 'NTF-35', 'email', 'gift_received',
        jsonb_build_object('credit_id', v_r.id, 'product_id', v_r.product_id,
                           'gift_message', v_r.gift_message),
        'GIFT:recv:' || v_r.id);   -- misma clave que confirm_gift_payment: no duplica
    end if;
  end loop;

  return v_n;
end;
$fn$;

comment on function public.reclamar_regalos_por_correo(uuid) is
  'Ata a su dueño los regalos comprados a un correo que hasta ahora no tenía cuenta. Exige email_confirmed_at: atar un regalo pagado a una dirección sin probar es regalárselo a quien la escriba primero. La llaman el trigger de la confirmación y reclamar_mis_regalos().';

revoke execute on function public.reclamar_regalos_por_correo(uuid) from public;
revoke execute on function public.reclamar_regalos_por_correo(uuid) from anon;
revoke execute on function public.reclamar_regalos_por_correo(uuid) from authenticated;
grant  execute on function public.reclamar_regalos_por_correo(uuid) to service_role;


-- La otra mitad, y la que hace que esto sea probable en dev: con la
-- confirmación de correo APAGADA (dev, Google, checkout de invitado) el
-- `email_confirmed_at` llega en el INSERT y el trigger de UPDATE de más abajo
-- no se dispara nunca. Esta RPC la puede llamar la propia persona desde
-- /reservas y solo se reclama a sí misma: `auth.uid()`, sin argumentos.
create or replace function public.reclamar_mis_regalos()
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;
  return public.reclamar_regalos_por_correo(v_uid);
end;
$fn$;

comment on function public.reclamar_mis_regalos() is
  'Reclama los regalos que hay a MI correo (auth.uid(), sin argumentos: nadie puede reclamar por otro). Existe porque con la confirmación de correo apagada —dev, Google OAuth, checkout de invitado— el email_confirmed_at llega en el INSERT y el trigger de la confirmación no se dispara jamás. La llama /reservas al entrar.';

revoke execute on function public.reclamar_mis_regalos() from public;
revoke execute on function public.reclamar_mis_regalos() from anon;
grant  execute on function public.reclamar_mis_regalos() to authenticated;


-- ── 10.4 · El trigger de la confirmación también ata el regalo ─────────────
--
-- Se amplía `notify_email_confirmed()` (el `after update of email_confirmed_at`
-- de `20260911200000:171`) en vez de tocar `handle_new_user`. El trigger ya
-- existe y su `when` ya acota a la transición null → valor; no se recrea.
create or replace function public.notify_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- ⚠️ EL `exists` NO ES DEFENSA DE ADORNO. Esto corre DENTRO del UPDATE con
  -- el que GoTrue confirma el correo: si `enqueue_notification` levantara una
  -- excepción —y la levantaría, por la FK a `profiles`, si por lo que sea no
  -- hubiera perfil— la confirmación entera se caería y la persona no podría
  -- entrar nunca. Un correo de bienvenida no puede tener el poder de bloquear
  -- un alta, así que primero se comprueba que hay a quién escribirle.
  if exists (select 1 from public.profiles p where p.id = new.id) then
    perform public.enqueue_notification(
      new.id, 'NTF-24', 'email', 'welcome_student', '{}'::jsonb,
      'NTF-24:welcome:' || new.id   -- la MISMA clave que en el alta
    );

    -- Y aquí aterriza el regalo comprado a este correo. Mismo razonamiento que
    -- arriba llevado al extremo: si esto fallara, la persona no podría
    -- confirmar su cuenta. Se traga el error y se grita en el log, porque el
    -- regalo tiene un segundo camino (`reclamar_mis_regalos()` desde /reservas)
    -- y una cuenta bloqueada no tiene ninguno.
    begin
      perform public.reclamar_regalos_por_correo(new.id);
    exception when others then
      raise warning 'no se pudo reclamar el regalo del correo de % : %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$fn$;

comment on function public.notify_email_confirmed() is
  'Doc 33 · la mitad de NTF-24 que vive en producción, y desde los créditos también el sitio donde un regalo se ata a su dueño: es el único momento en que el correo está PROBADO. No revoca execute a public a propósito: quien ejecuta el trigger es supabase_auth_admin, el rol con el que GoTrue escribe en auth.users.';


-- ── 10.5 · El contracargo de un regalo ya canjeado (H-3) ───────────────────
--
-- 🔴 EL AGUJERO, CON NÚMEROS. Regalo de 180 cobrado por Stripe el día 1. Día 5
-- el destinatario lo agenda: `payments` de 180 con `credit_amount = 180`,
-- `funding_provider = 'stripe'` y `platform_funded_amount = 0`. Día 20 la clase
-- se completa y el ciclo le paga al tutor 144. Día 25 el comprador hace
-- contracargo de los 180.
--
-- Hasta aquí la salida era «se pone `credits.status='refunded'` a mano». Eso no
-- toca NADA más: no hay fila en `payments` del cargo del regalo, así que
-- `refund_payment` no lo alcanza; el `payout_item` ya cobrado sigue donde está;
-- y `payments.platform_funded_amount = 0` sigue afirmando que ese pago estaba
-- respaldado por caja, así que `fondeo_del_ciclo` no enseña el hueco ni hoy ni
-- nunca. **Pérdida neta de 144 por contracargo, indetectable.**
--
-- Esto no automatiza la decisión —la toma un humano, y por eso es `service_role`
-- y no hay pantalla— sino sus CONSECUENCIAS: reusa el mismo bloque S-29 de
-- `refund_payment` (sacar la línea si la orden todavía no se pagó, gritar
-- clawback si ya) y deja escrito el hueco donde operaciones lo mira.
--
-- ⚠️ LA CLASE NO SE CANCELA. El destinatario no hizo nada malo y el tutor dio la
-- clase: quien se come el contracargo es la plataforma, que es lo que dice el
-- `clawback_needed` del resultado. Cancelar la reserva por un contracargo del
-- COMPRADOR sería castigar a dos terceros.
create or replace function public.revertir_regalo(p_credit_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_c         record;
  v_p         record;
  v_item      record;
  v_estado    public.payout_status;
  v_clawback  boolean := false;
  v_hueco     bigint  := 0;
  -- ⚠️ Escalar y no `v_item.payout_id`: un `record` de plpgsql que NUNCA se
  -- asignó levanta «record "v_item" is not assigned yet» EN EJECUCIÓN en cuanto
  -- se le lee un campo, y aquí el `select … into v_item` vive dentro de un `if`
  -- mientras el `return` de abajo está fuera. Es el fallo de la regla de oro 11
  -- en su forma más pura: `create function` no lo ve.
  v_payout    uuid;
begin
  select c.* into v_c from public.credits c where c.id = p_credit_id for update;
  if v_c.id is null then
    raise exception 'regalo no encontrado' using errcode = 'no_data_found';
  end if;
  if v_c.source <> 'gift' then
    raise exception 'ese crédito no es un regalo (es %)', v_c.source
      using errcode = 'check_violation',
            hint = 'Una recompensa de referido no la ha pagado nadie: se revoca con status=''revoked''.';
  end if;

  -- Idempotente: un contracargo llega por dos caminos (el correo del PSP y el
  -- webhook) y no puede sacar dos veces la misma línea del payout.
  if v_c.status = 'refunded' then
    return jsonb_build_object('credit_id', p_credit_id, 'status', 'refunded',
                              'ya_estaba', true, 'clawback_needed', false);
  end if;

  -- ⚠️ ORDEN DE BLOQUEO: `credits` ya está bloqueado y ahora `payments`. Es el
  -- ÚNICO sitio de esta migración que los toma en ese orden, y puede serlo
  -- porque nadie llega aquí desde un camino que ya tenga `payments` cogido:
  -- esto lo dispara un humano sobre un regalo, no un webhook sobre un pago.
  select p.id, p.booking_id, p.status, p.gross_amount, p.tutor_net_amount,
         coalesce(p.platform_funded_amount, 0) as platform_funded_amount
    into v_p
  from public.payments p
  where p.credit_id = p_credit_id
  order by p.created_at desc
  limit 1
  for update;

  if v_p.id is not null and v_p.status in ('paid', 'partially_refunded') then
    -- El hueco es el NETO DEL TUTOR: es lo que sale del balance y ya no tiene
    -- caja detrás. El fee no: ése no se paga a nadie.
    v_hueco := greatest(0, v_p.tutor_net_amount);

    select pi.id as item_id, pi.amount as item_amount, po.id as payout_id
      into v_item
    from public.payout_items pi
    join public.payouts po on po.id = pi.payout_id
    where pi.payment_id = v_p.id
    for update of po, pi;

    v_payout := v_item.payout_id;

    if v_payout is not null then
      select po.status into v_estado from public.payouts po where po.id = v_payout;
    end if;

    -- El guardián de 'processing', palabra por palabra el de `refund_payment`:
    -- una orden que el proveedor tiene entre manos no se toca.
    if v_estado = 'processing'::public.payout_status then
      raise exception
        'hay una orden de pago en ejecución con este regalo dentro (payout %): espera a que el proveedor la confirme y repite',
        v_payout using errcode = 'check_violation';
    end if;

    if v_estado = 'paid'::public.payout_status then
      -- Ya se le pagó al tutor: el dinero salió y no vuelve solo (S-29, manual).
      v_clawback := true;
    elsif v_item.item_id is not null then
      delete from public.payout_items where id = v_item.item_id;

      update public.payouts
         set amount = amount - v_item.item_amount,
             platform_funded_amount =
               greatest(0, platform_funded_amount - v_p.platform_funded_amount)
       where id = v_payout;

      -- S-4: una orden con recompensas dentro NO se borra (y `restrict` la
      -- defendería a gritos si alguien quitara este filtro).
      delete from public.payouts po
       where po.id = v_payout
         and not exists (select 1 from public.payout_items x where x.payout_id = po.id)
         and not exists (select 1 from public.payout_adjustments a where a.payout_id = po.id);
    end if;

    -- 🔴 Y LO QUE HACE VISIBLE EL AGUJERO. El cobro decía «respaldado por caja»
    -- porque el regalo estaba cobrado; ya no lo está. Con esto, el próximo
    -- `build_payout_for_tutor` que recoja este pago sumará el neto entero a
    -- `payouts.platform_funded_amount` y `fondeo_del_ciclo` se lo enseñará a
    -- operaciones en vez de tragárselo.
    update public.payments
       set platform_funded_amount = v_hueco
     where id = v_p.id;
  end if;

  update public.credits
     set status = 'refunded',
         gift_message = case
           when nullif(btrim(coalesce(p_motivo, '')), '') is null then gift_message
           else left(coalesce(gift_message, '') || ' · [revertido: '
                     || btrim(p_motivo) || ']', 500)
         end
   where id = p_credit_id;

  return jsonb_build_object(
    'credit_id',       p_credit_id,
    'status',          'refunded',
    'ya_estaba',       false,
    'payment_id',      v_p.id,
    'payout_id',       v_payout,
    'clawback_needed', v_clawback,
    'hueco',           v_hueco,
    'currency',        v_c.currency
  );
end;
$fn$;

comment on function public.revertir_regalo(uuid, text) is
  'H-3 · el contracargo de un regalo YA CANJEADO. Marca el crédito refunded y, sobre el cobro que financió, hace lo mismo que refund_payment: saca la línea del payout si todavía no se pagó (o devuelve clawback_needed si ya) y deja platform_funded_amount = tutor_net_amount para que el hueco salga en fondeo_del_ciclo en vez de desaparecer. NO cancela la clase: el destinatario no hizo nada y el tutor la dio. Idempotente.';

revoke execute on function public.revertir_regalo(uuid, text) from public;
revoke execute on function public.revertir_regalo(uuid, text) from anon;
revoke execute on function public.revertir_regalo(uuid, text) from authenticated;
grant  execute on function public.revertir_regalo(uuid, text) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 11 · Las dos puertas automáticas por las que se perdía un crédito
-- ════════════════════════════════════════════════════════════════════════════
--
-- Los cuerpos salen de la versión VIVA de cada función (`pg_get_functiondef`,
-- 11-sep), no del fichero: `expire_stale_bookings` está en `20260826120000` y
-- `cancel_booking` en `20260817170000`, y copiar un cuerpo viejo revertiría en
-- silencio los reembolsos reales de X-01 o la guarda de la carrera de B-1.
-- Las dos se replican LETRA POR LETRA salvo lo que se marca.

create or replace function public.expire_stale_bookings(
  p_payment_cutoff    interval default interval '7 minutes',
  p_acceptance_cutoff interval default interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- Las candidatas que vio la foto…
  v_pay_ids  uuid[];
  -- …y las que de verdad se cancelaron. NO tienen por qué coincidir: esa
  -- diferencia es la carrera, y por eso se cuenta abajo en vez de esconderse.
  v_pay_done uuid[];
  v_acc_ids  uuid[];
  -- Las aceptaciones vencidas cuyo reembolso NO se pudo repartir. No se cierran:
  -- marcarlas 'refunded' sin haber encolado nada es la mentira creíble de
  -- siempre. Se quedan para la pasada siguiente (la clave de idempotencia hace
  -- que reintentar no duplique nada).
  v_acc_mal  uuid[] := '{}'::uuid[];
  v_acc_ok   uuid[];
  v_r        record;
  v_cred     record;
  v_encolados    int := 0;
  v_liberados    int := 0;
  v_fallos_cred  int := 0;
  v_fallos_ref   int := 0;
begin
  -- 1) pending_payment vencidas (nunca se cobró) → cancelled, sin reembolso.
  select array_agg(id) into v_pay_ids
  from public.bookings
  where status = 'pending_payment'
    and created_at < now() - p_payment_cutoff;

  if v_pay_ids is not null then
    -- ⚠️ `payments` PRIMERO, y no por costumbre: fija el mismo orden de bloqueo
    -- que `confirm_payment` (evita el deadlock) y de paso valla al webhook
    -- mientras dura esta transacción.
    update public.payments set status = 'failed', failed_at = now()
      where booking_id = any(v_pay_ids) and status = 'pending';

    -- ⚠️ AQUÍ ESTÁ LA GUARDA. `and status = 'pending_payment'` es lo que impide
    -- cancelar una reserva que el webhook confirmó entre la foto y este update;
    -- el `returning` es lo que permite que las sesiones se cancelen SOLO de las
    -- reservas que de verdad se cancelaron.
    with canceladas as (
      update public.bookings
         set status = 'cancelled', cancelled_at = now()
       where id = any(v_pay_ids)
         and status = 'pending_payment'
      returning id
    )
    select array_agg(id) into v_pay_done from canceladas;

    if v_pay_done is not null then
      update public.sessions set status = 'cancelled', cancelled_at = now()
        where booking_id = any(v_pay_done) and status = 'scheduled';

      -- 🔴 NUEVO · DEVOLVER EL CRÉDITO. Esta rama corre CADA MINUTO sobre todo
      -- lo que lleve 7 minutos sin pagar, y es la puerta por la que se destruía
      -- un regalo que alguien pagó de verdad: el destinatario agenda, se aplica
      -- el crédito, el checkout devuelve `{modo:"credito"}` y hace falta una
      -- SEGUNDA llamada del navegador para confirmarlo. Si cierra la pestaña,
      -- aquí moría. Se hace sobre `v_pay_done` —las que de verdad se
      -- cancelaron— y no sobre `v_pay_ids`, o le devolveríamos el crédito a
      -- alguien cuya reserva se salvó por la carrera.
      --
      -- ⚠️ Y CADA FILA EN SU PROPIO `begin … exception`. Esto es un bucle con
      -- una RPC por fila DENTRO de un job que corre CADA MINUTO: sin el
      -- cinturón, un solo crédito con la aritmética mal aborta la transacción
      -- entera y con ella el cierre de TODOS los checkouts vencidos de la
      -- plataforma, en silencio, en `cron.job_run_details` (regla de oro 11). Un
      -- regalo que no se devuelve es un incidente; una pasada que no cierra
      -- nada, día tras día, es el agujero de los 12.446 fallos seguidos.
      -- El `raise warning` es el mismo patrón que ya usa `notify_email_confirmed`.
      for v_cred in
        select p.id from public.payments p
         where p.booking_id = any(v_pay_done)
           and p.credit_id is not null
      loop
        begin
          perform public.liberar_credito_de_pago(v_cred.id);
          v_liberados := v_liberados + 1;
        exception when others then
          v_fallos_cred := v_fallos_cred + 1;
          raise warning 'expire_stale_bookings: no se pudo devolver el crédito del pago % : %',
            v_cred.id, sqlerrm;
        end;
      end loop;
    end if;
  end if;

  -- 2) pending_acceptance vencidas (tutor no respondió) → cancelled + 100%.
  select array_agg(b.id) into v_acc_ids
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.status = 'pending_acceptance'
    and p.paid_at < now() - p_acceptance_cutoff;

  if v_acc_ids is not null then
    -- ⚠️ ANTES DEL UPDATE, y no después. El tramo a devolver es
    -- `gross_amount - refunded_amount` LEÍDO AHORA; en cuanto el update ponga
    -- el acumulado al máximo, esa resta da cero y no se encolaría nada.
    for v_r in
      select p.id, p.booking_id, p.gross_amount, p.refunded_amount,
             p.gross_amount - p.refunded_amount as delta
        from public.payments p
       where p.booking_id = any(v_acc_ids)
         and p.gross_amount > p.refunded_amount
    loop
      -- 🔴 NUEVO · SE PARTE EL TRAMO. Antes esto encolaba `delta` entero contra
      -- la pasarela. En un cobro de 180 con 45 de crédito, eso son 180 contra
      -- un cargo de 135: Stripe lo rechaza en cada pasada del cron para
      -- siempre, mientras `payments.status` ya dice `refunded`. El alumno no
      -- recibe nada y el estado afirma que se le devolvió todo.
      --
      -- Mismo cinturón que la rama 1, y aquí pesa más: el tope nuevo de
      -- `enqueue_refund` ABORTA a propósito cuando el llamador pide más efectivo
      -- del que entró, y sin este `exception` ese grito —que está bien dado— se
      -- llevaría por delante la pasada entera.
      --
      -- `p_ya_devuelto` es `refunded_amount` LEÍDO AHORA: el `update` que lo
      -- pone al máximo va después del bucle, a propósito.
      begin
        perform public.reembolsar_con_credito(
          v_r.id,
          v_r.delta,
          v_r.refunded_amount,
          'RN-38 · el tutor no respondió en 24 h (100 %)',
          'X01:payment:' || v_r.id || ':' || v_r.gross_amount
        );
        v_encolados := v_encolados + 1;
      exception when others then
        v_fallos_ref := v_fallos_ref + 1;
        v_acc_mal    := v_acc_mal || v_r.booking_id;
        raise warning 'expire_stale_bookings: no se pudo repartir el reembolso del pago % : %',
          v_r.id, sqlerrm;
      end;
    end loop;

    -- 🔴 Y SOLO SE CIERRA LO QUE DE VERDAD SE REPARTIÓ. Si el reparto de una
    -- fila falló, marcarla `refunded` diría que se devolvió todo con la cola
    -- vacía —el mismo estado que miente que esta migración vino a arreglar—.
    -- Se queda `pending_acceptance` y la pasada del minuto siguiente lo vuelve a
    -- intentar; la clave de idempotencia impide que un reintento duplique nada.
    select coalesce(array_agg(x), '{}'::uuid[]) into v_acc_ok
      from (select unnest(v_acc_ids) as x
            except
            select unnest(v_acc_mal)) s;

    if array_length(v_acc_ok, 1) is not null then
      update public.payments set status = 'refunded', refunded_amount = gross_amount
        where booking_id = any(v_acc_ok);
      update public.bookings set status = 'cancelled', cancelled_at = now()
        where id = any(v_acc_ok);
      update public.sessions set status = 'cancelled', cancelled_at = now()
        where booking_id = any(v_acc_ok) and status = 'scheduled';
    end if;
  end if;

  return jsonb_build_object(
    'payment_expired',    coalesce(array_length(v_pay_done, 1), 0),
    -- 🔎 EL TERMÓMETRO DE LA CARRERA. Candidatas que la guarda salvó porque
    -- dejaron de estar pendientes entre la foto y el update.
    'payment_raced',      coalesce(array_length(v_pay_ids, 1), 0)
                          - coalesce(array_length(v_pay_done, 1), 0),
    'acceptance_expired', coalesce(array_length(v_acc_ok, 1), 0),
    'refunds_enqueued',   v_encolados,
    -- Clave NUEVA. Si esto sube, hay gente perdiendo su regalo entre el canje y
    -- la confirmación: el número que hay que mirar para decidir si el canje
    -- tiene que volverse atómico.
    'credits_released',   v_liberados,
    -- 🔎 LOS DOS TERMÓMETROS DEL CINTURÓN. Cualquiera de los dos por encima de 0
    -- es un `raise warning` en `cron.job_run_details` que alguien tiene que
    -- mirar: la pasada no aborta a propósito, así que este número es lo único
    -- que lo cuenta. `refunds_failed` además deja reservas sin cerrar.
    'credits_failed',     v_fallos_cred,
    'refunds_failed',     v_fallos_ref
  );
end;
$fn$;

comment on function public.expire_stale_bookings(interval, interval) is
  'V-3 · vence checkouts a los 7 min y aceptaciones a las 24 h (RN-38). Desde los créditos hace dos cosas más: devuelve el crédito de las reservas que de verdad caducan (antes un regalo pagado moría aquí en 7 minutos) y reparte el reembolso de RN-38 entre tarjeta y crédito. Los dos bucles con RPC por fila van envueltos en su begin/exception: corre CADA MINUTO y un cálculo malo no puede abortar el cierre de todos los checkouts de la plataforma. `credits_released` es el termómetro del primero; `credits_failed` y `refunds_failed`, el del cinturón — y una aceptación cuyo reembolso falló NO se marca refunded, se reintenta.';

revoke execute on function public.expire_stale_bookings(interval, interval) from public;
revoke execute on function public.expire_stale_bookings(interval, interval) from anon;
revoke execute on function public.expire_stale_bookings(interval, interval) from authenticated;
grant  execute on function public.expire_stale_bookings(interval, interval) to service_role;


create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := (select auth.uid());
  v_bk       record;
  v_is_tutor boolean;
  v_earliest timestamptz;
  v_pay      record;
  v_pct      int;
  v_refund   bigint := 0;   -- acumulado tras esta cancelación
  v_prev     bigint := 0;   -- lo que ya se había devuelto antes
  v_delta    bigint := 0;   -- lo que hay que mover DE VERDAD ahora
  v_reparto  jsonb  := jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
begin
  select id, student_id, tutor_id, status
    into v_bk
  from public.bookings
  where id = p_booking_id
    and (student_id = v_uid or tutor_id = v_uid)
    and status in ('pending_payment', 'pending_acceptance', 'confirmed');
  if v_bk.id is null then
    raise exception 'reserva no cancelable o inexistente' using errcode = 'check_violation';
  end if;

  v_is_tutor := (v_uid = v_bk.tutor_id);

  -- RN-37 sobre la sesión más próxima aún agendada.
  select min(start_at) into v_earliest
  from public.sessions
  where booking_id = p_booking_id and status = 'scheduled';

  if v_is_tutor then
    v_pct := 100;
  elsif v_earliest is null or v_earliest - now() >= interval '24 hours' then
    v_pct := 100;
  else
    v_pct := 50;
  end if;

  -- Reembolso solo si el pago fue capturado.
  select id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where booking_id = p_booking_id;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev   := coalesce(v_pay.refunded_amount, 0);
    v_refund := round(v_pay.gross_amount * v_pct / 100.0);
    -- El acumulado no retrocede jamás.
    v_refund := greatest(v_refund, v_prev);
    v_delta  := v_refund - v_prev;

    update public.payments
      set status = (case when v_pct >= 100 then 'refunded' else 'partially_refunded' end)::public.payment_status,
          refunded_amount = v_refund
      where booking_id = p_booking_id;

    -- 🔴 NUEVO · SE PARTE EL TRAMO. Antes esto encolaba `v_delta` entero contra
    -- la pasarela. Reserva de 180 con 45 de crédito y 135 de tarjeta, cancelada
    -- a menos de 24 h: `v_delta` = 90 contra un cargo de 135. El PSP lo acepta
    -- y **el alumno recibe 90 en efectivo por 135 que puso**, cuando lo suyo
    -- eran 67,5. Y el crédito se quedaba consumido encima.
    --
    -- `p_ya_devuelto` es `v_prev`, el acumulado de ANTES: el `update` de encima
    -- ya movió la fila, así que leerlo de ahí dentro daría el de después y el
    -- reparto se desplazaría un tramo entero. Pasarlo explícito es lo que hace
    -- que el orden de estas dos sentencias deje de ser load-bearing.
    v_reparto := public.reembolsar_con_credito(
      v_pay.id,
      v_delta,
      v_prev,
      'RN-37 · cancela ' || (case when v_is_tutor then 'el tutor' else 'el alumno' end)
        || ' (' || v_pct || ' %)',
      'X01:payment:' || v_pay.id || ':' || v_refund
    );

  elsif v_pay.status = 'pending' then
    -- Nunca se cobró (pending_payment): sin reembolso. Este 'failed' es además
    -- el que hace que X-02 rechace un cobro que llegue tarde por esta reserva.
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    -- 🔴 NUEVO · Y LA CUARTA PUERTA: cancelar a mano una reserva sin pagar con
    -- el crédito ya aplicado. `payments` acaba de quedar bloqueado por el
    -- update de arriba, así que el orden payments → credits se conserva.
    perform public.liberar_credito_de_pago(v_pay.id);
    v_refund := 0;
  end if;

  update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
    where id = p_booking_id;
  update public.sessions set status = 'cancelled', cancelled_at = now()
    where booking_id = p_booking_id and status = 'scheduled';

  -- `refund_amount` sigue siendo el ACUMULADO EN PRECIO, que es lo que la
  -- pantalla enseña como "se te devolverá X": la forma NO cambia, la consume
  -- cancel-form.tsx. Las claves nuevas son aditivas y son lo que hay que enseñar
  -- cuando hubo crédito: «135 a tu tarjeta, 45 a tu saldo».
  --
  -- ⚠️ Y AQUÍ HAY UNA TENTACIÓN QUE HAY QUE RESISTIR. Cancelar al 50 % una
  -- reserva pagada al 100 % con una mentoría gratis no devuelve NADA (el premio
  -- es todo o nada, ver `reembolsar_con_credito`) y sin embargo esta función
  -- escribe igualmente `refunded_amount = 600` y `partially_refunded`: el estado
  -- afirma una devolución que no existió. Lo correcto NO es escribir ahí lo que
  -- de verdad se movió: `payments.refunded_amount` es la base de la fórmula
  -- acumulada, y si deja de ser el precio acumulado, el siguiente tramo se
  -- calcula sobre una base más baja y la suma de los tramos en efectivo PUEDE
  -- PASARSE de lo que la pasarela cobró — que es exactamente la fuga que el tope
  -- de `enqueue_refund` está ahí para frenar. Así que el libro se queda en
  -- precio y la VERDAD se cuenta aparte, con tres números: lo que va a la
  -- tarjeta, lo que vuelve al saldo y lo que se pierde.
  return jsonb_build_object(
    'refund_pct',            v_pct,
    'refund_amount',         v_refund,
    'refund_cash',           coalesce((v_reparto ->> 'cash')::bigint, 0),
    'refund_credit',         coalesce((v_reparto ->> 'credit')::bigint, 0),
    'refund_credit_perdido', coalesce((v_reparto ->> 'credito_perdido')::bigint, 0)
  );
end;
$fn$;

comment on function public.cancel_booking(uuid, text) is
  'RN-37 · cancela y reparte el reembolso entre la tarjeta y el crédito que lo financió. `refund_amount` sigue siendo el acumulado EN PRECIO (lo pinta cancel-form.tsx, y es la base de la fórmula acumulada: moverlo rompería el techo del efectivo); `refund_cash`, `refund_credit` y `refund_credit_perdido` son nuevas y son la verdad de lo que se movió. Cancelar una reserva sin pagar devuelve el crédito entero.';

-- `create or replace` conserva privilegios, pero se repiten por si esta
-- migración se aplicara sobre una base donde la función no existiera: en
-- Postgres el `execute` nace concedido a PUBLIC.
revoke execute on function public.cancel_booking(uuid, text) from public;
revoke execute on function public.cancel_booking(uuid, text) from anon;
grant  execute on function public.cancel_booking(uuid, text) to authenticated;



-- ════════════════════════════════════════════════════════════════════════════
-- 12 · Las dos guardas de `profiles` que ahora llevan dinero
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 LA VENTANA DE UNA HORA ERA BARATA Y HA DEJADO DE SERLO. El checkout de
-- invitado crea la cuenta DENTRO del pago, así que la primera compra de esa
-- persona SIEMPRE cae dentro de la hora de margen: pagar y, acto seguido,
-- `PATCH /rest/v1/profiles?id=eq.<yo>` poniéndose el código de una segunda
-- cuenta propia satisface ya la regla `alumnos` (`payments.status = 'paid'`) y
-- la pasada siguiente del cron emite un crédito a esa segunda cuenta.
-- `m.profile_id <> p.id` solo frena al que se refiere a sí mismo, no al que
-- tiene dos cuentas. Hasta hoy eso costaba una cualificación en RF; ahora es
-- dinero en cada compra.
--
-- Y `referral_converted_at` no tenía guarda NINGUNA, con `profiles` llevando
-- `grant update` de TABLA a `authenticated` (`20260703120000:16`): ponerla a
-- null era un PATCH, y lo único que quedaba impidiendo una segunda emisión era
-- el índice único.
create or replace function public.referral_code_no_se_reasigna()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- ⚠️ `current_user` A SECAS. Es una palabra reservada del estándar, no una
  -- función de `pg_catalog`: cualificarla da `42P01 missing FROM-clause entry
  -- for table "pg_catalog"` EN EJECUCIÓN, no al crear la función — justo lo que
  -- avisa la regla de oro 11. Y por ser palabra reservada, el
  -- `set search_path = ''` de arriba no la afecta.

  -- ── Guarda NUEVA · la marca de conversión no la mueve el navegador ────────
  -- La pone y la quita `/api/cron/referrals-sync` con service_role. Desde los
  -- créditos, resetearla a null es pedir que se vuelva a mirar una conversión
  -- ya premiada.
  if new.referral_converted_at is distinct from old.referral_converted_at
     and current_user::text = 'authenticated' then
    raise exception
      'referral_converted_at no lo mueve el navegador (perfil %)', old.id
      using errcode = '42501',
            hint = 'La conversión la marca /api/cron/referrals-sync cuando Referral Factory la acepta.';
  end if;

  -- Sin cambio de código: la inmensa mayoría de los `update` sobre profiles.
  if new.referral_code is not distinct from old.referral_code then
    return new;
  end if;

  -- Borrarlo se permite siempre: lo hace la anonimización de la baja de cuenta.
  if new.referral_code is null then
    return new;
  end if;

  -- Ponerlo por primera vez, recién llegado: es el camino legítimo (el alta por
  -- Google, que lo escribe segundos después de crearse el perfil, y el checkout
  -- de invitado, que lo mete en el metadata).
  --
  -- ⚠️ Y AHORA CON UN SEGUNDO CERROJO: nunca después de haber pagado. El
  -- checkout de invitado crea la cuenta dentro del pago, así que la hora de
  -- margen y la primera compra se solapan siempre; sin esta condición, la
  -- atribución se podía reescribir con el cobro ya hecho.
  if old.referral_code is null
     and old.created_at > now() - interval '1 hour'
     and not exists (
       select 1
         from public.payments pay
         join public.bookings b on b.id = pay.booking_id
        where b.student_id = old.id
          and pay.status in ('paid', 'partially_refunded', 'refunded')) then
    return new;
  end if;

  -- ⚠️ Sólo se frena al rol del NAVEGADOR. Operaciones (service_role, postgres)
  -- sigue pudiendo corregir una atribución a mano, que es trabajo legítimo.
  if current_user::text = 'authenticated' then
    raise exception
      'referral_code no se reasigna después del alta (perfil %)', old.id
      using errcode = '42501',
            hint = 'La atribución la fija la cookie ey-ref al registrarse.';
  end if;

  return new;
end;
$fn$;

comment on function public.referral_code_no_se_reasigna() is
  'Impide que alguien se atribuya a sí mismo a un referidor DESPUÉS del alta, y desde los créditos también que mueva referral_converted_at. profiles tiene grant update de TABLA a authenticated (20260703120000:16) y la política es por fila, así que sin esto un PATCH desde el navegador bastaba. La ventana de una hora del alta sigue, pero ya no cubre a quien ya pagó: el checkout de invitado crea la cuenta dentro del pago y las dos cosas se solapaban siempre.';


-- ════════════════════════════════════════════════════════════════════════════
-- 13 · Los dos correos que mentían sobre el dinero (H-11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 `notify_payment()` MANDA EL PRECIO Y LO LLAMA «lo que pagaste». Con los
-- créditos eso deja de ser un matiz:
--
--   · NTF-04 (recibo) manda `amount = gross_amount`. En un canje 100 % crédito
--     —una mentoría regalada, el caso central de esta migración— el alumno
--     recibe **un recibo de 1200 por dinero que no ha pagado**. Un recibo es un
--     documento: decir que cobramos algo que no cobramos no es un detalle de
--     copy.
--   · NTF-10 (reembolso) manda `refunded = refunded_amount`, que es el PRECIO
--     acumulado. En una cancelación mixta se le dice 180 cuando a su tarjeta
--     vuelven 135.
--
-- Se reescribe desde el cuerpo VIVO (`pg_get_functiondef`, 11-sep), letra por
-- letra salvo los dos `jsonb_build_object`. La firma no cambia (`returns
-- trigger`) → `create or replace`, y el trigger `notifications_on_payment` NO se
-- recrea: sigue apuntando a esta misma función.
--
-- ⚠️ LAS CLAVES VIEJAS SIGUEN AHÍ, con el valor corregido, y las nuevas son
-- ADITIVAS. Es lo que permite desplegar esto sin coordinar con las plantillas:
-- una plantilla que lea `amount` o `refunded` sigue renderizando, solo que ahora
-- con el número verdadero. Las nuevas (`gross_amount`, `credit_amount`,
-- `refunded_credit`, `refunded_total`) están para que la plantilla pueda contar
-- las dos líneas cuando alguien las escriba — y ese día, Vercel primero.
create or replace function public.notify_payment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_student  uuid;
  v_pedido   uuid;
  v_credito  bigint := coalesce(new.credit_amount, 0);
  v_efectivo bigint;          -- lo que de verdad pasó por la pasarela
  v_dev_cash bigint;          -- del acumulado devuelto, lo que vuelve a la tarjeta
begin
  if new.status is distinct from old.status
     or new.refunded_amount is distinct from old.refunded_amount then
    -- Alias explícito: la tabla trae ahora dos columnas del mismo `select` y
    -- sin él `student_id` a secas es ambiguo de leer, no de compilar.
    select b.student_id, b.order_id into v_student, v_pedido
      from public.bookings b where b.id = new.booking_id;

    v_efectivo := new.gross_amount - v_credito;

    if new.status = 'paid' and old.status <> 'paid' and v_pedido is null then
      -- Compra suelta: este ES el recibo. Si la reserva va en un pedido, el
      -- recibo lo manda confirm_order_payment con el total (NTF-04b).
      --
      -- `amount` = LO QUE SE COBRÓ. `gross_amount` y `credit_amount` van al lado
      -- para que el recibo pueda decir «1200, de los que 1200 los puso tu
      -- regalo» en vez de callárselo.
      perform public.enqueue_notification(v_student, 'NTF-04', 'email', 'payment_receipt',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'amount', v_efectivo, 'currency', new.currency,
                           'gross_amount', new.gross_amount,
                           'credit_amount', v_credito),
        'NTF-04:payment:' || new.id);
    elsif new.status in ('refunded', 'partially_refunded') then
      -- El tramo en efectivo del acumulado, con LA MISMA fórmula acumulada que
      -- usa `reembolsar_con_credito` (y por eso cuadra con lo que se encoló):
      -- `round(devuelto * efectivo / gross)`. Sin crédito da `refunded_amount`
      -- exacto, que es lo que este aviso decía hasta hoy.
      if v_credito = 0 or new.gross_amount = 0 then
        v_dev_cash := new.refunded_amount;
      else
        v_dev_cash := round(new.refunded_amount::numeric * v_efectivo / new.gross_amount);
      end if;

      -- Clave incluye el acumulado reembolsado → parcial y total avisan una vez
      -- cada uno. `refunded` es lo que vuelve A LA TARJETA; `refunded_credit` lo
      -- que vuelve al saldo y `refunded_total` el precio acordado.
      perform public.enqueue_notification(v_student, 'NTF-10', 'email', 'refund_processed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'refunded', v_dev_cash, 'currency', new.currency,
                           'refunded_credit', new.refunded_amount - v_dev_cash,
                           'refunded_total', new.refunded_amount),
        'NTF-10:payment:' || new.id || ':' || new.refunded_amount);
    elsif new.status = 'failed' then
      perform public.enqueue_notification(v_student, 'NTF-15', 'email', 'payment_failed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id),
        'NTF-15:payment:' || new.id);
    end if;
  end if;
  return new;
end;
$fn$;

comment on function public.notify_payment() is
  'Trigger de avisos de payments (NTF-04 recibo, NTF-10 reembolso, NTF-15 fallo). Desde los créditos los dos primeros dicen la verdad sobre el dinero: `amount` es lo que cobró la pasarela (gross - credit_amount), no el precio, y `refunded` es lo que vuelve a la tarjeta, no el acumulado. Un canje 100 % crédito mandaba un recibo por dinero que el alumno no pagó. Las claves viejas conservan su nombre con el valor corregido; gross_amount, credit_amount, refunded_credit y refunded_total son aditivas.';


-- ════════════════════════════════════════════════════════════════════════════
-- 14 · La baja de cuenta también mira el dinero que hay en `credits` (H-12)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 HOY SE PUEDE UNO DAR DE BAJA CON DINERO DENTRO Y NADIE DICE NADA.
-- `account_deletion_state` mira clases futuras, saldo sin liquidar, payouts en
-- vuelo y reembolsos pendientes — todo lo que existía antes de esta migración— y
-- `credits` no existía. O sea:
--
--   · un TUTOR con una recompensa `destino='payout'` activa (dinero que le
--     debemos y que todavía no ha entrado en ningún ciclo) se da de baja y la
--     recompensa se queda ahí, viva, apuntando a un perfil anonimizado;
--   · un ALUMNO con un regalo SIN AGENDAR que pagó un tercero se da de baja y
--     los 180 de otra persona desaparecen sin un aviso.
--
-- Se reescribe desde el cuerpo VIVO, `language sql` y firma intacta →
-- `create or replace`. `account_deletion_blockers` no se toca: deriva de ésta
-- (quita solo las dos claves descriptivas del saldo), así que las claves nuevas
-- le llegan solas.
--
-- ── DÓNDE VA CADA UNA, Y POR QUÉ NO AL REVÉS ───────────────────────────────
-- `accionables` = lo que solo puede cerrar la persona; impide PEDIR la baja.
-- `en_espera`   = lo que cierra el sistema; desactiva la cuenta y la programa.
--
--   · El regalo sin agendar es ACCIONABLE: agendarlo es cosa suya y de nadie
--     más. Ponerlo en `en_espera` sería el interbloqueo que la cabecera de
--     `20260826230000` describe —cuenta desactivada que ya no puede agendar
--     nada, esperando a que alguien agende— y encima se comería 90 días.
--   · La recompensa al payout es EN ESPERA: la paga el ciclo siguiente sin que
--     la persona haga nada, y entonces la clave desaparece sola.
--   · La recompensa con `destino='cobro'` NO bloquea nada, a propósito: es una
--     promoción que pone la plataforma, no dinero de nadie. Bloquear una baja
--     por un premio regalado es peor que perderlo.
create or replace function public.account_deletion_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $fn$
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
    select coalesce(sum(p.tutor_net_amount), 0) as importe,
           count(distinct p.currency)           as monedas,
           min(p.currency)                      as moneda,
           max(b.completed_at)                  as ultimo_completado
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.tutor_id = p_user_id
       and p.status   = 'paid'
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
$fn$;

comment on function public.account_deletion_state(uuid) is
  'EY-192 · lo que impide o retrasa una baja de cuenta. Desde los créditos mira también credits: un regalo pagado por un tercero y sin agendar es ACCIONABLE (solo la persona puede usarlo; meterlo en en_espera con la cuenta desactivada sería un interbloqueo) y una recompensa con destino=payout es EN ESPERA (la paga el ciclo siguiente y la clave desaparece sola). Una recompensa destino=cobro no bloquea: es una promoción de la casa, no dinero de nadie.';


-- ════════════════════════════════════════════════════════════════════════════
-- 15 · Los dos barridos de pg_cron
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ESTOS ENCOLAN; EL QUE ENVÍA ES EL JOB HTTP `/api/cron/notifications-send`,
-- cuya cadencia real medida es de 2-6 horas (la de GitHub Actions es una
-- ficción, CLAUDE.md). Por eso los avisos van a 7 días y a 1 día y no a 2
-- horas: «tu regalo caduca mañana» entregado ocho horas tarde sigue sirviendo.
--
-- ⚠️ REGLA DE ORO 11 · UN `pg_cron` QUE FALLA NO SE LO DICE A NADIE. Los dos
-- son DIARIOS, así que NO salen en «las diez últimas filas» de
-- `cron.job_run_details`: hay que AGREGAR. Después de aplicar, en dev y en prod
-- dos días después:
--
--   select j.jobname, d.status, count(*), max(d.start_time)
--     from cron.job_run_details d join cron.job j using (jobid)
--    where j.jobname in ('caducar-creditos','avisar-creditos-por-expirar')
--    group by 1, 2 order by 1, 2;
--
-- Y «arreglado» significa arreglado EN SU AMBIENTE: `close_expired_sessions()`
-- siguió cayendo en producción dos días después de existir la migración en dev.

create or replace function public.caducar_creditos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_r          record;
  v_caducados  int := 0;
  v_abandonados int := 0;
begin
  -- 1) Lo que estaba vivo y se pasó de fecha.
  --
  -- 🔴 EL `not exists` NO ES OPCIONAL. Un saldo parcial sigue en 'active'
  -- mientras financia un cobro abierto —ese es justo el caso «paga solo la
  -- diferencia»—: saldo de 20000 con 4500 aplicados a una reserva de 18000 que
  -- el alumno está pagando por tarjeta. Sin esta cláusula, el barrido de las
  -- 03:17 lo marca 'expired' con el cobro abierto, el alumno paga los 13500 y
  -- la plataforma acaba financiando 4500 contra un crédito que formalmente ya
  -- no existía — y mandando a operaciones a fondearlo.
  for v_r in
    with caducados as (
      update public.credits c
         set status = 'expired'
       where c.status = 'active'
         and c.expires_at is not null
         and c.expires_at < now()
         and not exists (
               select 1 from public.payments p
                where p.credit_id = c.id and p.status = 'pending')
      returning c.id, c.source, c.beneficiary_id, c.purchased_by, c.product_id,
                c.amount, c.currency, c.expires_at
    )
    select * from caducados
  loop
    v_caducados := v_caducados + 1;

    if v_r.source = 'gift' then
      -- El dinero se queda en la plataforma: el cargo ya se liquidó y `credits`
      -- no tiene camino automático de vuelta. Devolverlo es política comercial
      -- —no está en el diagrama— y se hace a mano con status='refunded'.
      perform public.enqueue_notification(
        v_r.purchased_by, 'NTF-37', 'email', 'gift_expired',
        jsonb_build_object('credit_id', v_r.id, 'product_id', v_r.product_id,
                           'amount', v_r.amount, 'currency', v_r.currency),
        'CRED:expired:buy:' || v_r.id);
      perform public.enqueue_notification(
        v_r.beneficiary_id, 'NTF-37', 'email', 'gift_expired',
        jsonb_build_object('credit_id', v_r.id, 'product_id', v_r.product_id),
        'CRED:expired:recv:' || v_r.id);
    else
      perform public.enqueue_notification(
        v_r.beneficiary_id, 'NTF-33', 'email', 'reward_expired',
        jsonb_build_object('credit_id', v_r.id, 'amount', v_r.amount,
                           'currency', v_r.currency),
        'CRED:expired:' || v_r.id);
    end if;
  end loop;

  -- 2) El regalo que nadie llegó a pagar. `comprar_regalo` le pone 30 días de
  -- caducidad provisional justo para esto: sin reserva que caducar,
  -- `expire_stale_bookings` no tiene nada que hacer aquí y la fila se quedaría
  -- en 'pending_payment' para siempre. No se avisa a nadie: no hubo dinero.
  update public.credits
     set status = 'revoked'
   where status = 'pending_payment'
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_abandonados = row_count;

  return jsonb_build_object('expired', v_caducados, 'abandoned', v_abandonados);
end;
$fn$;

comment on function public.caducar_creditos() is
  'Barrido diario: marca expired los créditos vencidos y revoked los regalos que nadie pagó. NO caduca un crédito que está financiando un cobro todavía abierto (payments.status = pending): ese es el saldo parcial del «paga solo la diferencia», y matarlo a medias haría que la plataforma financiara un premio que formalmente ya no existe.';

revoke execute on function public.caducar_creditos() from public;
revoke execute on function public.caducar_creditos() from anon;
revoke execute on function public.caducar_creditos() from authenticated;
grant  execute on function public.caducar_creditos() to service_role;


create or replace function public.avisar_creditos_por_expirar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_r record;
  v_n int := 0;
begin
  for v_r in
    select c.id, c.source, c.kind, c.beneficiary_id, c.purchased_by, c.product_id,
           c.amount, c.consumed_amount, c.currency, c.expires_at,
           case when c.expires_at <= now() + interval '1 day' then 1 else 7 end as dias
      from public.credits c
     where c.status = 'active'
       and c.expires_at is not null
       and c.expires_at > now()
       and c.expires_at <= now() + interval '7 days'
  loop
    -- Dos avisos como mucho por crédito: la clave lleva el tramo, así que la
    -- pasada de mañana sobre el mismo crédito no reencola el de 7 días.
    if v_r.source = 'gift' then
      perform public.enqueue_notification(
        coalesce(v_r.beneficiary_id, v_r.purchased_by),
        'NTF-36', 'email', 'gift_expiring',
        jsonb_build_object('credit_id', v_r.id, 'product_id', v_r.product_id,
                           'expires_at', v_r.expires_at, 'dias', v_r.dias),
        'CRED:exp' || v_r.dias || ':' || v_r.id);
    else
      perform public.enqueue_notification(
        v_r.beneficiary_id, 'NTF-32', 'email', 'reward_expiring',
        jsonb_build_object('credit_id', v_r.id, 'kind', v_r.kind,
                           'restante', v_r.amount - v_r.consumed_amount,
                           'currency', v_r.currency,
                           'expires_at', v_r.expires_at, 'dias', v_r.dias),
        'CRED:exp' || v_r.dias || ':' || v_r.id);
    end if;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('avisados', v_n);
end;
$fn$;

comment on function public.avisar_creditos_por_expirar() is
  'Avisa a 7 días y a 1 día de que un crédito caduca. La clave lleva el tramo (CRED:exp7 / CRED:exp1), así que son dos correos como mucho por crédito por muchas pasadas que haya. Un regalo sin reclamar se lo avisa a quien lo pagó, que es el único a quien se puede escribir.';

revoke execute on function public.avisar_creditos_por_expirar() from public;
revoke execute on function public.avisar_creditos_por_expirar() from anon;
revoke execute on function public.avisar_creditos_por_expirar() from authenticated;
grant  execute on function public.avisar_creditos_por_expirar() to service_role;


-- ── El reloj ────────────────────────────────────────────────────────────────
--
-- `unschedule` + `schedule` y no un `update` a `cron.job`: es el patrón de la
-- casa (`20260716170000:225-226`, `20260911210000:400`), y el `where exists` lo
-- hace idempotente sobre una base que todavía no tenga el job.
--
-- Diarios y a horas raras a propósito: no hay ninguna prisa —la caducidad es de
-- 30 o 90 días— y así no compiten con los barridos de cada minuto.
select cron.unschedule('caducar-creditos')
 where exists (select 1 from cron.job where jobname = 'caducar-creditos');
select cron.schedule(
  'caducar-creditos',
  '17 3 * * *',
  $cron$ select public.caducar_creditos() $cron$
);

select cron.unschedule('avisar-creditos-por-expirar')
 where exists (select 1 from cron.job where jobname = 'avisar-creditos-por-expirar');
select cron.schedule(
  'avisar-creditos-por-expirar',
  '23 9 * * *',
  $cron$ select public.avisar_creditos_por_expirar() $cron$
);


-- ════════════════════════════════════════════════════════════════════════════
-- 15 bis · LAS DOS FK A `credits`, QUE NO PONÍA NADIE
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 SE PISABAN LAS DOS MIGRACIONES Y GANABA EL SUELO. `20260912100000` crea
-- `payments.credit_id` y `payout_adjustments.credit_id` SIN clave ajena, porque
-- cuando se aplica `public.credits` todavía no existe, y deja un bloque
-- condicional al final (`:1128-1152`) que solo actúa
-- `if to_regclass('public.credits') is not null`. Aplicándose ANTES —que es el
-- único orden que funciona— eso es FALSE: `raise notice` y nada más. Su propia
-- cabecera lo dice en rojo: «la migración que cree public.credits tiene que
-- reponer las dos FK». Es ésta, y hasta hoy no las reponía.
--
-- Sin ellas, `credit_id` es un uuid suelto: nadie impide borrar un crédito que
-- financia un cobro vivo, y PostgREST NO TIENE RELACIÓN que seguir, o sea que
-- cualquier embed `payments → credits` o `payout_adjustments → credits` del
-- frontend falla. Es el territorio de la regla de oro 10 pero al revés: allí el
-- problema es que hay DOS caminos y la consulta es ambigua; aquí no hay ninguno.
--
-- `on delete restrict` en las dos, no `cascade`: hay rastro financiero detrás y
-- borrar el crédito de un cobro ya hecho tiene que reventar a gritos. Los
-- nombres son EXACTAMENTE los que PostgreSQL generaría solo y los que busca el
-- bloque condicional del otro lado, para que las dos órdenes de aplicación
-- —y una reaplicación— casen sin duplicar nada.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_credit_id_fkey') then
    alter table public.payments
      add constraint payments_credit_id_fkey
      foreign key (credit_id) references public.credits (id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payout_adjustments_credit_id_fkey') then
    alter table public.payout_adjustments
      add constraint payout_adjustments_credit_id_fkey
      foreign key (credit_id) references public.credits (id) on delete restrict;
  end if;
end
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 16 · Autocomprobaciones — porque `create or replace` valida la sintaxis, NO
--      ejecuta el cuerpo (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- El patrón de `20260903210000`, `20260907120000` y `20260911210000`: se ejecuta
-- de verdad lo que se acaba de escribir, se comprueba el resultado y se sale
-- por una excepción para que NADA de esto quede escrito.
do $comprobacion$
declare
  v_r      jsonb;
  v_cred   uuid;
  v_dueno  uuid;
  v_camp   int;
  v_n      int;
  -- El ensayo de los caminos de dinero (bloque 5). Piezas de mentira sobre
  -- filas reales; todo se va por `ensayo-ok`.
  v_prod   uuid;
  v_tut    uuid;
  v_est    uuid;
  v_cur    char(3);
  v_bk     uuid;
  v_pagoid uuid;
  v_cred_m uuid;    -- la recompensa 'mentoria': TOPE 1500
  v_cred_s uuid;    -- la recompensa 'saldo': 4500
  v_j      jsonb;
  v_b      bigint;
  v_t      text;
begin
  begin
    -- 1) Los dos barridos corren. Es lo único que `db:push` no comprobaría solo,
    --    y es exactamente el fallo que tuvo 12.446 corridas seguidas en rojo sin
    --    que nadie se enterara.
    v_r := public.caducar_creditos();
    if v_r is null then raise exception 'caducar_creditos() no devolvió nada'; end if;
    v_r := public.avisar_creditos_por_expirar();
    if v_r is null then raise exception 'avisar_creditos_por_expirar() no devolvió nada'; end if;

    -- 2) La aritmética del canje, con números y sin tocar ninguna tabla.
    --    a) Saldo: cubre lo que queda, hasta el bruto.
    v_r := public.credito_aplicable('saldo','referral', 5000, 1000, 'USD', null,
                                    18000, 1, 'USD', null);
    if (v_r ->> 'cubre')::bigint <> 4000 or not (v_r ->> 'usable')::boolean then
      raise exception 'saldo parcial mal calculado: %', v_r;
    end if;

    --    b) Saldo mayor que el total: cubre el total, no más.
    v_r := public.credito_aplicable('saldo','referral', 50000, 0, 'USD', null,
                                    18000, 1, 'USD', null);
    if (v_r ->> 'cubre')::bigint <> 18000 then
      raise exception 'un saldo mayor que el total tiene que cubrir solo el total: %', v_r;
    end if;

    --    c) Moneda distinta: se DEVUELVE, con motivo, y no usable.
    v_r := public.credito_aplicable('saldo','referral', 5000, 0, 'USD', null,
                                    18000, 1, 'COP', null);
    if (v_r ->> 'usable')::boolean or v_r ->> 'motivo' is null then
      raise exception 'la moneda distinta tiene que salir con motivo: %', v_r;
    end if;

    --    d) Mentoría gratis por debajo del tope: USABLE. Éste es el caso que el
    --       `check` credits_mentoria_entera hacía imposible.
    v_r := public.credito_aplicable('mentoria','referral', 1500, 0, 'USD', null,
                                    1200, 1, 'USD', null);
    if not (v_r ->> 'usable')::boolean or (v_r ->> 'cubre')::bigint <> 1200 then
      raise exception 'la mentoría gratis por debajo del tope tiene que valer: %', v_r;
    end if;

    --    e) Mentoría gratis por encima del tope: no usable, con su motivo.
    v_r := public.credito_aplicable('mentoria','referral', 1000, 0, 'USD', null,
                                    1200, 1, 'USD', null);
    if (v_r ->> 'usable')::boolean then
      raise exception 'la mentoría gratis por encima del tope no puede valer: %', v_r;
    end if;

    --    f) El paquete: los N tramos suman EXACTAMENTE el bruto, sin céntimo
    --       colgando. 10000 en 3 → 3334 + 3333 + 3333.
    v_r := public.credito_aplicable('mentoria','referral', 9999999, 0, 'USD', null,
                                    10000, 3, 'USD', null);
    if (v_r ->> 'cubre')::bigint <> 3334 then
      raise exception 'el reparto del paquete deja céntimos colgando: %', v_r;
    end if;

    -- 3) El `check` que hacía inusable la mentoría gratis sigue puesto, y la
    --    forma de usarlo (consumir el tope entero) pasa. Se prueba con una fila
    --    de mentira sobre una campaña real, si la hay.
    select rf_campaign_id into v_camp from public.referral_campaigns order by rf_campaign_id limit 1;
    select id into v_dueno from public.profiles limit 1;

    if v_camp is not null and v_dueno is not null then
      insert into public.credits (beneficiary_id, source, kind, destino, status,
                                  amount, currency, referral_campaign_id,
                                  referred_profile_id, expires_at, issued_at)
      values (v_dueno, 'referral', 'mentoria', 'cobro', 'active', 1500, 'USD',
              v_camp, v_dueno, now() + interval '30 days', now())
      returning id into v_cred;

      -- Consumir el TOPE entero: legal.
      update public.credits set consumed_amount = 1500, status = 'consumed' where id = v_cred;

      -- Consumir una parte: ILEGAL, y tiene que reventar. Si esto NO revienta,
      -- la constraint se ha caído y la mentoría gratis vuelve a ser un 500 en
      -- la pantalla de pago para el alumno.
      begin
        update public.credits set consumed_amount = 1200 where id = v_cred;
        raise exception 'credits_mentoria_entera no está frenando el consumo parcial';
      exception when check_violation then
        null;   -- correcto
      end;

      -- Y la idempotencia de la recompensa: el mismo trío no entra dos veces.
      begin
        insert into public.credits (beneficiary_id, source, kind, destino, status,
                                    amount, currency, referral_campaign_id,
                                    referred_profile_id, expires_at, issued_at)
        values (v_dueno, 'referral', 'mentoria', 'cobro', 'active', 1500, 'USD',
                v_camp, v_dueno, now() + interval '30 days', now());
        raise exception 'credits_recompensa_unica no está impidiendo la segunda emisión';
      exception when unique_violation then
        null;   -- correcto
      end;

      -- Y el `on conflict … where` que infiere ese índice parcial compila y
      -- corre de verdad: es la línea que levantaba «constraint does not exist».
      insert into public.credits (beneficiary_id, source, kind, destino, status,
                                  amount, currency, referral_campaign_id,
                                  referred_profile_id, expires_at, issued_at)
      values (v_dueno, 'referral', 'mentoria', 'cobro', 'active', 1500, 'USD',
              v_camp, v_dueno, now() + interval '30 days', now())
      on conflict (beneficiary_id, referral_campaign_id, referred_profile_id)
        where source = 'referral'
          and beneficiary_id is not null
          and referral_campaign_id is not null
          and referred_profile_id is not null
      do nothing;
    else
      raise notice 'sin campañas o sin perfiles: el ensayo de credits se salta (producción está vacía).';
    end if;

    -- 4) Las dos vistas responden y heredan la RLS (aquí corremos como el dueño,
    --    así que auth.uid() es null y tienen que salir vacías, no fallar).
    select count(*) into v_n from public.mis_creditos;
    select count(*) into v_n from public.mis_regalos_comprados;

    -- ════════════════════════════════════════════════════════════════════════
    -- 5) LOS CAMINOS DEL DINERO, EJECUTADOS DE VERDAD
    -- ════════════════════════════════════════════════════════════════════════
    --
    -- 🔴 POR QUÉ ESTE BLOQUE EXISTE. Lo de arriba es bueno y no habría cazado el
    -- peor fallo de esta tanda: `refund_payment` reventaba con `check_violation`
    -- en TODO reembolso de una mentoría gratis cuyo precio no fuera EXACTAMENTE
    -- el tope —o sea siempre—, y `db push` salía en verde porque
    -- `create or replace` VALIDA LA SINTAXIS, NO EJECUTA EL CUERPO (regla de
    -- oro 11). Un ensayo con un pago de mentira lo habría cazado en el propio
    -- push. Aquí se ejercitan las cinco funciones donde estaban los fallos:
    -- `aplicar_credito`, `quitar_credito`, `creditos_disponibles`,
    -- `reembolsar_con_credito` (por dentro de las otras dos) y `refund_payment`.
    --
    -- ⚠️ SE NECESITA UNA SESIÓN. `aplicar_credito` y compañía leen `auth.uid()`,
    -- que sale de `request.jwt.claims`; aquí se pone con `set_config(…, true)`
    -- —local a la transacción— y se limpia al final. Es la única forma de
    -- ejecutar de verdad una RPC de `authenticated` desde una migración.
    select p.id, p.tutor_id, p.currency
      into v_prod, v_tut, v_cur
      from public.products p
     where p.status = 'active'
     order by p.created_at
     limit 1;

    select pr.id into v_est
      from public.profiles pr
     where pr.id is distinct from v_tut
       and pr.id is distinct from v_dueno
       and not exists (select 1 from public.account_deletion_requests r
                        where r.user_id = pr.id
                          and r.status = 'pending'::public.account_deletion_request_status)
     order by pr.created_at
     limit 1;

    if v_camp is null or v_prod is null or v_est is null then
      raise notice 'sin producto activo, sin campaña o sin un segundo perfil: el ensayo de dinero se salta (producción está vacía).';
    else
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_est)::text, true);

      -- ── 5.a · LA MENTORÍA GRATIS: tope 1500 sobre una mentoría de 1200 ────
      -- Exactamente los números del fallo. Split 80/20: neto 960, fee 240.
      insert into public.bookings (
        student_id, product_id, tutor_id, status, pricing_model, num_sessions,
        session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct
      ) values (
        v_est, v_prod, v_tut, 'pending_payment', 'per_session', 1,
        60, v_cur, 1200, 1200, 80
      ) returning id into v_bk;

      insert into public.payments (
        booking_id, status, currency, gross_amount, platform_fee_amount,
        tutor_net_amount, tier_split_pct, provider
      ) values (
        v_bk, 'pending', v_cur, 1200, 240, 960, 80, 'simulated'
      ) returning id into v_pagoid;

      -- Nace CADUCADA para probar B7 antes de revivirla.
      insert into public.credits (
        beneficiary_id, source, kind, destino, status, amount, currency,
        referral_campaign_id, referred_profile_id, expires_at, issued_at
      ) values (
        v_est, 'referral', 'mentoria', 'cobro', 'active', 1500, v_cur,
        v_camp, v_tut, now() - interval '1 minute', now()
      ) returning id into v_cred_m;

      -- B7 · vencido a las 00:01 y el barrido pasa a las 03:17: entre medias NO
      -- se puede gastar, y el selector tiene que decir por qué.
      select c.motivo into v_t
        from public.creditos_disponibles(v_bk) c
       where c.credit_id = v_cred_m;
      if v_t is distinct from 'este crédito ha caducado' then
        raise exception 'creditos_disponibles no marca el crédito caducado: %', coalesce(v_t, '<null>');
      end if;

      begin
        perform public.aplicar_credito(v_bk, v_cred_m);
        raise exception 'aplicar_credito gastó un crédito CADUCADO';
      exception when no_data_found then
        null;   -- correcto
      end;

      update public.credits set expires_at = now() + interval '30 days'
       where id = v_cred_m;

      -- El canje. `credit_amount` es lo que cubre (1200) y el crédito consume el
      -- TOPE entero (1500): son dos números distintos a propósito, y esa
      -- distinción es la que rompía el reembolso.
      v_j := public.aplicar_credito(v_bk, v_cred_m);
      if (v_j ->> 'credit_amount')::bigint <> 1200 then
        raise exception 'aplicar_credito cubrió % y tenía que cubrir 1200: %',
          v_j ->> 'credit_amount', v_j;
      end if;
      -- B5 · el fondeo sale de `fondeo_del_cobro` y no de una suma de cajas: una
      -- recompensa no tiene caja detrás, así que la plataforma pone el neto
      -- entero (960), no 0.
      if (v_j ->> 'platform_funded_amount')::bigint <> 960 then
        raise exception 'el fondeo del cobro no cuadra (esperaba 960): %', v_j;
      end if;

      select c.consumed_amount, c.status into v_b, v_t
        from public.credits c where c.id = v_cred_m;
      if v_b <> 1500 or v_t <> 'consumed' then
        raise exception 'la mentoría gratis no consumió el tope entero: % / %', v_b, v_t;
      end if;

      -- Equivocarse de crédito no quema el premio: `quitar_credito` lo devuelve
      -- ENTERO (el tope, no lo que cubrió) y deja el pago limpio. Por dentro es
      -- `liberar_credito_de_pago`, o sea la misma puerta de las tres automáticas.
      v_j := public.quitar_credito(v_bk);
      if (v_j ->> 'devuelto')::bigint <> 1200 then
        raise exception 'quitar_credito devolvió % y el crédito ponía 1200: %',
          v_j ->> 'devuelto', v_j;
      end if;
      select c.consumed_amount, c.status into v_b, v_t
        from public.credits c where c.id = v_cred_m;
      if v_b <> 0 or v_t <> 'active' then
        raise exception 'quitar_credito no devolvió el tope entero: % / %', v_b, v_t;
      end if;
      select coalesce(p.credit_amount, -1) + coalesce(p.platform_funded_amount, -1)
        into v_b from public.payments p where p.id = v_pagoid;
      if v_b <> 0 then
        raise exception 'quitar_credito dejó el cobro con crédito o con fondeo dentro: %', v_b;
      end if;

      -- Y se vuelve a aplicar, que es lo que el alumno haría.
      v_j := public.aplicar_credito(v_bk, v_cred_m);

      -- S1 · EL CERROJO DEL COBRO ABIERTO, ejecutado. Con el marcador puesto por
      -- 0 (1200 − 1200), quitar el crédito dejaría al alumno pagando una Session
      -- vieja: tiene que abortar.
      perform public.marcar_cobro_abierto(array[v_bk]);
      begin
        perform public.quitar_credito(v_bk);
        raise exception 'el cerrojo del cobro abierto NO frenó a quitar_credito';
      exception when check_violation then
        null;   -- correcto
      end;

      -- Y la profundidad: aunque alguien llegara al webhook, el importe no cuadra
      -- y no se marca `paid`.
      begin
        perform public.confirm_payment(v_bk, true, null, 999::bigint);
        raise exception 'confirm_payment NO concilió el importe cobrado';
      exception when check_violation then
        null;   -- correcto
      end;

      -- El canje al 100 %: se marca pagada sin abrir un cargo de 0 en ninguna
      -- pasarela (y su conciliación, con 0 cobrado, cuadra).
      v_t := public.confirm_credit_booking(v_bk, v_est);
      if v_t not in ('confirmed', 'pending_acceptance') then
        raise exception 'confirm_credit_booking dejó la reserva en %', v_t;
      end if;

      -- 🔴 B1 · EL REEMBOLSO DEL ADMIN SOBRE UNA MENTORÍA GRATIS. Aquí es donde
      -- la versión anterior moría: `1500 − 1200 = 300` contra
      -- `credits_mentoria_entera`, que solo admite 0 o 1500.
      insert into public.user_roles (user_id, role)
      values (v_est, 'admin') on conflict do nothing;

      v_j := public.refund_payment(v_pagoid, null);
      if (v_j ->> 'refunded_cash')::bigint <> 0
         or (v_j ->> 'credit_returned')::bigint <> 1200 then
        raise exception 'el reembolso de un canje 100 %% crédito no se repartió bien: %', v_j;
      end if;

      select c.consumed_amount, c.status into v_b, v_t
        from public.credits c where c.id = v_cred_m;
      if v_b <> 0 or v_t <> 'active' then
        raise exception 'la mentoría gratis no volvió entera: % / %', v_b, v_t;
      end if;

      -- Y no se le pidió un céntimo a la pasarela: por ahí no entró nada.
      if exists (select 1 from public.refund_requests rr where rr.payment_id = v_pagoid) then
        raise exception 'se encoló un reembolso contra la pasarela de un cobro que no pasó por ella';
      end if;

      -- ── 5.b · EL SALDO: 4500 sobre 18000, y dos reembolsos parciales ──────
      -- Prueba la fórmula ACUMULADA: los dos tramos en efectivo tienen que sumar
      -- EXACTAMENTE los 13500 que cobró la pasarela, ni uno más.
      insert into public.bookings (
        student_id, product_id, tutor_id, status, pricing_model, num_sessions,
        session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct
      ) values (
        v_est, v_prod, v_tut, 'pending_payment', 'per_session', 1,
        60, v_cur, 18000, 18000, 80
      ) returning id into v_bk;

      insert into public.payments (
        booking_id, status, currency, gross_amount, platform_fee_amount,
        tutor_net_amount, tier_split_pct, provider
      ) values (
        v_bk, 'pending', v_cur, 18000, 3600, 14400, 80, 'stripe'
      ) returning id into v_pagoid;

      insert into public.credits (
        beneficiary_id, source, kind, destino, status, amount, currency,
        referral_campaign_id, referred_profile_id, expires_at, issued_at
      ) values (
        v_est, 'referral', 'saldo', 'cobro', 'active', 4500, v_cur,
        v_camp, v_est, now() + interval '30 days', now()
      ) returning id into v_cred_s;

      v_j := public.aplicar_credito(v_bk, v_cred_s);
      if (v_j ->> 'credit_amount')::bigint <> 4500
         or (v_j ->> 'a_pagar')::bigint <> 13500 then
        raise exception 'el «paga solo la diferencia» no cuadra: %', v_j;
      end if;
      -- Caja 13500 contra un neto de 14400: la plataforma pone 900.
      if (v_j ->> 'platform_funded_amount')::bigint <> 900 then
        raise exception 'el fondeo del mixto no cuadra (esperaba 900): %', v_j;
      end if;

      -- Se paga por la pasarela (13500) y el admin devuelve la mitad del PRECIO.
      update public.payments set status = 'paid', paid_at = now() where id = v_pagoid;

      v_j := public.refund_payment(v_pagoid, 9000::bigint);
      if (v_j ->> 'refunded_cash')::bigint <> 6750
         or (v_j ->> 'credit_returned')::bigint <> 2250 then
        raise exception 'el reparto del primer tramo no cuadra (esperaba 6750/2250): %', v_j;
      end if;
      select c.consumed_amount, c.status into v_b, v_t
        from public.credits c where c.id = v_cred_s;
      if v_b <> 2250 or v_t <> 'active' then
        raise exception 'el saldo no volvió a medias: % / %', v_b, v_t;
      end if;

      v_j := public.refund_payment(v_pagoid, 9000::bigint);
      if (v_j ->> 'refunded_cash')::bigint <> 6750 then
        raise exception 'el segundo tramo deriva (esperaba otros 6750): %', v_j;
      end if;

      select coalesce(sum(rr.amount), 0) into v_b
        from public.refund_requests rr where rr.payment_id = v_pagoid;
      if v_b <> 13500 then
        raise exception 'la suma de los tramos en efectivo es % y la pasarela cobró 13500', v_b;
      end if;

      select c.consumed_amount into v_b from public.credits c where c.id = v_cred_s;
      if v_b <> 0 then
        raise exception 'el saldo no volvió entero tras los dos tramos: %', v_b;
      end if;

      perform set_config('request.jwt.claims', '', true);
    end if;

    -- Sale por excepción a propósito: es lo que revierte las filas del ensayo y
    -- cualquier aviso que los barridos hayan encolado sobre datos reales.
    raise exception 'ensayo-ok';
  exception when others then
    if sqlerrm <> 'ensayo-ok' then
      raise;
    end if;
  end;

  raise notice 'Créditos: los dos barridos corren, la aritmética del canje cuadra, credits_mentoria_entera frena el consumo parcial, el índice parcial se infiere, y los caminos del dinero (aplicar/quitar/conciliar/reembolsar, incluido refund_payment sobre una mentoría gratis) se han ejecutado de verdad.';
end $comprobacion$;
