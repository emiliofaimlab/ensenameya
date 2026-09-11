-- ============================================================================
-- Enséñame Ya — el fondeo sabe quién pone el dinero
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Viene el crédito (recompensa de referido y regalo). Un cobro va a poder tener
-- DOS orígenes: lo que entró por la pasarela y lo que puso un crédito. La
-- contabilidad de hoy no sabe distinguirlos y eso rompe tres cosas que hoy
-- funcionan:
--
--   1) `build_payout_for_tutor` agrupa por `p.provider` y suma
--      `p.tutor_net_amount` (versión viva, medida con `pg_get_functiondef`).
--      Si el 40 % de un cobro lo puso un crédito, la orden le pide a ese PSP más
--      de lo que entró en su balance, y
--      `src/app/api/cron/payouts-process/route.ts:437` la deja pasar porque
--      `funding_provider` coincide. El fallo llega como un pago rechazado por
--      saldo, en producción, dos semanas después. Nadie lo ve venir.
--
--   2) Los tres caminos de reembolso devuelven `gross_amount` a una tarjeta que
--      solo cobró `gross − credit_amount`:
--        · `cancel_booking`            → `20260817170000_x01_reembolsos_reales.sql:360`
--        · `expire_stale_bookings`     → `20260826120000_b1_hold_siete_minutos.sql:146`
--        · `refund_payment`            → `20260902160000_candados_del_dinero.sql:654`
--      Con una reserva de 180 pagada con 45 de crédito y 135 de tarjeta, una
--      cancelación al 50 % encola 90 contra un cargo de 135: el PSP lo acepta y
--      salen 22,5 de más, sin que nada lo registre. Al 100 % encola 180 contra
--      135: el PSP lo rechaza, la cola lo reintenta para siempre y
--      `payments.status` ya dice `refunded`.
--
--   3) `refund_payment` borra el payout cuando se queda sin líneas
--      (`20260902160000:673-676`). Con la recompensa del tutor viajando en ese
--      mismo payout, el reembolso de un alumno se llevaría por delante el premio
--      de un tutor que no tiene nada que ver. Y el `update … set amount = amount −
--      item_amount` de la línea 669 no toca el fondeo, así que la orden
--      superviviente le sigue pidiendo a operaciones dinero que ya no debe.
--
-- Esta migración NO añade funcionalidad. Deja la contabilidad preparada y
-- arregla lo que ya está mal. **Todas las columnas nuevas nacen en 0 / null, y
-- hoy no hay ni un crédito en la base** (`to_regclass('public.credits')` es
-- null al escribir esto), así que el comportamiento observable no cambia:
-- `run_payout_batch` tiene que producir exactamente los mismos payouts de hoy,
-- con `platform_funded_amount = 0` en todos. La lista de comprobación que lo
-- verifica va al final de esta cabecera.
--
-- Manda `docs/DICTADO-PAGOS.md` en cobro y payout; el coste de cada tramo sigue
-- en `docs/PAGOS-Y-PAYOUTS.md`.
--
-- ── LA REGLA, EN UNA FRASE ─────────────────────────────────────────────────
--   `payments.funding_provider`       = el PSP donde está la CAJA de este cobro.
--   `payments.platform_funded_amount` = lo que falta en esa caja para pagarle
--                                       al tutor, y que pone la plataforma.
-- `provider` no cambia de significado: sigue siendo QUIÉN PROCESÓ el cargo, que
-- es de lo que cuelgan el reembolso y `set_charge_provider`
-- (`20260910120000_el_cobro_lo_decide_el_alumno.sql:281`). Dos preguntas, dos
-- columnas — el mismo reparto que `payouts` ya hace entre `provider` (quién
-- ejecuta) y `funding_provider` (de qué balance).
--
-- ── LO QUE HAY QUE SABER (y muerde) ────────────────────────────────────────
--
-- ⚠️ 1 · ESTA MIGRACIÓN VA ANTES QUE `credits` Y NO PUEDE DEPENDER DE ELLA.
--    `public.credits` no existe todavía. Por eso `payments.credit_id` y
--    `payout_adjustments.credit_id` nacen SIN clave ajena, y por eso los dos
--    bloques que leen `credits` van dentro de un `if to_regclass(…) is not null`.
--    No es defensivo por gusto: la skill `nueva-migracion` lo pide literalmente
--    («No escribas nada que dependa de ser la última»), porque el CI aplica con
--    `db push --include-all` y una migración con timestamp menor puede aterrizar
--    después. En PL/pgSQL una sentencia dentro de una rama que no se ejecuta
--    **no se prepara**, así que referirse a una tabla que aún no existe no
--    rompe nada — es el mismo hecho que la regla de oro 11 usa al revés
--    («`create or replace` valida la sintaxis, no ejecuta el cuerpo»).
--    🔴 LA MIGRACIÓN QUE CREE `public.credits` TIENE QUE REPONER LAS DOS FK:
--         alter table public.payments
--           add constraint payments_credit_id_fkey
--           foreign key (credit_id) references public.credits (id) on delete restrict;
--         alter table public.payout_adjustments
--           add constraint payout_adjustments_credit_id_fkey
--           foreign key (credit_id) references public.credits (id) on delete restrict;
--    (Si `credits` ya existiera al aplicar esto, el bloque 10 de este fichero
--    las pone solo y la otra migración se las encuentra hechas: los dos
--    órdenes valen.)
--
-- ⚠️ 2 · EL TOPE DE `enqueue_refund` YA NO SE ESCRIBE AQUÍ (revisión cruzada).
--    Este fichero la reescribía para bajar el tope a `gross_amount −
--    credit_amount`, y `20260912110000` la reescribe OTRA VEZ con una versión
--    mejor: la suya añade el camino `provider_payment_id is null → skipped`,
--    que es H-1(c). Dos `create or replace` de la misma función en la misma
--    tanda es código muerto con dientes: si alguien revierte solo la segunda,
--    la que queda viva es la de aquí y vuelve la cola envenenada. Manda una
--    sola, y vive en `20260912110000` (§ `enqueue_refund`). Ver el bloque 6.
--    El aviso de fondo sigue en pie y es de los dos ficheros: el día que exista
--    `aplicar_credito`, los TRES llamadores tienen que repartir el tramo en
--    efectivo en el mismo PR. Si no, `cancel_booking` aborta la transacción del
--    alumno y —mucho peor— `expire_stale_bookings`, que corre por `pg_cron`
--    cada minuto, muere en cada pasada sin que nada se ponga en rojo: el error
--    se queda en `cron.job_run_details` (regla de oro 11).
--
-- ⚠️ 3 · LO QUE ESTA MIGRACIÓN DEJA A MEDIAS A PROPÓSITO, Y HAY QUE REMATAR:
--    · `src/app/api/cron/payouts-process/route.ts:474` coteja
--      `suma !== fila.amount`. Tiene que pasar a
--      `suma + (fila.adjustment_amount ?? 0) !== fila.amount`, y hay que añadir
--      `adjustment_amount, platform_funded_amount` a `COLUMNAS` (`:137`) y al
--      tipo. 🔴 ESTO ES TYPESCRIPT Y NO ENTRA EN NINGUNA MIGRACIÓN: sin él,
--      toda orden con recompensa se cuenta como descuadre, NO SE MANDA, y el
--      contador solo sale por `console.error` — la orden se queda 'scheduled'
--      para siempre y arrastra con ella las clases reales que lleve dentro
--      (B2 de la revisión cruzada). Va en el MISMO PR que esta migración.
--    · `create_booking_line` (`20260910120000:235`) todavía no escribe
--      `funding_provider`. No pasa nada: el agrupador de abajo usa
--      `coalesce(funding_provider, provider)` justamente para eso.
--    · `liberar_credito_de_pago` (`20260912110000`) no limpia `checkout_amount`
--      ni `checkout_opened_at` al soltar el crédito. Nada de ESTE fichero
--      depende de esa invariante —aquí no se lee ninguna de las dos columnas—,
--      pero es §5.2 de la revisión y lo cierra el otro fichero.
--
--    Lo que sí se remata AQUÍ, y que la primera versión dejaba fuera:
--    `payouts_backlog()` (§13), `run_payout_batch` (§11) y `tutor_balance`
--    (§12). Los tres miraban solo `payments` y con eso la recompensa del tutor
--    ni se emite, ni se ve, ni se paga.
--
-- ⚠️ 4 · EL BACKFILL BUMPEA `payments.updated_at` EN LAS 127 FILAS
--    (trigger `payments_set_updated_at`). No encola ni un correo: `notify_payment()`
--    solo actúa si cambia `status` o `refunded_amount`. Y nadie ordena por
--    `payments.updated_at` (el que sí se usa para ordenar es `payouts.updated_at`,
--    en `payouts-process/route.ts:258`, y ese no se toca).
--
-- ── LOS HALLAZGOS QUE CIERRA ───────────────────────────────────────────────
--   H-1 / H-7 / S5 · nunca devolver a la tarjeta más de lo que la tarjeta cobró.
--   H-4            · una recompensa no crea órdenes que nadie puede ejecutar.
--   H-5 / S4       · un reembolso del alumno no borra el premio del tutor.
--   H-8            · el mixto de regalo no pide fondeo que ya está cobrado.
--   B-2            · `payouts_backlog()` deja de llamar descuadre a un ajuste.
--   B-3            · `run_payout_batch` y `tutor_balance` ven la recompensa.
--   S7             · `service_role` solo lee `payout_adjustments`.
--   S2 (parcial)   · `has_role` y `tutor_balance` dejan de tener EXECUTE PUBLIC.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `payments` — un cobro con dos orígenes
-- ════════════════════════════════════════════════════════════════════════════
--
-- `gross_amount` NO SE TOCA. Es el precio entero y lo sigue siendo: un crédito
-- no descuenta el precio, cambia QUIÉN lo financia. De esa distinción cuelgan
-- el split (`tier_split_pct`), el neto del tutor y el fee, que son snapshots
-- congelados en `create_booking_line` (`20260910120000:176-186`, donde
-- `v_fee = v_total − v_net`, o sea `fee + net = gross` exacto).

