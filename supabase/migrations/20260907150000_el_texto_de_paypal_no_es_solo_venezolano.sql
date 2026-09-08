-- ============================================================================
-- Enséñame Ya — la ayuda de PayPal deja de hablar solo de Venezuela.
--
-- ── QUÉ SE ROMPIÓ Y CUÁNDO ─────────────────────────────────────────────────
--
-- `payout_manual_channels` es catálogo GLOBAL: no tiene columna de país. Su fila
-- de 'paypal' se escribió el 2-sep-2026 (`20260902110000`) y se reescribió el
-- 3-sep (`20260903210000`) cuando PayPal pasó a ser automático, y las dos veces
-- se redactó para el único país que entonces veía ese formulario — Venezuela.
-- De ahí el paréntesis:
--
--     «Lo que hagas después con el saldo (cambiarlo a bolívares) corre por tu
--      cuenta y a tu tipo de cambio.»
--
-- El 7-sep la pantalla de payouts pasó a pintar VARIAS familias de dato por
-- país, para que un tutor colombiano pudiera registrar sus coordenadas
-- bancarias — sin eso el riel de Wise era inalcanzable justo en el país para el
-- que se escribió. Efecto colateral medido en el render real (`/tutor/payouts`
-- con `payout_country` = 'CO' y 'EC'): el formulario de identificador, y con él
-- esta ayuda, se pinta ahora en los 18 países cuya fila de ruteo nombra a
-- PayPal. A un colombiano y a un ecuatoriano se les habla de bolívares.
--
-- ── QUÉ SE CAMBIA, Y QUÉ NO ────────────────────────────────────────────────
--
-- Solo el paréntesis: «(cambiarlo a bolívares)» → «(cambiarlo a tu moneda)».
-- Lo demás de la frase es verdad en todos los países y no se toca — que se
-- recibe EN DÓLARES, que lo envía el sistema y no una persona, y que la cuenta
-- tiene que estar a nombre del tutor. Ese «en dólares» es lo que hace que el
-- aviso siga teniendo sentido fuera de Venezuela: un tutor colombiano cobra USD
-- en PayPal y el cambio a COP también corre por su cuenta.
--
-- ⚠️ Y ES UNA MIGRACIÓN, NO UN `UPDATE` A MANO (regla de oro 5). El texto que
-- lee el tutor vive en una tabla, pero llegó ahí por migración las dos veces
-- anteriores; cambiarlo por consola dejaría dev y producción diciendo cosas
-- distintas, que es exactamente lo que le pasó a `payment_routing_rules` durante
-- semanas hasta `20260904190000`.
--
-- ponytail: no se añade columna de país a esta tabla. Cinco filas de catálogo y
-- una frase que se puede escribir de forma que valga en los 18 países no
-- justifican un `payout_manual_channel_copy` por país. El día que un canal
-- necesite de verdad texto distinto por país, esa columna se añade entonces.
-- ============================================================================

update public.payout_manual_channels
   set help = 'Recibes en tu saldo de PayPal, en dólares, de forma automática: '
              'lo envía nuestro sistema, no una persona, así que no depende de horarios. '
              'La cuenta tiene que estar a tu nombre. Lo que hagas después con el saldo '
              '(cambiarlo a tu moneda) corre por tu cuenta y a tu tipo de cambio.'
 where channel = 'paypal';
