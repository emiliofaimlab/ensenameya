-- ════════════════════════════════════════════════════════════════════════════
-- EL REGALO TAMBIÉN PAGA EL SERVICIO · la otra mitad del punto 7
-- ════════════════════════════════════════════════════════════════════════════
--
-- La decisión 4 del cliente (16-sep-2026): «en TODAS las transacciones de la
-- plataforma». Comprar un regalo es una transacción y va por su propio camino
-- de cobro —`credits`, no `payments`—, así que necesita su propia migración.
--
-- Y NO se cobra dos veces, que era el riesgo de decir «en todas»:
--   · al COMPRAR el regalo se cobra el precio + el 5 %;
--   · al CANJEARLO, la base del cargo es `precio − crédito` y el crédito cubre
--     la reserva entera, así que la base es 0 y el cargo es 0.
-- La aritmética lo garantiza sola, sin ninguna bandera de «este ya lo pagó».
--
--
-- ── POR QUÉ EL CARGO VA DENTRO DE `credits.amount` ──────────────────────────
--
-- Es la misma elección —y por el mismo motivo— que en `20260916120000`: el
-- camino del regalo tiene su propia conciliación, y también aborta.
--
--   · `marcar_cobro_regalo_abierto` sella `checkout_amount = c.amount`
--     (`20260912110000:2311`).
--   · `confirm_gift_payment` compara por los DOS lados: lo que diga el webhook
--     (`p_amount_charged <> v_c.amount`) y el sello (`checkout_amount <>
--     v_c.amount`). Cualquiera que no cuadre levanta `check_violation`.
--   · y `/api/pagos/checkout:784` cobra `regalo.amount` tal cual.
--
-- O sea: cobrar el 5 % «por fuera» dejaría al comprador pagando y al webhook
-- abortando para siempre, con el regalo sin activar y el dinero cobrado. Con el
-- cargo DENTRO de `amount`, las tres piezas siguen siendo correctas sin tocar
-- una línea de ninguna.
--
-- ⚠️ Y el destinatario no pierde nada, al contrario: su crédito vale
--    `precio + cargo`, que es exactamente lo que cuesta esa mentoría desde el
--    16-sep. Si `amount` se quedara en el precio pelado, el regalado tendría que
--    poner el 5 % de su bolsillo al agendar — que es la peor cara posible de
--    esto y justo lo que el cliente descartó en la decisión 2.
--
-- ⚠️ SOLO `source = 'gift'`. Los créditos de referido (`source = 'referral'`)
--    son dinero que pone la casa: no hay comprador, no hay cobro y no hay nada
--    a lo que añadirle un cargo.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1 · La columna ──────────────────────────────────────────────────────────

alter table public.credits
  add column if not exists service_fee_amount bigint not null default 0;

comment on column public.credits.service_fee_amount is
  'El cargo por servicio que pagó QUIEN COMPRÓ el regalo, ya sumado DENTRO de amount. Se guarda aparte solo para poder contarlo: amount − service_fee_amount es el precio del tutor. 0 en los créditos de referido (los pone la casa) y en todo lo anterior al 16-sep-2026.';


-- ── 2 · Quién lo mantiene ───────────────────────────────────────────────────

create or replace function public.credits_cargo_por_servicio()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_cargo bigint;
begin
  -- Solo al NACER un regalo. `amount` de un crédito no se reescribe nunca
  -- después (lo que se gasta vive en `consumed_amount`), así que no hay caso de
  -- update que mantener — y si algún día lo hubiera, es mejor que salte a la
  -- vista que que este trigger lo tape.
  if new.source <> 'gift' then
    return new;
  end if;

  -- 🔴 EL MISMO 5 % QUE EL DE `payments`, y por la misma función: si algún día
  --    se cambia, se cambia en `cargo_por_servicio` y en la constante del
  --    trigger de `payments`. `npm run check:cargo` vigila que el número del SQL
  --    y el del navegador no se separen.
  --
  -- La base es el precio entero: un regalo no se financia con otro crédito, un
  -- regalo ES el crédito (`/api/pagos/checkout:779`), así que aquí no hay nada
  -- que restarle.
  v_cargo := public.cargo_por_servicio(new.amount, 5.00);

  new.service_fee_amount := v_cargo;
  new.amount             := new.amount + v_cargo;

  return new;
end;
$fn$;

comment on function public.credits_cargo_por_servicio() is
  'Mete el cargo por servicio dentro de credits.amount al comprar un regalo. Existe para no reescribir comprar_regalo, marcar_cobro_regalo_abierto, confirm_gift_payment ni el Route Handler del checkout, que hablan todos de credits.amount y siguen siendo correctos tal cual. Solo source=gift: los créditos de referido los pone la casa y no llevan cargo.';

-- ⚠️ SOLO `before insert`, sin `update`: es lo que hace que el cargo no se pueda
--    acumular por recálculo. Un regalo se cobra una vez y su `amount` no cambia.
--
-- ⚠️ Y va antes que `credits_set_updated_at` (`20260912110000:401`) por orden
--    alfabético, que es lo que queremos: primero el importe, luego la marca.
drop trigger if exists credits_cargo_por_servicio on public.credits;
create trigger credits_cargo_por_servicio
  before insert on public.credits
  for each row execute function public.credits_cargo_por_servicio();


-- ── 3 · Grants ──────────────────────────────────────────────────────────────
--
-- Ninguno. No hay tabla nueva: la columna hereda los de `credits` y el trigger
-- corre con los privilegios del dueño, no con los de quien inserta. La regla de
-- oro 9 no se dispara aquí — y sigue valiendo lo de `20260912110000:455`: a
-- `service_role` no se le da NADA más que `select` sobre `credits`.
