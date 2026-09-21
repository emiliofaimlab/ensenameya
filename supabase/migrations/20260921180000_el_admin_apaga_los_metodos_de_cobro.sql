-- ============================================================================
-- Enséñame Ya — el admin puede apagar un método de cobro desde el panel.
--
-- ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
--
-- 21-sep-2026. El disparador es PayPal: su app de producción está pendiente de
-- aprobación, así que «Conectar PayPal» lleva a una pantalla de error para
-- CUALQUIER tutor, y el cliente pidió esconder esa tarjeta mientras tanto.
--
-- Pero el arreglo no es «esconder PayPal»: es que apagar un método deje de
-- necesitarnos. Lo dice el propio `comment on column` de `is_active`, escrito
-- el 2-sep y pensado para Binance:
--
--   «Apagar un canal es un UPDATE, no una migración. […] El día que Legal diga
--    que no, esto se pone a false y el canal desaparece del formulario sin
--    tocar una fila de nadie.»
--
-- Es decir: el interruptor existe desde el primer día y funciona
-- —`metodosDelPais` recorre `canalesActivos`, y un canal apagado no entra en
-- esa lista, así que su tarjeta no se pinta—. Lo que faltaba era quién lo
-- aprieta. Hasta hoy, alguien con acceso a la base.
--
-- ── LO ÚNICO QUE HACE ESTA MIGRACIÓN ────────────────────────────────────────
--
-- Dos `grant` para que el Route Handler del panel pueda escribir. Nada de
-- esquema, nada de datos: los cinco canales siguen donde estaban y con el
-- valor que tuvieran.
--
-- ⚠️ REGLA DE ORO 9, que aquí no es teórica. `20260902110000` dejó escrito que
-- `service_role` NO recibe grants sobre esta tabla, y con razón para entonces:
-- «quien lee este catálogo del lado servidor son los tres RPC de abajo, que son
-- security definer y corren como su dueño». Ahora hay un cuarto lector que no
-- es una RPC —`/api/admin/metodos-de-cobro/[channel]`— y sin estas dos líneas
-- se comería un `permission denied` EN TIEMPO DE EJECUCIÓN: ni el build ni el
-- typecheck lo ven, solo se descubre pulsando el interruptor.
--
-- ⚠️ Y `update` POR COLUMNA, no a secas. Lo único que decide el panel es si el
-- método se ofrece; la etiqueta, la ayuda y —sobre todo— `handle_pattern`, que
-- es la regex con la que se valida el identificador del tutor, no se tocan
-- desde una pantalla. Un `grant update` entero convertiría un formulario de dos
-- casillas en la puerta para dejar sin cobrar a un canal completo.
--
-- La lectura sigue siendo de `authenticated` (política `_select_auth`), y el
-- panel lee con la sesión del admin, no con `service_role`.
-- ============================================================================

grant select              on public.payout_manual_channels to service_role;
grant update (is_active)  on public.payout_manual_channels to service_role;

-- Se reescribe el comentario de la columna: lo que decía sigue siendo verdad,
-- pero ya no hay que entrar a la base para hacerlo.
comment on column public.payout_manual_channels.is_active is
  'Si este canal se ofrece o no. Apagarlo NO borra nada: los destinos que los tutores ya tengan guardados siguen en su sitio, solo deja de pintarse la tarjeta (metodosDelPais no lo mete en canalesActivos). Desde el 21-sep-2026 lo cambia el admin desde /admin/metodos-de-cobro; antes había que entrar a la base. Los dos casos que lo motivaron: Binance, que docs/PAGOS-Y-PAYOUTS.md §4 deja «solo a petición» porque enviar USDT desde wallet propia es transmisión de dinero sin licencia (Fla. Stat. §560.103), y PayPal, cuya app de producción sigue pendiente de aprobación.';
