-- ============================================================================
-- Enséñame Ya — PayPal deja de ser solo el que paga, y también cobra
--
-- ── QUÉ PIDIÓ EL CLIENTE ───────────────────────────────────────────────────
--
-- Que en el checkout el alumno elija entre tarjeta y PayPal. Esta migración es
-- la MITAD DE ABAJO de eso: sin ella el radio miente, porque `set_charge_provider`
-- —la única puerta por la que el Route Handler puede mover `payments.provider`—
-- valida contra `ruta_de_pago(payer_country).charge_providers` y rechaza lo que
-- no esté en esa lista. El alumno pulsaría «PayPal» y cobraría Stripe.
--
-- ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR ESTO (sandbox, 15-sep-2026) ──────────
--
-- Ni una línea de aquí sale de la documentación sola. Con las claves que YA
-- están en `.env.local` —las mismas del payout, sin pedir nada a PayPal—:
--
--   · `POST /v2/checkout/orders` (12,00 USD) → 200, `PAYER_ACTION_REQUIRED`,
--     con su enlace `checkoutnow?token=…`. O sea que la cuenta cobra HOY.
--   · La misma llamada con el mismo `PayPal-Request-Id` → **el mismo id de
--     orden**. PayPal deduplica de verdad, al revés que dLocal Go.
--
-- Y en el panel de la app LIVE (`Ensename Ya`): `Payment links and buttons` ✅ y
-- `Payouts` ✅. Lo que allí está apagado —campos de tarjeta de PayPal (ACDC),
-- Apple/Google Pay, Fastlane, vault de PayPal/Venmo— no lo toca este camino: la
-- tarjeta sigue entrando por Stripe o dLocal y de PayPal solo se usa su botón.
-- ⚠️ En SANDBOX esas cinco cosas están encendidas. Construir apoyándose en
-- ellas funcionaría en dev y se caería en producción, en silencio.
--
-- ── POR QUÉ VA EL ÚLTIMO DE LA LISTA, Y NO EL PRIMERO ──────────────────────
--
-- `create_booking_line` congela `charge_providers[1]` en `payments.provider`, o
-- sea el PRIMER candidato. Añadir PayPal al final deja intacto quién cobra por
-- defecto: la tarjeta, exactamente como hoy. PayPal solo entra cuando el alumno
-- lo elige, y entonces el Route Handler mueve la columna con
-- `set_charge_provider` — que a partir de esta migración le deja.
--
-- Consecuencia buscada: esta migración, SOLA, no cambia el comportamiento de
-- ningún checkout. Es permiso, no ruteo.
--
-- ── POR QUÉ EN TODOS LOS PAÍSES, VENEZUELA INCLUIDA ────────────────────────
--
-- Porque el alcance de PayPal no lo decide esta tabla: lo decide la cuenta con
-- la que paga el alumno, y esa puede ser de un país distinto del suyo. Restringir
-- aquí por país sería inventarnos un mapa que PayPal ya aplica —y aplicaría
-- rechazando el pago, que es un fallo visible— para cambiarlo por uno nuestro
-- que se queda viejo sin que nadie se entere. Y Venezuela es justamente donde
-- una segunda vía vale más: es el único país que hoy cobra por un solo riel.
--
-- ⚠️ Y ESTO ES UNA MIGRACIÓN Y NO UN `UPDATE`, por la regla de oro 5 y por el
-- precedente que la escribió (`20260904190000`): tocar el ruteo a mano es lo que
-- tuvo a dev y prod cobrando distinto durante semanas.
-- ============================================================================

-- ── 1 · el permiso ─────────────────────────────────────────────────────────
--
-- `array_append` sobre las filas que no lo tengan ya. Idempotente por el `where`:
-- correrla dos veces no deja `{…,paypal,paypal}`.
update public.payment_routing_rules
   set charge_providers = array_append(charge_providers, 'paypal')
 where is_active
   and not ('paypal' = any (charge_providers));

-- ── 2 · la autocomprobación ────────────────────────────────────────────────
--
-- ⚠️ AFIRMA LO QUE ESTA MIGRACIÓN ACABA DE ESCRIBIR, NO EL ESTADO DE DEV. Es la
-- lección del 3-sep: una autocomprobación que describe un ambiente levanta
-- excepción en el otro y aborta la corrida entera.
do $$
declare
  v_sin_paypal text;
  v_movidas    text;
begin
  select string_agg(coalesce(payee_country, '(por defecto)'), ', ')
    into v_sin_paypal
    from public.payment_routing_rules
   where is_active and not ('paypal' = any (charge_providers));
  if v_sin_paypal is not null then
    raise exception 'quedan filas activas sin paypal en charge_providers: % — el radio del checkout mentiría ahí', v_sin_paypal;
  end if;

  -- 🔑 LA OTRA MITAD, Y ES LA QUE PROTEGE EL DINERO: que PayPal no se haya
  -- colado al frente de ninguna lista. Si lo estuviera, `create_booking_line`
  -- congelaría 'paypal' en reservas cuyo alumno no eligió nada y el checkout
  -- abriría PayPal por defecto.
  select string_agg(coalesce(payee_country, '(por defecto)'), ', ')
    into v_movidas
    from public.payment_routing_rules
   where is_active and charge_providers[1] = 'paypal';
  if v_movidas is not null then
    raise exception 'paypal quedó el PRIMER candidato en: % — sería el cobro por defecto, y no es lo que se pidió', v_movidas;
  end if;
end $$;

comment on column public.payment_routing_rules.charge_providers is
  'Candidatos de COBRO en orden, resueltos con el país del ALUMNO (dictado del 9-sep-2026). El [1] es el que create_booking_line congela en payments.provider y el que cobra si nadie elige nada; el resto son el respaldo de la cadena del Route Handler Y, desde el 15-sep-2026, lo que el alumno puede elegir a mano en el checkout: set_charge_provider solo deja mover payments.provider a un miembro de esta lista. ⚠️ paypal va SIEMPRE el último a propósito: por delante es el cobro por defecto. Tocar esta columna es una migración, nunca un UPDATE (regla de oro 5).';