alter table public.payments
  add column if not exists credit_id              uuid,
  add column if not exists credit_amount          bigint not null default 0,
  add column if not exists funding_provider       text,
  add column if not exists platform_funded_amount bigint not null default 0;

-- Los `check` se declaran aparte y con nombre propio para poder citarlos cuando
-- revienten. Se validan contra las filas de hoy: con `credit_amount = 0` y
-- `min(gross_amount) = 1800` todas pasan.
alter table public.payments
  add constraint payments_credito_no_negativo        check (credit_amount >= 0),
  add constraint payments_fondeo_no_negativo         check (platform_funded_amount >= 0),
  add constraint payments_credito_acotado            check (credit_amount <= gross_amount),
  -- Un importe de crédito sin crédito detrás es dinero que apareció solo.
  add constraint payments_credito_con_dueno          check (
        (credit_amount = 0 and credit_id is null)
     or (credit_amount > 0 and credit_id is not null));

comment on column public.payments.credit_id is
  'El crédito que financia parte de este cobro, o null. Un pago usa COMO MUCHO '
  'un crédito, a propósito: dos créditos sobre una misma fila multiplican los '
  'orígenes de fondeo dentro de un solo `funding_provider` y la aritmética de '
  '`fondeo_del_cobro()` deja de tener respuesta. Nace SIN clave ajena porque '
  '`public.credits` todavía no existe cuando esta migración se aplica: la FK '
  '`payments_credit_id_fkey` la pone la migración que cree la tabla (o el '
  'bloque condicional 10 de ESTA, si ya existiera).';

comment on column public.payments.credit_amount is
  'Cuánto de este cobro lo pone un crédito, en unidades mínimas de `currency`. '
  '`gross_amount` NO baja: un crédito no descuenta el precio, cambia QUIÉN lo '
  'financia. La pasarela cobra `gross_amount - credit_amount`, y ese es también '
  'el techo de lo que se le puede devolver a la tarjeta (ver `enqueue_refund`).';

comment on column public.payments.funding_provider is
  'DÓNDE ESTÁ LA CAJA con la que se pagará al tutor. Normalmente igual a '
  '`provider`. Difiere cuando un REGALO ya cobrado por otro PSP cubre el neto '
  'del tutor. Es la clave de agrupación de `build_payout_for_tutor` desde esta '
  'migración; `provider` sigue significando quién PROCESÓ el cargo. Siempre es '
  'un riel REAL: nunca ''plataforma'', nunca ''credito'' — por eso la puerta del '
  'balance de `payouts-process/route.ts:437` sigue significando lo que significa '
  'y no hay que tocarla.';

comment on column public.payments.platform_funded_amount is
  'Cuánto del `tutor_net_amount` NO está respaldado por caja en el balance de '
  '`funding_provider` y tiene que poner la plataforma ANTES del ciclo. '
  'CONGELADO al aplicar el crédito, no derivado: el origen del crédito se sabe '
  'en ese momento y después ya no. Lo calcula `public.fondeo_del_cobro()`, que '
  'es la única aritmética válida — `aplicar_credito` tiene que LLAMARLA y no '
  'reimplementarla: la reimplementación evidente (sumar la caja del regalo y la '
  'del cargo) escribe 0 donde van 2000 y la orden se va a ''failed'' por saldo, '
  'que es B-5 de la revisión del 11-sep. Sale 0 cuando de verdad es 0: si `credit_amount <= '
  'platform_fee_amount` la recompensa se la come el margen y no hay nada que '
  'fondear, que es el caso más frecuente con un split del 80 %.';

-- Índice para los dos usos que tendrá: reencontrar el cobro desde el crédito
-- (reembolsos, reversión de regalo) y el guarda de `caducar_creditos()` que no
-- puede caducar un crédito con un cobro `pending` abierto detrás (H-10).
create index if not exists payments_credit_id_idx
  on public.payments (credit_id)
  where credit_id is not null;

-- Backfill. `provider` está poblado en las 127 filas de dev (medido), así que
-- esto deja `funding_provider = provider` en todas y la agrupación del payout
-- sale idéntica a la de hoy. Es idempotente: el `where` no asume datos.
update public.payments
   set funding_provider = provider
 where funding_provider is null
   and provider is not null;

-- ⚠️ NINGÚN GRANT NUEVO SOBRE `payments`, y es deliberado. Las escriben RPC
-- `security definer`, que corren como el dueño y se saltan los grants de tabla.
-- `service_role` ya tiene `select` sobre la tabla entera (`20260806170000:48`),
-- así que leer las columnas nuevas está cubierto; su `update` sigue siendo
-- exactamente `(provider_payment_id, provider_metadata)` (medido en
-- `pg_attribute.attacl`) y **no se amplía**: eso es lo que impide que un Route
-- Handler mueva un importe a mano (regla de oro 2).


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · `public.fondeo_del_cobro()` — la aritmética, en un solo sitio
-- ════════════════════════════════════════════════════════════════════════════
--
-- Existe para que `aplicar_credito` (que llega en otro PR) no la reimplemente.
-- Es pura: no toca ninguna tabla, es `immutable`, y por eso se puede probar con
-- un `select` suelto — que es justo lo que hace la lista de comprobación.
--
-- 🔑 UN PAYOUT SE EJECUTA CONTRA UN SOLO BALANCE. Esa es toda la idea. La caja
-- disponible para pagarle al tutor no es «la suma de lo que entró»: es lo que
-- hay en el balance de `funding_provider`, y nada más. De ahí salen las dos
-- respuestas:
--
--   caja_del_regalo = el regalo ya cobrado (0 si el crédito no es un regalo)
--   caja_del_cobro  = gross − credit           (el tramo que pasó por la pasarela)
--
--   si caja_del_regalo >= tutor_net  → se paga desde el PSP del regalo
--   si no                            → se paga desde el PSP que procesó el cargo
--   platform_funded = greatest(0, tutor_net − esa caja)
--
-- ── DÓNDE ME SEPARO DE H-8, Y POR QUÉ ──────────────────────────────────────
-- H-8 propone `v_caja := (gross − cubre) + (regalo ? credits.amount : 0)`, o sea
-- SUMAR las dos cajas. En su propio ejemplo (regalo 6000 por dLocal, precio
-- 7000, 1000 por Stripe, neto 5600) las dos fórmulas dan lo mismo: fondeo 0 y
-- `funding_provider = dlocal`. Pero la suya se rompe en el caso que no cubre:
-- regalo 6000 por dLocal y precio 20000 → neto 16000, Stripe tiene 14000.
-- Sumando cajas daría 20000 y fondeo 0; la verdad es que a Stripe —que es quien
-- va a pagar— le faltan 2000. Sumar dos balances que ningún payout puede tocar a
-- la vez es el mismo error que `20260901130000` arregló al dejar de agrupar solo
-- por moneda. Manda el hallazgo en el diagnóstico (la fila «mixto gift» de la
-- especificación está mal); la fórmula que se implementa es la de un balance.
--
-- ⚠️ SIN ARGUMENTOS POR DEFECTO, A PROPÓSITO. `supabase-js` no serializa las
-- claves `undefined`, y un argumento opcional es cómo `20260910190000` acabó
-- con dos sobrecargas y un `PGRST203` (regla de oro 12). Si algún día hace falta
-- un octavo parámetro: `drop function` + `create`, y reponer el `grant execute`.

create or replace function public.fondeo_del_cobro(
  p_gross_amount     bigint,   -- payments.gross_amount (el precio entero)
  p_tutor_net_amount bigint,   -- payments.tutor_net_amount (lo que cobra el tutor)
  p_credit_amount    bigint,   -- payments.credit_amount (lo que pone el crédito AQUÍ)
  p_provider_cobro   text,     -- payments.provider (quién procesó el cargo)
  p_credit_source    text,     -- credits.source: 'referral' | 'gift' | null
  p_credit_total     bigint,   -- credits.amount (lo que se cobró POR EL REGALO)
  p_credit_provider  text,     -- credits.provider (el PSP que cobró el regalo)
  out funding_provider       text,
  out caja                   bigint,
  out platform_funded_amount bigint
)
language plpgsql
immutable
set search_path = ''
as $function$
declare
  -- La caja del REGALO: dinero que ya entró, y que entró en el PSP del regalo.
  -- Para una recompensa de referido esto es 0 — no entró nada, lo regala la
  -- plataforma — y por eso `source` es la columna que decide el fondeo.
  v_caja_regalo bigint := case when p_credit_source = 'gift'
                               then coalesce(p_credit_total, 0)
                               else 0 end;
begin
  if v_caja_regalo >= p_tutor_net_amount and p_credit_provider is not null then
    -- El regalo cubre el neto del tutor por sí solo: la orden se ejecuta contra
    -- el balance donde está ese dinero, y el tramo que además pasara por la
    -- pasarela se queda como margen de la plataforma (fee + net = gross).
    funding_provider := p_credit_provider;
    caja             := v_caja_regalo;
  else
    funding_provider := p_provider_cobro;
    caja             := p_gross_amount - coalesce(p_credit_amount, 0);
  end if;

  platform_funded_amount := greatest(0, p_tutor_net_amount - caja);
