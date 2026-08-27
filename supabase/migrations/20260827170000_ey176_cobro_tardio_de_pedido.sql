-- ============================================================================
-- Enséñame Ya — EY-176 · B3.1 (3 de 3): EL COBRO TARDÍO DE UN PEDIDO
--
-- ── EL SEGUNDO FALLO VERIFICADO DE LA FICHA ─────────────────────────────────
--
-- `late_payment_refunds.provider_payment_id` es `not null unique`
-- (20260817160000:69), y esa unicidad ES la idempotencia de X-02: el webhook la
-- consulta antes de llamar a la API de Stripe, y sin ella una reentrega
-- devolvería el dinero dos veces.
--
-- Con un pedido hay **un solo `pi_` para N líneas**. O sea que:
--   · el cobro tardío de un pedido solo se puede anotar UNA vez — bien, porque
--     solo hay un cargo que devolver;
--   · pero `booking_id` es `not null`, así que no había dónde escribir «esto no
--     fue de una reserva, fue de un pedido»;
--   · y peor: si se anotara con la reserva de la línea 1, el `unique` impediría
--     anotar las otras y el registro contable diría que se devolvió el cargo de
--     una sola mentoría cuando se devolvieron tres.
--
-- ── LA DECISIÓN, Y ES LA MISMA P-1 ──────────────────────────────────────────
--
-- **Un cobro tardío de pedido se devuelve ENTERO, y no se acredita ninguna
-- línea.** Todo o nada, igual que al crearlo. El criterio del webhook pasa de
-- «¿esta reserva sigue esperando el cobro?» a «¿siguen esperándolo TODAS?»: si
-- una sola línea ya no está en `pending_payment`, el pedido no se puede
-- entregar completo y el dinero vuelve entero.
--
-- Y así el `unique` deja de ser un problema y pasa a ser exactamente la
-- garantía que hace falta: **un cargo, un reembolso, una fila.**
--
-- ⚠️ NO CONFUNDIR CON LOS REEMBOLSOS DE POLÍTICA (RN-37 / X-01). Aquellos SÍ
-- son por línea y siguen funcionando solos con este diseño: cada línea tiene su
-- `payments` con su `gross_amount`, `enqueue_refund` topa contra ese techo por
-- pago, y el job manda a Stripe N reembolsos PARCIALES del mismo PaymentIntent.
-- Que eso no colisione depende de un detalle que conviene tener localizado: la
-- clave de idempotencia del job es `x01-reembolso-<refund_requests.id>`
-- (`src/app/api/cron/refunds-process/route.ts`), atada a la FILA de la cola y
-- no al `pi_`. Si algún día alguien la cambiara a algo derivado del
-- PaymentIntent, la segunda línea de un pedido recibiría de Stripe el reembolso
-- cacheado de la primera y su dinero no se movería nunca.
-- ============================================================================


-- ── 1) La fila puede hablar de una reserva o de un pedido, nunca de las dos ─
alter table public.late_payment_refunds
  alter column booking_id drop not null;

alter table public.late_payment_refunds
  add column order_id uuid references public.orders (id) on delete cascade;

alter table public.late_payment_refunds
  add constraint late_payment_refunds_sujeto_chk
  check ( (booking_id is not null) <> (order_id is not null) );

comment on column public.late_payment_refunds.order_id is
  'EY-176: el pedido cuyo cargo llegó tarde. Excluyente con booking_id: un cargo pertenece a una reserva suelta o a un pedido, nunca a las dos.';


-- ── 2) El «por qué» del reembolso, ahora en dos sabores ────────────────────
--
-- `booking_status` era `not null` y es de tipo `booking_status`: para un pedido
-- no hay un valor honesto que poner ahí (sus tres líneas pueden estar en
-- estados distintos). Se hace nullable y se le pone un hermano con el estado
-- del PEDIDO. `reason`, que sigue siendo `not null`, es donde va la frase
-- legible para quien audite esto dentro de seis meses.
alter table public.late_payment_refunds
  alter column booking_status drop not null;

alter table public.late_payment_refunds
  add column order_status public.order_status;

comment on column public.late_payment_refunds.booking_status is
  'Estado de la reserva cuando entró el cobro. Null cuando la fila es de un pedido: ahí manda order_status.';
comment on column public.late_payment_refunds.order_status is
  'EY-176: estado del pedido cuando entró el cobro. Null cuando la fila es de una reserva suelta.';

create index late_payment_refunds_order_idx
  on public.late_payment_refunds (order_id)
  where order_id is not null;


-- ── 3) Grants: nada nuevo, y por qué se repiten ────────────────────────────
--
-- La tabla ya tenía `select` para `authenticated` (la política de admin acota
-- quién) y `select, insert` para `service_role` (regla de oro 9: el webhook
-- escribe aquí con esa credencial). Añadir columnas NO cambia los grants de
-- tabla, así que no hace falta tocarlos — se deja dicho para que nadie los
-- busque. La política `late_payment_refunds_select_admin` tampoco cambia: sigue
-- siendo la única lectura, y el alumno se entera del reembolso por su tarjeta.

comment on table public.late_payment_refunds is
  'X-02 + EY-176: cobros que llegaron cuando ya no se esperaba pago y se devolvieron de verdad contra el PSP. Una fila por cargo (provider_payment_id unique), sea de una reserva suelta o de un pedido entero. Append-only.';
