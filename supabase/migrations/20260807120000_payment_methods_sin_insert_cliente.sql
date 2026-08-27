-- ============================================================================
-- Enséñame Ya — PAC-02: el navegador deja de fabricar tokens de tarjeta
--
-- `payment_methods` nació con `grant select, insert, delete … to authenticated`
-- (20260709200000:34) porque el card-on-file era simulado: la pantalla `/pagos`
-- insertaba la fila DESDE EL NAVEGADOR con `provider='simulated'` y un
-- `provider_token` inventado con `crypto.randomUUID()`.
--
-- Con Stripe vivo eso no puede quedarse. Un token de medio de pago lo emite el
-- proveedor y nadie más; dejar que el cliente escriba filas en la tabla de
-- medios de pago es, como mínimo, dejar que se ensucie con datos que no
-- corresponden a nada, y en el peor caso que alguien plante un `provider_token`
-- de otra persona.
--
-- A partir de aquí la fuente de verdad de las tarjetas de Stripe **es Stripe**:
-- `/pagos` las lista con `customers.listPaymentMethods` y el guardado ocurre en
-- el propio checkout alojado (`setup_future_usage`), que es donde la persona
-- escribe la tarjeta y donde da su consentimiento.
--
-- Se conservan `select` y `delete` a propósito: quedan filas simuladas de las
-- pruebas y el dueño tiene que poder verlas y quitárselas de encima. Lo que no
-- puede es crear ninguna nueva.
--
-- La tabla NO se borra: el proyecto es multi-proveedor por diseño (RN-16) y el
-- día que entre DLocal hará falta un sitio propio para lo que su API no liste.
-- ============================================================================

revoke insert on public.payment_methods from authenticated;

comment on table public.payment_methods is
  'PAC-02: para Stripe la fuente de verdad es Stripe (se listan por API). Aquí solo quedan filas heredadas del proveedor simulado y, en el futuro, medios de proveedores que no expongan listado. El cliente NO puede insertar.';