end;
$function$;

comment on function public.fondeo_del_cobro(bigint, bigint, bigint, text, text, bigint, text) is
  'LA ÚNICA ARITMÉTICA DEL FONDEO, Y ESO NO ES UNA FIGURA RETÓRICA. Dado un '
  'cobro y el crédito que lo financia, devuelve de qué balance sale el payout, '
  'cuánto hay en ese balance y cuánto tiene que poner la plataforma. '
  '🔴 QUIEN APLIQUE UN CRÉDITO LA LLAMA Y ESCRIBE SUS TRES SALIDAS; no la '
  'reimplementa. La reimplementación evidente —sumar la caja del regalo y la '
  'del cargo— INFRA-FONDEA EL PAYOUT, porque una orden se ejecuta contra UN '
  'solo balance y no contra la suma de dos: regalo de 6000 cobrado por dLocal, '
  'precio 20000 por Stripe y neto 16000 da fondeo 2000 (esta función) o 0 (la '
  'suma), y en el segundo caso operaciones no transfiere nada, a Stripe le '
  'faltan 2000 y la orden se va a ''failed'' por saldo — el fallo «en '
  'producción, dos semanas después» que esta migración viene a evitar. Es B-5 '
  'de la revisión cruzada del 11-sep. Pura e immutable: se prueba con un '
  'select, y las SIETE filas de `ataque-dinero` están comprobadas en la lista '
  'de la cabecera. Sin crédito (p_credit_amount = 0, p_credit_source null) '
  'devuelve (provider, gross, 0), que es exactamente lo que vale hoy en las '
  '127 filas.';

-- Nadie la llama desde el navegador y `aplicar_credito` será `security definer`
-- (corre como el dueño, que ya tiene EXECUTE). `service_role` la recibe para
-- poder cotejarla desde un Route Handler o desde la lista de comprobación.
revoke execute on function public.fondeo_del_cobro(bigint, bigint, bigint, text, text, bigint, text) from public;
revoke execute on function public.fondeo_del_cobro(bigint, bigint, bigint, text, text, bigint, text) from anon;
revoke execute on function public.fondeo_del_cobro(bigint, bigint, bigint, text, text, bigint, text) from authenticated;
grant  execute on function public.fondeo_del_cobro(bigint, bigint, bigint, text, text, bigint, text) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · `payouts` — cuánto pone operaciones de su bolsillo
-- ════════════════════════════════════════════════════════════════════════════

alter table public.payouts
  add column if not exists platform_funded_amount bigint not null default 0,
  add column if not exists adjustment_amount      bigint not null default 0;

alter table public.payouts
  add constraint payouts_fondeo_no_negativo     check (platform_funded_amount >= 0),
  add constraint payouts_ajuste_no_negativo     check (adjustment_amount >= 0);

