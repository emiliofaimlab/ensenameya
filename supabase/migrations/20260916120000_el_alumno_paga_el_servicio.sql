-- ════════════════════════════════════════════════════════════════════════════
-- EL ALUMNO PAGA EL SERVICIO · cargo por servicio del 5 % (punto 7, 16-sep-2026)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Decisión del cliente, tomada el 16-sep-2026 y con estas seis respuestas:
--
--   1. Es ADICIONAL, no sustituye. El tutor sigue cobrando su 75/85/90 % del
--      precio según su tier: `tutor_net_amount` y `platform_fee_amount` no se
--      tocan ni aquí ni en ningún sitio.
--   2. La BASE es lo que de verdad se cobra: `precio − crédito`. Una mentoría
--      cubierta al 100 % por un regalo NO lleva cargo.
--   3. Se REEMBOLSA proporcional al porcentaje de RN-37.
--   4. La compra de un regalo también lo lleva (va en su propia migración: el
--      regalo es otro camino de cobro y no pasa por `payments`).
--   5. El 5 vive como CONSTANTE, aquí abajo. Cambiarlo es una migración, que es
--      la regla de la casa para el dinero (la misma que existe porque tocar
--      `payment_routing_rules` a mano tuvo a dev y prod ruteando distinto
--      durante semanas, `20260904190000`).
--   6. NO es retroactivo: lo ya reservado se cobra como se prometió.
--
-- ⚠️ `docs/PAGOS-Y-PAYOUTS.md:414` recomienda por escrito LO CONTRARIO
--    («Cobro | Lo asume Enséñame Ya | cargarlo al alumno reduce conversión»).
--    La decisión del cliente manda y queda escrita aquí encima, o dentro de un
--    mes alguien leerá aquel renglón y «corregirá» esto.
--
--
-- ── POR QUÉ UN TRIGGER Y NO TOCAR LAS FUNCIONES DE DINERO ───────────────────
--
-- 🔴 Esta es LA decisión de diseño y conviene entenderla antes de cambiarla.
--
-- «Lo que hay que cobrar» está escrito como `gross_amount − credit_amount` en
-- SEIS sitios, y los seis son código de dinero en producción:
--   · `marcar_cobro_abierto` (sella `checkout_amount`, `20260912120000`)
--   · `confirm_payment` (concilia y ABORTA si no cuadra, `20260912110000:1326`)
--   · `confirm_order_payment` (lo mismo para el pedido, `20260912120000:378`)
--   · `aplicar_credito` / `quitar_credito` (el cerrojo del cobro abierto)
--   · `enqueue_refund` (el tope de lo devolvible)
-- …más `src/app/api/pagos/checkout/route.ts:551,635`, que compone el importe
-- que viaja a la pasarela.
--
-- Meter el 5 % «por fuera» —cobrando un poco más en la pasarela sin registrarlo
-- en la fila— es la forma de romper esto que más caro sale: el alumno paga,
-- `confirm_payment` aborta con `check_violation`, el `insert` en
-- `payment_webhook_events` se revierte con él, y Stripe reintenta ETERNAMENTE
-- con el dinero ya cobrado y la reserva atrapada en `pending_payment` mientras
-- el hold de 7 minutos le expira el horario. No sale en el build, ni en el
-- typecheck, ni en `next dev`: sale en producción y con dinero real.
--
-- Y reescribir las seis a `create or replace` significa volver a volcar sus
-- cuerpos enteros —cientos de líneas, con sus comentarios— y rezar por no
-- revertir en silencio un arreglo posterior. Es el fallo mudo más caro del
-- repertorio de esta casa.
--
-- Así que la elección es la contraria: **que `gross_amount` ya lleve el cargo
-- dentro, siempre**, mantenido por un trigger. Entonces `gross − credit` sigue
-- significando exactamente lo que significaba —lo que hay que cobrar— y las seis
-- funciones y el Route Handler siguen siendo correctas SIN TOCAR UNA LÍNEA.
--
-- El invariante que cambia, y hay que saberlo:
--      antes:  gross = platform_fee + tutor_net
--      ahora:  gross = platform_fee + tutor_net + service_fee
-- Nadie lo defiende con un `check` (no lo había antes tampoco). Los sitios que
-- daban por hecho que las tres cifras suman son `src/lib/admin/queries.ts:192`
-- y las vistas de estadísticas (`20260715190000`, `20260729210000`); las
-- estadísticas siguen bien porque agregan `platform_fee_amount`, que no cambia.
-- La pantalla de admin sí hay que retocarla y se retoca en el mismo PR.
--
-- ── POR QUÉ NO HACE FALTA FECHA DE CORTE PARA LO NO RETROACTIVO ─────────────
--
-- `service_fee_pct` se congela EN EL INSERT, como `tier_split_pct`. Las 220
-- filas que ya existen se quedan con el `default 0` y por tanto con cargo 0 para
-- siempre, pase lo que pase con su crédito. No hace falta comparar fechas ni
-- hacer backfill: la propia fila dice bajo qué régimen nació.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1 · Las dos columnas ────────────────────────────────────────────────────

