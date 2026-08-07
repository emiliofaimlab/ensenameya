-- ============================================================================
-- Enséñame Ya — EP-20 / PAC-01: lo que el esquema necesita para Stripe
--
-- Dos cosas, y las dos por una razón concreta.
--
-- 1) `profiles.stripe_customer_id`. Sin esto, cada compra crea un Customer
--    nuevo en Stripe. Parece inofensivo y no lo es: la integración de Referral
--    Factory califica al referido siguiendo el **gasto acumulado de UN
--    Customer**. Cinco compras de 20 USD repartidas en cinco Customers nunca
--    llegan al umbral de 100, así que el referidor no cobra jamás y nadie
--    entiende por qué. Un Customer por persona, reutilizado.
--
-- 2) Grants a `service_role` sobre `payments` para estampar la referencia
--    externa. Misma lección que nos dio `sessions` esta misma tarde
--    (`20260806140000`): service_role se salta la RLS pero **no** los grants de
--    tabla, y con auto-expose OFF `payments` no le había concedido nada.
--
--    Se guarda el `pi_…` (PaymentIntent), no el `cs_…` (Session), porque los
--    eventos de reembolso y de disputa traen el PaymentIntent y no la Session.
--    Guardar el id equivocado hoy significa no poder mapear un reembolso mañana.
--
-- Mínimo privilegio en los dos casos: `update` acotado a las columnas que se
-- escriben, no a la tabla.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO: no toca
-- `payment_routing_rules`. Esa fila es el interruptor —`confirm_simulated_payment`
-- exige `payments.provider = 'simulated'` (20260806120000)— y cambiarla antes
-- de que el redirect real funcione deja el checkout muerto para todos. Se toca
-- la última, cuando lo demás esté probado.
-- ============================================================================

-- ── 1) Un Customer de Stripe por persona ────────────────────────────────────
alter table public.profiles
  add column if not exists stripe_customer_id text unique;

comment on column public.profiles.stripe_customer_id is
  'EP-20: Customer de Stripe reutilizado entre compras. Imprescindible para que Referral Factory acumule el gasto del referido en UNA sola ficha.';

-- Lo escribe el servidor al crear la Checkout Session, nunca el cliente.
grant select                          on public.profiles to service_role;
grant update (stripe_customer_id)     on public.profiles to service_role;

-- ── 2) Referencia externa del pago ──────────────────────────────────────────
-- El webhook estampa el PaymentIntent al confirmar el cobro. `confirm_payment`
-- no cambia de firma a propósito: tocarla obliga a un `drop function` y a
-- rehacer `confirm_simulated_payment`, y esto se resuelve con un update de una
-- columna que ya existe desde EP-06.
grant select                                                on public.payments to service_role;
grant update (provider_payment_id, provider_metadata)       on public.payments to service_role;