comment on column public.payouts.platform_funded_amount is
  'De `amount`, cuánto NO está en el balance de `funding_provider` y tiene que '
  'meter operaciones ANTES de ejecutar el ciclo. Es la suma de los '
  '`platform_funded_amount` de sus líneas más el `adjustment_amount` ENTERO — '
  'una recompensa no tiene caja detrás por definición: es dinero que la '
  'plataforma regala. Si esto es > 0 y nadie transfiere, la orden se va a '
  '''failed'' por saldo y el tutor no cobra. Se mira en `public.fondeo_del_ciclo`.';

comment on column public.payouts.adjustment_amount is
  'Recompensas de referido del tutor que viajan en esta orden (`payout_adjustments`). '
  '`amount = suma(payout_items) + adjustment_amount`: el cotejo de C2 '
  '(`src/app/api/cron/payouts-process/route.ts:470`) y el contador `descuadradas` '
  'de `payouts_backlog()` ya NO pueden comparar contra las líneas a secas. '
  'Mientras valga 0 —hoy, en las 28 órdenes de dev— el cotejo viejo sigue dando '
  'el mismo resultado, que es lo que hace que esta migración se pueda aplicar sola.';

-- Lo que agrupa la vista de operaciones. 28 filas hoy: el índice es para cuando
-- no lo sean. ⚠️ Cada literal lleva su cast al enum UNO A UNO y no como
-- `= any (array[…]::payout_status[])`: el predicado de un índice parcial tiene
-- que ser IMMUTABLE, y la entrada de un enum es STABLE — con el cast por
-- elemento el planificador pliega cada literal a una constante y el predicado
-- lo es; con el cast al array entero puede quedar una coerción y el
-- `create index` se cae con «functions in index predicate must be marked
-- IMMUTABLE».
create index if not exists payouts_fondeo_idx
  on public.payouts (funding_provider, currency)
  where status in ('pending'::public.payout_status,
                   'scheduled'::public.payout_status,
                   'on_hold'::public.payout_status);

-- Sin grants nuevos: `service_role` ya tiene `select on public.payouts`
-- (`20260901130000`) y su `update` por columnas no se amplía.


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · `public.payout_adjustments` — la recompensa en dinero del tutor
-- ════════════════════════════════════════════════════════════════════════════
--
-- El diagrama aprobado: a un TUTOR la recompensa en dinero «se le suma a su
-- próximo cobro y le llega solo». Esto es ese «se le suma». No es una línea de
-- `payout_items` porque no hay `payments` detrás: no hay clase, no hay alumno y
-- no hay split. Y es una tabla aparte, no una columna más de `payouts`, porque
-- `credit_id unique` es LA idempotencia: una recompensa no puede entrar en dos
-- ciclos, y eso una columna agregada no lo puede prometer.
--
-- ⚠️ NO ES UN PUENTE ENTRE DOS TABLAS QUE YA SE EMBEBEN (regla de oro 10).
-- Cuelga de `payouts` y de `credits`, que no tienen FK directa entre sí, así que
-- no vuelve ambiguo ningún embed existente. El puente que sí existe entre
-- `payouts` y `payments` sigue siendo `payout_items`, el único, y
-- `src/app/(app)/tutor/payouts/page.tsx:260` lo embebe sin tocar nada.

create table if not exists public.payout_adjustments (
  id         uuid        primary key default gen_random_uuid(),

  -- 🔴 `on delete restrict`, NO `cascade` (S-4 / H-5). Con `cascade`, el
  -- `delete from public.payouts` de `refund_payment` (`20260902160000:673`) se
  -- llevaba por delante la recompensa de un tutor porque un ALUMNO pidió un
  -- reembolso — sin excepción, sin log y sin build en rojo, o sea el fallo mudo
  -- de la regla de oro 11. Con `restrict` ese borrado revienta a gritos, y
  -- además `refund_payment` (más abajo) ya no intenta borrar una orden que
  -- lleve ajustes. Cinturón y tirantes, en ese orden.
  payout_id  uuid        not null references public.payouts (id) on delete restrict,

  -- La recompensa. `unique` es la idempotencia del lote: `build_payout_for_tutor`
  -- puede correr mil veces y este crédito entra en un ciclo y en uno solo.
  -- Sin FK todavía: ver el aviso 1 de la cabecera.
  credit_id  uuid        not null unique,

  amount     bigint      not null check (amount > 0),
  reason     text        not null default 'recompensa por referido',
  created_at timestamptz not null default now()
);

-- Sin `updated_at` ni su trigger, a propósito: esta tabla es de SOLO ANEXAR.
-- Una fila se escribe cuando la recompensa entra en un ciclo y no se vuelve a
-- tocar; si hay que deshacerla, se borra con su payout. Poner `updated_at` aquí
-- sugeriría que hay algo que actualizar, y no lo hay.
comment on table public.payout_adjustments is
  'Recompensas de referido en DINERO que viajan dentro de una orden de pago del '
  'tutor. Una fila por crédito, y `credit_id` es único: esa es la idempotencia '
  'de `build_payout_for_tutor`. Solo se anexa; no se actualiza.';
comment on column public.payout_adjustments.payout_id is
  'La orden en la que viaja. `on delete restrict` (S-4): sin él, el reembolso de '
  'un alumno borraba la orden y con ella la recompensa de un tutor ajeno.';
comment on column public.payout_adjustments.credit_id is
  'El `credits.id` de la recompensa. Único → una recompensa entra en UN ciclo. '
  'La FK a `public.credits` la declara la migración que cree esa tabla '
  '(`payout_adjustments_credit_id_fkey`); aquí no existe todavía.';
comment on column public.payout_adjustments.amount is
  'Unidades mínimas, en la moneda de `payouts.currency`. Es lo que se sumó a '
  '`payouts.amount` Y a `payouts.platform_funded_amount`: una recompensa no '
  'tiene caja detrás, la pone entera la plataforma.';

create index if not exists payout_adjustments_payout_idx
  on public.payout_adjustments (payout_id);

alter table public.payout_adjustments enable row level security;

-- El tutor ve los ajustes de SUS órdenes. No hay política de escritura, a
-- propósito y por el mismo razonamiento que deja a `user_roles` sin ellas
-- (RN-31/S-31): esto es dinero, y lo escribe `build_payout_for_tutor`, que es
-- `security definer`.
create policy "payout_adjustments_select_own"
  on public.payout_adjustments for select
  using ( exists (select 1
                    from public.payouts po
                   where po.id = payout_id
                     and po.tutor_id = (select auth.uid())) );

create policy "payout_adjustments_select_admin"
  on public.payout_adjustments for select
  using ( public.has_role('admin') );

-- Grants (auto-expose está OFF; regla de oro 9).
grant select on public.payout_adjustments to authenticated;
-- ⚠️ SOLO `select` PARA `service_role`, y esto es S-7. Todos los escritores de
-- esta tabla son `security definer` y corren como el dueño, así que no necesitan
-- el grant. Concederle `insert`/`update` no habilita nada que haga falta: lo
-- único que compra es que CUALQUIER Route Handler con `createAdminClient()`
-- pueda fabricar o mover una recompensa. Es la misma forma del agujero de
-- `profiles` que se tapó el 11-sep (`20260911140000`).
grant select on public.payout_adjustments to service_role;
-- `anon` no recibe nada.


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · `build_payout_for_tutor` — el lote aprende a sumar el fondeo y las recompensas
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se parte de la versión VIVA (`pg_get_functiondef`, no del fichero: hay tres
-- copias de esta función en `supabase/migrations/` y solo una está aplicada).
-- La firma NO cambia → `create or replace` y la regla de oro 12 no se dispara.
-- El ACL tampoco se toca: como no hay `drop`, los `grant execute` sobreviven.
--
-- Cambios, tres:
--   a) agrupa por `coalesce(funding_provider, provider)` — el `coalesce` es lo
--      que hace que un pago escrito antes de esta migración, o por un
--      `create_booking_line` que todavía no rellena la columna, caiga en el
--      mismo grupo de siempre;
--   b) arrastra `sum(platform_funded_amount)` a la orden;
--   c) un SEGUNDO bucle que mete las recompensas del tutor.

create or replace function public.build_payout_for_tutor(
  p_tutor_id       uuid,
  p_retention_days integer,
  p_status         public.payout_status default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
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
           sum(p.tutor_net_amount)                  as total,
           sum(p.platform_funded_amount)            as falta,
           array_agg(p.id)                          as payment_ids
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where b.tutor_id = p_tutor_id
      and p.status = 'paid'                       -- reembolsados fuera (S-29)
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
    select v_payout, pid, p.tutor_net_amount
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

comment on function public.build_payout_for_tutor(uuid, integer, public.payout_status) is
  'Construye las órdenes de pago de un tutor. Agrupa por (moneda, '
  'funding_provider, payee_country) —lo que tiene que ser igual para que la '
  'orden sea pagable— y arrastra el fondeo de cada línea. Segundo bucle: mete '
  'las recompensas en dinero (`credits` con destino=''payout'') como '
  '`payout_adjustments`, prefiriendo engancharlas a una orden existente y sin '
  'crear jamás una orden sin `funding_provider` o sin `payee_country` (H-4).';


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · `enqueue_refund` — POR QUÉ AQUÍ NO HAY CÓDIGO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Este bloque reescribía `enqueue_refund` para bajar el tope duro de
-- `gross_amount` a `gross_amount − credit_amount`: la pasarela no puede
-- devolver lo que nunca cobró (H-1 / H-7). La reescritura sigue siendo
-- necesaria y sigue existiendo — pero **una sola vez, y en la migración
-- siguiente**.
--
-- 🔴 DÓNDE VIVE LA BUENA: `20260912110000_los_creditos_y_los_regalos.sql`,
--    bloque de `enqueue_refund`. Lleva lo mismo que llevaba esta MÁS el camino
--    que aquí faltaba: `provider_payment_id is null → 'skipped'`, que es
--    H-1(c). Sin él, una reserva pagada al 100 % con crédito —o cualquier cobro
--    sin identificador en el PSP— dejaba una fila 'pending' que el job
--    reintentaba contra Stripe para siempre.
--
-- ── POR QUÉ SE QUITA DE AQUÍ EN VEZ DE DEJARLA COMO «REDUNDANTE» ───────────
-- Dos `create or replace` de la misma función en la misma tanda no son una
-- redundancia inofensiva: son DOS VERSIONES VIVAS con un orden. Mientras las
-- dos se apliquen, gana la segunda y no pasa nada. El día que alguien revierta
-- solo `20260912110000` —que es exactamente lo que se hace cuando algo del
-- regalo sale mal— la que queda en pie es esta, y con ella vuelve la cola
-- envenenada que H-1(c) cerró: reembolsos 'pending' contra pagos que no
-- existen en ningún PSP, reintentados en cada pasada. Código muerto que se
-- reanima. Lo levanta la revisión cruzada del 11-sep («`enqueue_refund` se
-- reescribe dos veces»), y la llama menor porque «no rompe nada» — hoy. Lo que
-- la hace merecer un borrado y no una nota es el «hoy».
--
-- ⚠️ EL AVISO DE FONDO NO SE VA CON EL CÓDIGO, y es de los dos ficheros: el
-- tope tiene DIENTES. Hoy `credit_amount` es 0 en las 127 filas y el tope nuevo
-- es idéntico al de siempre; el día que exista `aplicar_credito`, los TRES
-- llamadores de `enqueue_refund` tienen que repartir el tramo en efectivo en el
-- MISMO PR. Si no, `cancel_booking` aborta la transacción del alumno y —mucho
-- peor— `expire_stale_bookings`, que corre por `pg_cron` cada minuto, muere en
-- cada pasada sin que nada se ponga en rojo: el error se queda en
-- `cron.job_run_details` (regla de oro 11). `refund_payment` va arreglada en el
-- bloque 7 de aquí; los otros dos, en `20260912110000`.
--
-- ⚠️ Y LA CLAVE DE IDEMPOTENCIA NO SE VERSIONA, que es la respuesta a S-5 y
-- sobrevive a este borrado porque `refund_payment` (bloque 7) la sigue
-- construyendo igual. Los TRES caminos comparten el espacio
-- `X01:payment:<id>:<acumulado>` (`20260817170000:360` y `:591`,
-- `20260902160000:657`) a propósito: una devolución del 100 % encolada por una
-- cancelación y otra pedida por el admin son la MISMA promesa y tienen que
-- deduparse entre sí. Cambiarle el formato a una sola rompe esa dedup y abre un
-- doble reembolso. S-5 avisa de lo contrario —que mantener la clave impide
-- superseder una fila mal calculada— y tiene razón en general, pero aquí no hay
-- ninguna que superseder: en la base no existe ni un `refund_requests` con
-- crédito detrás. Se prefiere la dedup entre caminos.


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · `refund_payment` — reparte el reembolso y deja de matar recompensas
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cuatro cambios sobre la versión viva (`20260902160000:558`). La firma NO
-- cambia → `create or replace`, regla de oro 12 no se dispara, ACL intacto
-- ({postgres=X, authenticated=X}, con el `has_role('admin')` dentro, que es la
-- forma correcta y se conserva).
--
--   a) H-1 / H-7 / S-5 · el importe se REPARTE entre efectivo y crédito. A la
--      pasarela va solo el tramo que la pasarela cobró.
--   b) el crédito consumido VUELVE al alumno (si `public.credits` existe).
--   c) S-4 / H-5 · no se borra un payout que lleve recompensas dentro.
--   d) H-5 · al quitar una línea, `platform_funded_amount` baja con `amount`.
--
-- ── EL REPARTO, EXACTO ─────────────────────────────────────────────────────
-- H-1 propone `cash := round(delta * (gross − credit) / gross)` por tramo. Es
-- la idea correcta, pero aplicada tramo a tramo deriva: tres parciales de un
-- tercio sobre un cobro impar pueden sumar un céntimo más que el efectivo que
-- entró. Se implementa la misma fórmula sobre el ACUMULADO y se resta lo ya
-- asignado, que es exacta por construcción:
--
--     cash(este tramo) = round((refunded + delta) * efectivo / gross)
--                      - round( refunded          * efectivo / gross)
--
-- Con gross 180, crédito 45 (efectivo 135) y dos cancelaciones del 50 %:
-- 68 y 67. Suma 135, ni uno más. El resto de cada tramo vuelve al crédito.

create or replace function public.refund_payment(
  p_payment_id uuid,
  p_amount     bigint default null::bigint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
  -- El reparto (H-1 / H-7 / S-5).
  v_credito        bigint;
  v_efectivo_total bigint;
  v_efectivo       bigint;
  v_a_credito      bigint;
  v_hay_cred       boolean := to_regclass('public.credits') is not null;
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

  v_credito        := coalesce(v_pay.credit_amount, 0);
  v_efectivo_total := v_pay.gross_amount - v_credito;

  -- El techo sigue siendo el PRECIO pendiente, no el efectivo pendiente: lo que
  -- se le promete al alumno es el importe de su reserva. Lo que cambia es por
  -- dónde sale cada parte, que es el bloque de abajo.
  v_remaining := v_pay.gross_amount - v_pay.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);   -- por defecto, el resto
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe inválido: entre 1 y % (queda por reembolsar)', v_remaining
      using errcode = 'check_violation';
  end if;

  v_new_total := v_pay.refunded_amount + v_amount;
  v_full := v_new_total >= v_pay.gross_amount;
  v_new_status := case when v_full then 'refunded' else 'partially_refunded' end;

  -- 🔴 EL REPARTO. Sobre el ACUMULADO y restando lo ya asignado, para que la
  -- suma de todos los tramos en efectivo no pueda pasarse ni una unidad de lo
  -- que la pasarela cobró. `gross_amount = 0` no puede coexistir con un crédito
  -- (`payments_credito_acotado` + `payments_credito_con_dueno` lo impiden), pero
  -- se comprueba igual: una división por cero aquí sería una excepción en la
  -- pantalla de un admin en mitad de un reembolso.
  if v_credito = 0 or v_pay.gross_amount = 0 then
    v_efectivo := v_amount;
  else
    v_efectivo :=
        round(v_new_total::numeric             * v_efectivo_total / v_pay.gross_amount)
      - round(v_pay.refunded_amount::numeric   * v_efectivo_total / v_pay.gross_amount);
  end if;
  v_a_credito := v_amount - v_efectivo;

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
    --
    -- Y bloquea también `pi` porque es la fila que se borra: bloquear solo el
    -- padre dejaría la línea a merced de otra transacción.
    select pi.id as item_id, pi.amount as item_amount, po.id as payout_id, po.status as payout_status
      into v_item
    from public.payout_items pi
    join public.payouts po on po.id = pi.payout_id
    where pi.payment_id = p_payment_id
    for update of po, pi;

    -- La relectura explícita. Con el `for update` puesto, `v_item.payout_status`
    -- ya viene de la versión bloqueada, así que esto es cinturón sobre tirantes;
    -- va igualmente porque es lo que hace que el invariante siga leyéndose en el
    -- código el día que alguien reordene el `select`.
    if v_item.payout_id is not null then
      select po.status into v_estado_payout
        from public.payouts po
       where po.id = v_item.payout_id;
    end if;

    -- 🔴 EL GUARDIÁN (de `20260902130000`, intacto salvo que ahora mira el
    -- estado releído). 'processing' es una orden que el proveedor tiene entre
    -- manos. Ni se le quita el item ni se le resta el importe ni —lo
    -- irreversible— se borra la fila con su identificador.
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

  -- X-01 · el dinero, no solo el estado. **Solo el tramo en efectivo**: el resto
  -- nunca pasó por la pasarela y pedírselo es la fuga de H-1/H-7. Si el tramo es
  -- 0 (reserva pagada al 100 % con crédito), `enqueue_refund` sale por su puerta
  -- de arriba y no encola nada — que es lo correcto: no hay cargo que revertir.
  -- La clave NO se versiona: ver el bloque 6.
  --
  -- ⚠️ CUANDO ESTA MIGRACIÓN SE APLICA, LA `enqueue_refund` VIVA TODAVÍA ES LA
  -- VIEJA —su reescritura vive en `20260912110000` (bloque 6)—, o sea que
  -- durante ese hueco el tope sigue siendo `gross_amount` a secas. No cambia
  -- nada: `credit_amount` es 0 en las 127 filas y `v_efectivo = v_amount`, así
  -- que los dos topes son el mismo número. El día que haya créditos, las dos
  -- migraciones ya están aplicadas.
  perform public.enqueue_refund(
    v_pay.id,
    v_efectivo,
    'US-704 · reembolso manual desde el panel admin',
    'X01:payment:' || v_pay.id || ':' || v_new_total
  );

  -- El tramo que puso el crédito vuelve al crédito. Un premio no puede morir
  -- porque el tutor canceló, y un regalo pagado por un tercero menos todavía.
  -- ⚠️ `expires_at` se empuja siete días: devolver un crédito que caduca esta
  -- noche es devolverlo de mentira. Y un crédito ya 'expired' revive con esa
  -- misma ventana en vez de quedarse muerto con saldo dentro (H-7).
  -- ⚠️ ORDEN DE BLOQUEO: `payments` → `credits`, el mismo que usará
  -- `aplicar_credito`. No invertirlo en ninguna ruta nueva o aparece un ciclo.
  if v_hay_cred and v_a_credito > 0 and v_pay.credit_id is not null then
    update public.credits c
       set consumed_amount = greatest(0, c.consumed_amount - v_a_credito),
           status = case when c.status in ('consumed', 'expired') then 'active' else c.status end,
           consumed_at = case when c.consumed_amount - v_a_credito <= 0 then null else c.consumed_at end,
           expires_at = case when c.expires_at is null
                             then null
                             else greatest(c.expires_at, now() + interval '7 days')
                        end
     where c.id = v_pay.credit_id;
  end if;

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
        -- Se excluye el item y se ajusta/limpia el payout.
        delete from public.payout_items where id = v_item.item_id;

        -- 🔑 H-5 · `platform_funded_amount` BAJA CON `amount`. El fondeo de una
        -- orden es la suma del de sus líneas más el ajuste; al quitar una línea
        -- hay que quitar SU parte, que es el `platform_funded_amount` de ese
        -- pago. Sin esto la orden superviviente le sigue diciendo a operaciones
        -- que transfiera dinero para una línea que ya no existe.
        update public.payouts
           set amount = amount - v_item.item_amount,
               platform_funded_amount =
                 greatest(0, platform_funded_amount - coalesce(v_pay.platform_funded_amount, 0))
         where id = v_item.payout_id;

        -- 🔴 S-4 / H-5 · SI LA ORDEN LLEVA UNA RECOMPENSA DENTRO, NO SE BORRA.
        -- Sin el segundo `not exists`, el reembolso de un ALUMNO borraba la
        -- orden y, con el `cascade` que proponía la especificación, se llevaba
        -- por delante la recompensa de un TUTOR que no tiene nada que ver — sin
        -- excepción, sin log y sin build en rojo. `payout_adjustments.payout_id`
        -- es además `on delete restrict`, así que si alguien reintroduce el
        -- borrado sin este filtro, revienta a gritos en vez de perder dinero en
        -- silencio. Lo que queda es una orden de solo recompensa, que conserva
        -- su `funding_provider` y su `payee_country` y sigue siendo pagable.
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
  -- NTF-10 lo dispara el trigger de `payments` (20260716170000), no esta
  -- función. Ojo: avisa al ACORDAR el reembolso; el dinero sale cuando el job
  -- vacíe la cola. ⚠️ Ese aviso manda `refunded_amount`, o sea el PRECIO, no el
  -- efectivo: en un mixto le dirá al alumno 180 cuando a su tarjeta vuelven 135.
  -- Partirlo en dos líneas es H-11 y va con la plantilla, no aquí; por eso este
  -- `jsonb` ya devuelve los dos números para que el panel del admin
  -- (`admin/payments/[id]/refund-form.tsx`) los pueda enseñar por separado.
  return jsonb_build_object(
    'refunded_amount', v_amount,
    'refunded_cash',   v_efectivo,
    'credit_returned', v_a_credito,
    'total_refunded',  v_new_total,
    'status',          v_new_status::text,
    'clawback_needed', v_clawback
  );
end;
$function$;

comment on function public.refund_payment(uuid, bigint) is
  'Reembolso manual desde el panel admin. Reparte el importe entre el tramo que '
  'cobró la pasarela y el que puso un crédito, y devuelve cada uno por su sitio '
  '(H-1/H-7/S-5). No borra una orden de pago que lleve recompensas dentro (S-4) '
  'y baja `platform_funded_amount` junto a `amount` al quitar una línea (H-5). '
  'Devuelve `refunded_cash` y `credit_returned` para que el panel enseñe los dos '
  'números: hoy son `v_amount` y 0.';


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · `public.fondeo_del_ciclo` — lo que operaciones mira antes de cada ciclo
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.fondeo_del_ciclo
with (security_invoker = true) as
  select po.funding_provider                             as funding_provider,
         po.currency                                     as currency,
         count(*)                                        as ordenes,
         sum(po.amount)                                  as a_pagar,
         sum(po.platform_funded_amount)                  as pone_la_plataforma,
         sum(po.amount - po.platform_funded_amount)      as respaldado_por_caja
    from public.payouts po
   where po.status in ('pending', 'scheduled', 'on_hold')
   group by po.funding_provider, po.currency;

comment on view public.fondeo_del_ciclo is
  'LO QUE OPERACIONES MIRA ANTES DE CADA CICLO. Una fila por (balance, moneda): '
  'cuánto va a salir y de eso cuánto NO está allí. `pone_la_plataforma` es la '
  'transferencia que hay que hacer a ese PSP ANTES de que corra '
  '/api/cron/payouts-process — si no se hace, la orden se va a ''failed'' por '
  'saldo y el tutor no cobra. `security_invoker`: hereda la RLS de `payouts` '
  '(`payouts_select_own` / `payouts_select_admin`), y las columnas van una a una '
  'para que lo que se añada mañana a `payouts` no se cuele solo aquí '
  '(patrón de `tutors_public`, `20260804120000`). Una fila con '
  '`funding_provider` NULL es un aviso, no un dato: significa que hay órdenes '
  'que nadie sabe de qué balance pagar.';

-- ⚠️ NADA A `authenticated` NI A `anon`: esto agrega el dinero de TODOS los
-- tutores. Al admin se le enseña por Route Handler con `service_role`, igual que
-- `payouts_backlog()`.
grant select on public.fondeo_del_ciclo to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 9 · Higiene de ACL: `has_role` y `tutor_balance` dejan de estar abiertas a PUBLIC
-- ════════════════════════════════════════════════════════════════════════════
--
-- Medido en la base: `tutor_balance(integer)` tiene `=X/postgres` y
-- `has_role(app_role)` tiene `proacl` NULL, que es lo mismo dicho de otra forma
-- —sin ACL explícito, PostgreSQL deja EXECUTE a PUBLIC—. `grant execute … to
-- authenticated` NO quita ese PUBLIC: hay que revocarlo a mano, y por eso el
-- patrón de la casa (`20260817170000:262-264`, tres `revoke` antes del `grant`)
-- existe.
--
-- 🟢 NINGUNA DE LAS DOS FILTRA NADA, y conviene decirlo sin dramatizar: las dos
-- van por `auth.uid()`. `has_role` devuelve false sin sesión; `tutor_balance`
-- levanta '28000 auth requerido'. Esto es higiene —cerrar la puerta de un cuarto
-- vacío— y se hace ahora porque desde esta migración cuelga dinero de ellas:
-- `refund_payment` decide quién es admin con `has_role`, y `tutor_balance` es el
-- número que el tutor ve antes de que llegue su payout.
--
-- ⚠️ `has_role` SE QUEDA CON `anon`, Y NO ES UN DESCUIDO. 46 políticas de RLS la
-- llaman y TODAS están declaradas `to public`, o sea que se evalúan también para
-- `anon` — incluidas las de tablas que `anon` sí puede leer (`categories`,
-- `products`, `referral_campaigns`…). Una política que llama a una función sin
-- EXECUTE no devuelve false: levanta `permission denied for function has_role` y
-- tumba la consulta entera. Quitarle `anon` es apagar el catálogo público.
revoke execute on function public.has_role(public.app_role) from public;
grant  execute on function public.has_role(public.app_role) to anon;
grant  execute on function public.has_role(public.app_role) to authenticated;
grant  execute on function public.has_role(public.app_role) to service_role;

-- `tutor_balance` la llaman tres pantallas del tutor, todas por el cliente RLS
-- de cookies (`src/app/(app)/tutor/page.tsx:183`, `tutor/payouts/page.tsx:299`,
-- `src/lib/tutor/sidebar-badges.ts:91`), o sea como `authenticated`.
-- `account_deletion_state` la menciona pero es `security definer` y corre como
-- el dueño, así que no necesita el grant.
--
-- 🔑 Y DESDE EL BLOQUE 12 DE ESTE MISMO FICHERO DEJA DE SER HIGIENE DE UN
-- CUARTO VACÍO: allí se le añade el sumando de las recompensas, o sea que esta
-- función pasa a sumar dinero que no viene de `payments`. El `revoke` va aquí
-- —donde están sus hermanos— y no allí, y va ANTES del `create or replace` sin
-- que importe: sin `drop` el ACL no se toca en ninguno de los dos órdenes.
--
-- ⚠️ COORDINADO CON `20260912110000`: esa migración traía estos mismos dos
-- `revoke` (línea ~1752) «de paso», porque midió la misma enfermedad. Al
-- reescribirse aquí el CUERPO de la función, el dueño de su ACL es este
-- fichero y allí sobran: repetirlos no rompe nada —un `revoke` es
-- idempotente— pero deja dos sitios donde buscar por qué `anon` no la puede
-- llamar. Uno solo, y es este.
revoke execute on function public.tutor_balance(integer) from public;
revoke execute on function public.tutor_balance(integer) from anon;
grant  execute on function public.tutor_balance(integer) to authenticated;

-- ⚠️ QUEDA UNA IGUAL Y NO SE TOCA AQUÍ: `request_withdrawal(integer)` también
-- tiene `=X/postgres`. Es el mismo caso (levanta sin `auth.uid()`), pero está
-- fuera de lo que esta migración toca y cambiarla de paso es cómo se cuelan
-- regresiones en ficheros que nadie relee.


-- ════════════════════════════════════════════════════════════════════════════
-- 10 · Las dos FK a `credits`, si `credits` ya existe
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ver el aviso 1 de la cabecera. Este bloque hace que las dos órdenes de
-- aplicación valgan: si `credits` llega primero, las FK se ponen aquí; si llega
-- después, las pone su propia migración y se encuentra estas ausentes. Los
-- nombres son los que PostgreSQL generaría solo, para que el `if not exists` del
-- otro lado case sin sorpresas.

do $$
begin
  if to_regclass('public.credits') is not null then
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
  else
    raise notice
      '20260912100000: public.credits todavía no existe — las FK de credit_id las pone su migración (payments_credit_id_fkey / payout_adjustments_credit_id_fkey).';
  end if;
end
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 11 · `run_payout_batch` — quién entra en el lote (B-3, primera mitad)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 EL BUCLE PERFECTO DEL BLOQUE 5 NO CORRÍA NUNCA PARA QUIEN LO NECESITA.
-- La versión viva (`pg_get_functiondef`, nacida en `20260716140000:136`)
-- elegía a los tutores así:
--
--     for v_tutor in select distinct b.tutor_id
--                      from public.payments p join public.bookings b …
--
-- o sea SOLO por clases cobradas. Un tutor cuya única novedad de la semana es
-- una recompensa de referido no aparece en esa lista, así que
-- `build_payout_for_tutor` —con su segundo bucle entero, el que engancha la
-- recompensa a una orden o crea una— ni llega a ejecutarse para él. El diagrama
-- aprobado dice «se le suma a su próximo cobro y LE LLEGA SOLO». Hoy no le
-- llega: se queda `credits.status = 'active'` para siempre, sin error, sin cola
-- y sin nadie mirando. Es B-3 de la revisión cruzada del 11-sep, y es la razón
-- de que el segundo bucle sea «código de dinero que se despliega sin haber
-- corrido nunca».
--
-- ── POR QUÉ ARRAYS Y NO UN `union` DENTRO DEL `for` ────────────────────────
-- Porque `public.credits` puede no existir todavía (aviso 1 de la cabecera), y
-- una rama de PL/pgSQL que no se ejecuta NO SE PREPARA. Con un `union` dentro
-- del `for` la consulta es una sola sentencia y se prepararía entera en la
-- primera pasada, tabla ausente incluida: `relation "public.credits" does not
-- exist` en un job de `pg_cron`, o sea en `cron.job_run_details` y en ningún
-- sitio más (regla de oro 11). Con el `to_regclass` delante y el `array_agg`
-- dentro de la rama, **una sola versión de esta función vale para los dos
-- órdenes de aplicación**: si `credits` llega después, la rama se salta hasta
-- que exista y la pasada siguiente ya la ve. No hace falta que
-- `20260912110000` reescriba nada.
--
-- ⚠️ Los filtros del segundo `select` son LOS MISMOS del segundo bucle de
-- `build_payout_for_tutor` (bloque 5), letra por letra. Si divergen, esta
-- función elige tutores para los que la otra no tiene nada que hacer —ruido
-- inofensivo— o, al revés, deja fuera a alguien que sí tenía premio, que es
-- justo el fallo que este bloque viene a cerrar. Van juntos o no van.
--
-- 🟢 EL OTRO LLAMADOR NO HACE FALTA TOCARLO, y conviene decirlo para que nadie
-- lo busque: `request_withdrawal(integer)` (versión viva) no tiene criterio
-- propio de elegibilidad — llama directamente a `build_payout_for_tutor` y solo
-- mira si devolvió null—, así que un tutor que pide su retiro con una
-- recompensa y ninguna clase YA funciona desde el bloque 5. El agujero era
-- exclusivamente del lote automático.
--
-- La firma NO cambia (`p_retention_days integer default 7`, mismo NOMBRE de
-- parámetro — cambiarlo sería un `drop`+`create`) → `create or replace`, la
-- regla de oro 12 no se dispara y el ACL sobrevive intacto (medido:
-- `{postgres=X/postgres,service_role=X/postgres}`). El `cron.schedule` de
-- `run-payout-batch` (`0 3 * * 1`, `20260716140000:278`) la sigue llamando sin
-- argumentos y no hay que tocarlo.

create or replace function public.run_payout_batch(p_retention_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tutor    uuid;
  v_made     int := 0;
  v_tutores  uuid[];
  -- Ver el aviso 1 de la cabecera: mientras esto sea false, la rama de las
  -- recompensas ni se prepara y esta función se comporta EXACTAMENTE como la
  -- de hoy.
  v_hay_cred boolean := to_regclass('public.credits') is not null;
begin
  -- (1) Los de siempre: clases completadas, retención vencida y sin línea de
  --     payout todavía. Idéntico al `select distinct` de la versión viva.
  select coalesce(array_agg(distinct b.tutor_id), '{}'::uuid[])
    into v_tutores
    from public.payments p
    join public.bookings b on b.id = p.booking_id
   where p.status = 'paid' and b.status = 'completed'
     and b.completed_at <= now() - make_interval(days => p_retention_days)
     and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id);

  -- (2) Y los que NO tienen ni una clase que cobrar esta semana pero sí una
  --     recompensa esperando. Un tutor puede estar en las dos listas: el
  --     `distinct` del bucle lo deja en una sola pasada, y
  --     `build_payout_for_tutor` es idempotente por `payout_items.payment_id`
  --     (único) y por `payout_adjustments.credit_id` (único) de todas formas.
  if v_hay_cred then
    select v_tutores || coalesce(array_agg(distinct c.beneficiary_id), '{}'::uuid[])
      into v_tutores
      from public.credits c
     where c.beneficiary_id is not null
       and c.destino = 'payout'
       and c.status  = 'active'
       and c.amount  > c.consumed_amount
       and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id);
  end if;

  for v_tutor in select distinct u.tutor_id from unnest(v_tutores) as u(tutor_id) order by 1
  loop
    if public.build_payout_for_tutor(v_tutor, p_retention_days, 'scheduled') is not null then
      v_made := v_made + 1;
    end if;
  end loop;

  return jsonb_build_object('tutors_paid_out', v_made);
end;
$function$;

comment on function public.run_payout_batch(integer) is
  'El lote semanal de payouts. Elige tutores por DOS motivos, no por uno: '
  'clases cobradas con la retención vencida, Y recompensas de referido en '
  'dinero esperando (`credits` con destino=''payout'' y saldo sin consumir). '
  'Sin el segundo, el tutor cuya única novedad es el premio no entraba en la '
  'lista y el segundo bucle de `build_payout_for_tutor` no llegaba a correr '
  'para él: el diagrama promete «le llega solo» y no llegaba nunca (B-3). La '
  'rama de `credits` va tras un `to_regclass` para que la misma versión valga '
  'existiendo o no la tabla.';


-- ════════════════════════════════════════════════════════════════════════════
-- 12 · `tutor_balance` — el saldo cuenta la recompensa (B-3, segunda mitad)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔑 LA REGLA DE ESTA FUNCIÓN, Y ES LA QUE SE ROMPÍA: `available` es lo que el
-- PRÓXIMO LOTE VA A METER EN UNA ORDEN. Sus tres bloques sumaban solo
-- `payments`, así que una recompensa aparecía de la nada el día del payout: el
-- tutor veía 0 el domingo y una orden con dinero dentro el lunes. Peor todavía
-- para el tutor que SOLO tiene recompensa: su balance decía 0, su pantalla
-- decía que no había nada que cobrar, y el bloque 11 acababa de emitirle una
-- orden.
--
-- Se parte de la versión VIVA (`pg_get_functiondef`) y se le añade un sumando
-- al bucket `available`. Lo demás no se toca:
--
--   · `in_retention` NO lo lleva, y es correcto: una recompensa no tiene clase
--     detrás, así que no tiene `completed_at` ni retención que esperar. El
--     bloque 5 la mete en la orden sin mirar el cutoff.
--   · `paid_out` NO hay que tocarlo: suma `payouts.amount`, y `amount` YA
--     incluye `adjustment_amount` (bloque 5 los sube juntos). Sumarlo aquí
--     sería contarlo dos veces.
--
-- ⚠️ LA FORMA DEL JSONB NO CAMBIA: siguen siendo tres claves con la misma
-- pinta (`[{currency, amount}]`). Es deliberado — `TutorBalance` en
-- `src/lib/payouts.ts:60` declara exactamente esas tres y lo leen tres
-- pantallas (`tutor/page.tsx:189`, `tutor/payouts/page.tsx:290`,
-- `lib/tutor/sidebar-badges.ts:91`). Una cuarta clave obligaría a tocar el tipo
-- y las tres pantallas en un PR que va de otra cosa; el número que importa —lo
-- que le van a pagar— es el mismo con o sin ella.
--
-- ⚠️ LOS FILTROS DEL SUMANDO SON, OTRA VEZ, LOS DEL SEGUNDO BUCLE DE
-- `build_payout_for_tutor`. Si el lote no lo va a meter, esto no lo puede
-- llamar «disponible»: un saldo que se enseña y no llega es peor que uno que no
-- se enseña. Por eso está el `not exists` contra `payout_adjustments` aunque
-- `status = ''active''` ya lo cubra — el día que alguien consuma un crédito por
-- partes, los dos sitios tienen que seguir diciendo lo mismo.
--
-- La firma NO cambia → `create or replace` y el ACL sobrevive. El `revoke` del
-- PUBLIC que tenía (`=X/postgres`, medido) está en el bloque 9 de este mismo
-- fichero, unas líneas más arriba, y ahora deja de ser higiene de un cuarto
-- vacío: desde aquí esta función suma dinero que no es de `payments`.

create or replace function public.tutor_balance(p_retention_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
          select p.currency, p.tutor_net_amount as monto
          from public.payments p
          join public.bookings b on b.id = p.booking_id
          where b.tutor_id = v_uid and p.status = 'paid' and b.status = 'completed'
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
        select p.currency, sum(p.tutor_net_amount) as total
        from public.payments p
        join public.bookings b on b.id = p.booking_id
        where b.tutor_id = v_uid and p.status = 'paid' and b.status = 'completed'
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

comment on function public.tutor_balance(integer) is
  'El saldo del tutor, por moneda y en tres bloques. `available` suma lo que el '
  'PRÓXIMO LOTE va a meter en una orden: netos de clases completadas con la '
  'retención vencida MÁS las recompensas de referido en dinero (`credits` con '
  'destino=''payout'' y saldo sin consumir). Sin ese segundo sumando el premio '
  'aparecía de la nada el día del payout, y el tutor que solo tenía premio veía '
  '0 (B-3). `in_retention` no las lleva —no hay clase que retener— y `paid_out` '
  'tampoco hace falta que las sume: `payouts.amount` ya incluye '
  '`adjustment_amount`. La forma del jsonb NO cambia: `TutorBalance` de '
  'src/lib/payouts.ts declara estas tres claves y las leen tres pantallas.';


-- ════════════════════════════════════════════════════════════════════════════
-- 13 · `payouts_backlog()` — un ajuste no es un descuadre (B-2)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se parte de la versión VIVA (`pg_get_functiondef`), que es byte a byte la de
-- `20260903160000:245` —comprobado— y NO la de `20260902170000:427`, que
-- todavía hablaba de `payout_provider` en singular. Hay cuatro copias de esta
-- función en `supabase/migrations/`; solo una está aplicada.
--
-- Cambia UNA expresión, `bloqueos.descuadradas`. El resto va letra por letra:
-- este termómetro lo lee una persona en el SQL editor y en el pie del workflow
-- de Actions, y sus comentarios son la mitad de su valor.
--
-- La firma NO cambia → `create or replace`, la regla de oro 12 no se dispara y
-- el ACL sobrevive (medido: `{postgres=X/postgres,service_role=X/postgres}`; no
-- hace falta reponer los cuatro `revoke`/`grant` de `20260902170000:683-686`).
--
-- ⚠️ ESTA FUNCIÓN ES `language sql`, NO `plpgsql`. Su cuerpo SÍ se analiza al
-- crearla (`check_function_bodies` está en on), así que `p.adjustment_amount`
-- tiene que existir ya: lo crea el bloque 3 de ESTE mismo fichero, más arriba.
-- Es la excepción a la regla de oro 11 y conviene decirla en voz alta, porque
-- es lo único que hace que este bloque no se pueda mover antes del 3.

create or replace function public.payouts_backlog()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$

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
    --
    -- ⚠️ El riel manual NO pasa por aquí. Una orden pagada a mano no se queda en
    -- 'processing': `manage_payout(id,'mark_paid',referencia,canal)` la cierra en
    -- 'paid' en el mismo momento, con la referencia de la transferencia como
    -- `provider_payout_id`. Si aparece una fila venezolana en este contador, lo
    -- que hay que mirar es quién la puso en 'processing', no el panel de un PSP.
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

    -- Lo que hay delante ahora mismo. Mismo criterio que
    -- `process_scheduled_payouts()`, para que las dos cifras se puedan contrastar.
    -- ⚠️ INCLUYE las del riel manual, que el job no puede tocar: para saber
    -- cuántas de estas esperan a una persona y no a un PSP, `a_pagar_a_mano`.
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

    -- 🟠 EL TRABAJO QUE NO LO HACE NINGÚN JOB. Órdenes vencidas cuyo destino
    -- rutea a 'manual' (hoy: Venezuela, `20260902150000`). No están rotas, no
    -- están bloqueadas y ninguna pasada de `/api/cron/payouts-process` las va a
    -- mover: esperan a que un admin abra `manual_destination(tutor_id)`, haga la
    -- transferencia y cierre la fila con `manage_payout(id,'mark_paid',…)`.
    --
    -- Existe porque sin ella ese trabajo era invisible: antes de hoy estas filas
    -- se contaban en `sin_ejecutor` (mezcladas con las impagables) o en
    -- `balance_ajeno` (declaradas imposibles), y en los dos casos el mensaje era
    -- «no se puede», cuando el mensaje correcto es «te toca a ti».
    --
    -- ⚠️ Puede solaparse con `bloqueos.sin_datos_de_cobro`: una orden manual cuyo
    -- tutor todavía no ha declarado a dónde cobrar sale en las dos, y así debe
    -- ser — es trabajo pendiente Y le falta un dato.
    'a_pagar_a_mano', (
      select count(*)
        from public.payouts p
        left join lateral (
          select rr.payout_providers
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
         and r.payout_providers && array['manual', 'banco-manual']::text[]
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
    -- Estos seis números explican una cola que no baja. Ninguno es un fallo del
    -- pago: son condiciones previas que el ejecutor comprueba ANTES de llamar a
    -- nadie, y que ninguna pasada del job va a resolver sola.
    --
    -- ⚠️ Se calculan aquí para poder mirarlos sin depender de que el workflow
    -- corra, PERO el que manda es el ejecutor: si algún día discrepan, gana el
    -- Route Handler, que es quien habla con el proveedor. Esta función explica;
    -- no decide.
    --
    -- ⚠️ Y desde C2m hay que leerlos sabiendo que `payout_provider` tiene TRES
    -- clases de valor, no dos: un PSP con adaptador ('stripe', 'dlocal'), el riel
    -- manual ('manual', que es una persona) y la ausencia de ejecutor ('simulated'
    -- o null). `rielDePayout()` en `src/lib/payments.ts` es la misma partición
    -- dicha en TypeScript, y si esa función y estos filtros discrepan, gana ella:
    -- es la que decide qué se le pinta al tutor y qué manda el job.
    'bloqueos', (
      select jsonb_build_object(

        -- Sin país de destino congelado no se puede pagar a ningún sitio.
        -- ⚠️ Hoy en dev son TODAS: el backfill de `20260901130000` copió
        -- `payments.payee_country`, que está a null en las 115 filas.
        'sin_pais',
          count(*) filter (where p.payee_country is null),

        -- A su destino no le corresponde ningún ejecutor: ni PSP ni persona. Se
        -- queda con `null` y con 'simulated', que es la ausencia de uno.
        -- ⚠️ VENEZUELA YA NO ESTÁ AQUÍ, y es correcto: desde `20260902150000` su
        -- fila dice 'manual', o sea que tiene riel — el de una persona. Lo único
        -- que debe quedar dentro es la fila del tutor que no ha declarado país.
        'sin_ejecutor',
          count(*) filter (where r.payout_providers is null
                              or r.payout_providers = array['simulated']),

        -- 🔴 EL DINERO ESTÁ EN OTRO BALANCE. Un payout se paga desde el balance
        -- del PSP que cobró ese dinero (`funding_provider`); si el que ejecuta es
        -- otro, la orden no es «difícil», es IMPAGABLE.
        -- ⚠️ C2r · ESTE COMENTARIO DESCRIBÍA EL MODELO SINGULAR y se ha
        -- reescrito con el de listas. Decía que toda orden de riel bancario
        -- entraba aquí porque las filas cobraban por Stripe y pagaban por
        -- dLocal; con `charge_providers` y `payout_providers` eso ya no se lee
        -- en una fila, se lee en dos listas. Lo que NO ha cambiado es el fondo:
        -- o se cobra por donde se paga, o se fondea el balance del que paga a
        -- propósito. Sigue siendo una decisión de tesorería, no de código, y es
        -- la decisión 1-bis de `docs/PAGOS-Y-PAYOUTS.md`.
        --
        -- ⚠️ C2m · Y POR ESO 'manual' QUEDA FUERA DEL FILTRO. Sin esa exclusión,
        -- toda orden venezolana entraba aquí —se fondea con Stripe y se «ejecuta»
        -- con 'manual', que nunca van a coincidir— y el termómetro declaraba
        -- imposible el mercado principal. 'manual' no tiene balance: el dinero
        -- sale de donde lo tengamos y lo mueve una persona. Cuando esa orden
        -- espera, no espera tesorería: espera a alguien. Eso es `a_pagar_a_mano`.
        'balance_ajeno',
          -- ⚠️ C2r · CON LISTAS DE CANDIDATOS ESTO YA NO ES UNA COMPARACIÓN, ES UN
        -- «NINGUNO». Una orden es impagable por balance solo si NINGÚN candidato
        -- puede pagarla: ni uno que esté fondeado aparte (wise, paypal, airtm,
        -- manual, banco-manual, que no dependen de quién cobró), ni uno atado a
        -- un balance que además CUADRE con `funding_provider`.
        -- No se comprueba si el candidato tiene adaptador: eso solo lo sabe el
        -- código, y duplicarlo aquí es cómo se desincronizan los dos.
        count(*) filter (where r.payout_providers is not null
                           and r.payout_providers <> array['simulated']
                           and not exists (
                                 select 1 from unnest(r.payout_providers) c
                                  where c not in ('dlocal', 'stripe')
                                     or c = p.funding_provider)),

        -- El saldo del tutor está en USD y el país cobra en su moneda. Quién
        -- asume el spread ya está decidido (2-sep: el tutor), así que esto ya no
        -- es tanto un bloqueo como un aviso de que esa orden pasa por conversión.
        -- Ecuador es el único de los ocho países que cobra en USD; Venezuela no
        -- entra porque `payout_country_rules` no tiene fila VE. Ver el techo
        -- `ponytail` de la cabecera de este bloque: el nombre de la clave se
        -- quedó viejo y se renombra cuando alguien toque la conversión de verdad.
        'cambio_sin_decidir',
          count(*) filter (where c.currency is not null
                             and c.currency <> p.currency),

        -- El tutor no ha registrado a dónde cobrar. Se arregla solo en cuanto lo
        -- guarde: la orden sigue en la cola, no en 'failed'.
        --
        -- ⚠️ C2m · CADA RIEL TIENE SU TABLA, Y HAY QUE MIRAR LA QUE TOCA. El riel
        -- bancario guarda en `tutor_payout_accounts` (B1, una fila por tutor); el
        -- manual guarda en `tutor_manual_payout_destinations` (`20260902110000`,
        -- VARIAS por tutor, una por canal). Mirar solo la primera contaba «sin
        -- datos» a todo tutor venezolano, incluidos los que habían registrado su
        -- Zelle correctamente — y ese contador es el que decide si alguien va a
        -- escribirle al tutor o no.
        --
        -- Sin riel resuelto (`null` / 'simulated') se mira la bancaria, que es lo
        -- mismo que se hacía antes: esa orden ya está contada en `sin_ejecutor` y
        -- el dato de cobro no es su problema principal.
        'sin_datos_de_cobro',
          count(*) filter (
            where case
                    -- ⚠️ C2r · QUÉ TABLA MIRAR DEPENDE DE QUÉ DATO LE PIDE EL RIEL AL TUTOR,
                    -- y con listas de candidatos un país puede tener de los dos:
                    --   coordenadas bancarias → dlocal, wise, stripe, banco-manual
                    --   un identificador      → manual, airtm, paypal
                    -- Manda la familia BANCARIA cuando el país tiene alguno de esos,
                    -- porque son los que de verdad van a pagar (y 'banco-manual' es el
                    -- que funciona hoy). Colombia es mixta y cae aquí; Venezuela no
                    -- tiene ninguno bancario y cae en la segunda rama.
                    when r.payout_providers && array['dlocal', 'wise', 'stripe', 'banco-manual']::text[]
                      then a.tutor_id is null
                    when r.payout_providers && array['manual', 'airtm', 'paypal']::text[]
                      then m.hay is not true
                    else a.tutor_id is null
                  end
          ),

        -- El importe agregado no cuadra con sus líneas. Es integridad nuestra, no
        -- del PSP, y el ejecutor se niega a mandarlo (regla de oro 2).
        --
        -- 🔴 B-2 · Y «SUS LÍNEAS» YA NO SON SOLO `payout_items`. Desde
        -- `20260912100000` una orden vale `suma(payout_items) + adjustment_amount`:
        -- la recompensa en dinero del tutor viaja en `payout_adjustments` y NO
        -- tiene línea, porque no tiene `payments` detrás (no hay clase, no hay
        -- alumno, no hay split). Sin el sumando de abajo, TODA orden con
        -- recompensa salía contada aquí como descuadre —o sea como un problema
        -- de integridad nuestro— cuando lo único que pasa es que este contador
        -- no sabía mirar. El mismo cambio, palabra por palabra, va en
        -- `src/app/api/cron/payouts-process/route.ts:474`, que es quien DECIDE
        -- si la orden se manda; este contador solo explica. Si algún día
        -- discrepan, gana el Route Handler.
        'descuadradas',
          count(*) filter (where p.amount is distinct from
                                 coalesce(i.suma, 0) + p.adjustment_amount)
      )
        from public.payouts p
        left join lateral (
          select rr.payout_providers
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
        left join public.payout_country_rules   c on c.country  = p.payee_country
        left join public.tutor_payout_accounts  a on a.tutor_id = p.tutor_id
        -- El destino manual se pregunta por EXISTENCIA y con `limit 1`, no con un
        -- `left join` a secas: la PK de esa tabla es `(tutor_id, channel)`, así
        -- que un tutor con Zinli y Zelle multiplicaría su fila de `payouts` por
        -- dos y TODOS los contadores de este bloque saldrían inflados.
        left join lateral (
          select true as hay
            from public.tutor_manual_payout_destinations d
           where d.tutor_id = p.tutor_id
           limit 1
        ) m on true
        left join lateral (
          select sum(pi.amount) as suma
            from public.payout_items pi
           where pi.payout_id = p.id
        ) i on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    )
  );
$function$;

comment on function public.payouts_backlog() is
  'C2 · termómetro de la cola de payouts, para el SQL editor y el pie del workflow de Actions. NO está programado en ningún cron, igual que refunds_backlog(). Devuelve el reparto por estado, lo que hay en cola con su importe, lo que está en vuelo, cuántas esperan a que una persona las pague (a_pagar_a_mano, riel manual) y —la cifra que importa— sin_identificar: órdenes en ''processing'' sin provider_payout_id, o sea reclamadas sin saber si el proveedor llegó a crear el payout. Esas NO se reintentan solas a propósito (POST /v1/payouts no tiene clave de idempotencia y un 400 suyo puede haber creado el payout igual), así que mientras ese número no sea 0 puede haber un pago sin conciliar. El bloque bloqueos explica por qué una cola no baja: sin país, sin ejecutor, balance ajeno, cambio sin decidir, sin datos de cobro o descuadrada. ⚠️ Desde C2m (2026-09-02) distingue TRES rieles y no dos: PSP con adaptador, ''manual'' (una persona) y la ausencia de ejecutor. balance_ajeno excluye ''manual'' —no tiene balance del que salir— y sin_datos_de_cobro mira tutor_manual_payout_destinations cuando el riel es manual, no tutor_payout_accounts. ⚠️ Desde 20260912100000 (B-2) descuadradas compara contra suma(payout_items) + adjustment_amount: la recompensa en dinero del tutor viaja en payout_adjustments y no tiene línea, así que sin ese sumando toda orden con recompensa salía marcada como problema de integridad. Explica, no decide: quien manda sobre si una orden se manda es el Route Handler /api/cron/payouts-process.';

-- Los cuatro de `20260902170000:683-686` siguen puestos: sin `drop` no se toca
-- el ACL. Medido hoy: {postgres=X/postgres,service_role=X/postgres} — ni
-- PUBLIC, ni `anon`, ni `authenticated`.