alter table public.payments
  add column if not exists service_fee_amount bigint        not null default 0,
  add column if not exists service_fee_pct    numeric(5, 2) not null default 0;

comment on column public.payments.service_fee_amount is
  'Cargo por servicio que paga el ALUMNO, en unidades mínimas, y que YA ESTÁ SUMADO DENTRO de gross_amount. El invariante pasa a ser gross = platform_fee + tutor_net + service_fee. No lo toca nadie a mano: lo mantiene el trigger payments_cargo_por_servicio cada vez que cambia credit_amount. 0 en todo lo anterior al 16-sep-2026.';

comment on column public.payments.service_fee_pct is
  'El porcentaje con el que nació esta fila, congelado como tier_split_pct. Es lo que hace que el cargo NO sea retroactivo sin necesidad de fecha de corte: las filas viejas valen 0 y el trigger les calcula 0 para siempre. Si algún día cambia el 5, los cobros en vuelo conservan el suyo.';


-- ── 2 · La aritmética, en un solo sitio ─────────────────────────────────────

create or replace function public.cargo_por_servicio(p_base bigint, p_pct numeric)
returns bigint
language sql
immutable
set search_path = ''
as $fn$
  -- `greatest(0, …)` porque la base puede salir NEGATIVA: un regalo puede valer
  -- más que la mentoría que se está pagando. Ahí el cargo es 0, no un abono.
  select greatest(0, round(greatest(0, p_base) * p_pct / 100.0))::bigint;
$fn$;

comment on function public.cargo_por_servicio(bigint, numeric) is
  'El cargo por servicio sobre una base. La ÚNICA aritmética del 5 %: la usan el trigger de payments y el del regalo. Redondea al alza a partir de medio céntimo (round de Postgres), que es lo que hace el resto del dinero de esta casa.';


-- ── 3 · Quién lo mantiene ───────────────────────────────────────────────────

create or replace function public.payments_cargo_por_servicio()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  -- 🔑 EL PRECIO DEL TUTOR, reconstruido. Es la base inmutable de todo esto y
  --    NO se lee de `bookings`: se deduce de la propia fila quitándole el cargo
  --    que lleve puesto. Así el cálculo es IDEMPOTENTE —recalcular mil veces da
  --    lo mismo— y no depende de que nadie más haya actualizado `bookings`.
  v_precio  bigint;
  v_pct     numeric(5, 2);
  v_credito bigint;
  v_cargo   bigint;
  v_gross   bigint;
begin
  if tg_op = 'INSERT' then
    -- 🔴 AQUÍ VIVE EL 5. Cambiarlo es una migración nueva, no un UPDATE.
    --    (regla de oro 5: el dinero no se cambia a mano en la nube)
    v_pct    := 5.00;
    v_precio := new.gross_amount;   -- al nacer, `gross` es el precio pelado
  else
    v_pct    := old.service_fee_pct;               -- congelado, nunca se renegocia
    v_precio := new.gross_amount - old.service_fee_amount;
  end if;

  v_credito := coalesce(new.credit_amount, 0);
  v_cargo   := public.cargo_por_servicio(v_precio - v_credito, v_pct);
  v_gross   := v_precio + v_cargo;

  -- ⚠️ EL TOPE QUE SALVA `payments_credito_acotado` (`20260912100000:159`, que
  --    exige `credit_amount <= gross_amount`). Cuando el crédito cubre la
  --    mentoría ENTERA, la base es 0 → el cargo es 0 → `gross` vuelve a ser el
  --    precio pelado; pero `aplicar_credito` pudo haber anotado un `cubre`
  --    calculado contra el `gross` de antes, que llevaba cargo dentro. Sin este
  --    `greatest` la constraint tumbaría la transacción de quien canjea un
  --    regalo que lo cubre todo — o sea el caso feliz.
  new.gross_amount       := greatest(v_gross, v_credito);
  new.service_fee_amount := v_cargo;
  new.service_fee_pct    := v_pct;

  -- `bookings.total_amount` es LO QUE PAGA EL ALUMNO y lo leen diez pantallas
  -- (historial, reservas, confirmación, el panel del tutor, las alertas del
  -- admin…) y, sobre todo, la previsión de reembolso de
  -- `(app)/reservas/[id]/cancelar/page.tsx:79`, que hace `total_amount * pct`.
  -- Sincronizarlo aquí es lo que hace que el cargo se vea y se devuelva
  -- proporcional en todas ellas sin tocar ni una.
  --
  -- ⚠️ `subtotal_amount` NO se toca a propósito: sigue siendo el precio del
  --    tutor, que es lo que separa «lo que cobra él» de «lo que paga ella».
  --    Hasta hoy las dos columnas eran redundantes; este es el hueco que
  --    esperaban.
  update public.bookings b
     set total_amount = new.gross_amount
   where b.id = new.booking_id
     and b.total_amount is distinct from new.gross_amount;

  return new;
end;
$fn$;

comment on function public.payments_cargo_por_servicio() is
  'Mantiene el cargo por servicio DENTRO de gross_amount cada vez que nace un cobro o cambia su crédito. Existe para no tener que reescribir confirm_payment, confirm_order_payment, marcar_cobro_abierto, aplicar_credito, quitar_credito, enqueue_refund y el Route Handler del checkout, que hablan todos de gross_amount - credit_amount y siguen siendo correctos tal cual. Idempotente: reconstruye el precio quitándole el cargo anterior, así que recalcular no acumula.';

-- ⚠️ `update of` incluye `gross_amount` además de `credit_amount`: sin él, un
--    `update payments set gross_amount = …` (hoy no lo hace nadie, pero la
--    columna no está sellada) dejaría el cargo desincronizado del bruto. Con él,
--    cualquier escritura del bruto vuelve a pasar por esta aritmética.
--
-- ⚠️ El nombre importa: PostgreSQL dispara los triggers `before` del mismo
--    evento en orden ALFABÉTICO, y `payments_cargo_por_servicio` va antes que
--    `payments_set_updated_at` (`20260709140000:122`). Es el orden que queremos.
drop trigger if exists payments_cargo_por_servicio on public.payments;
create trigger payments_cargo_por_servicio
  before insert or update of credit_amount, gross_amount on public.payments
  for each row execute function public.payments_cargo_por_servicio();


-- ── 4 · Grants ──────────────────────────────────────────────────────────────
--
-- No hay tabla nueva, así que la regla de oro 9 no pide nada: las columnas
-- heredan los grants de `payments` y el trigger corre con los privilegios del
-- dueño de la tabla, no con los de quien escribe.
--
-- `cargo_por_servicio` sí se expone, porque la va a llamar la migración del
-- regalo y porque es una función PURA sobre dos números: no lee ninguna tabla y
-- no revela nada. Aun así se le quita a `anon`: que el navegador de un visitante
-- pueda preguntarle a la base cuánto es el 5 % de algo no aporta nada.
revoke execute on function public.cargo_por_servicio(bigint, numeric) from public;
revoke execute on function public.cargo_por_servicio(bigint, numeric) from anon;
grant  execute on function public.cargo_por_servicio(bigint, numeric) to authenticated;
grant  execute on function public.cargo_por_servicio(bigint, numeric) to service_role;
