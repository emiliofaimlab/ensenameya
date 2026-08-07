-- ============================================================================
-- Enséñame Ya — `payment_routing_rules`: el interruptor deja de ser inalcanzable
--
-- La tabla que decide QUÉ PROVEEDOR cobra cada reserva no tiene un solo grant:
-- nace con RLS de admin (20260709160000:35-38) pero sin `grant`, así que a
-- través de la Data API no la alcanza nadie — ni el admin. Hasta hoy daba igual,
-- porque el runtime la lee dentro de RPC SECURITY DEFINER, que corren como el
-- dueño y se saltan los grants.
--
-- Deja de dar igual en cuanto hay más de un proveedor. Cambiar de `simulated` a
-- `stripe` —y de vuelta— es una operación de configuración que hoy solo se
-- puede hacer escribiendo una migración, o sea: recompilando el proyecto para
-- cambiar un dato. Eso no es un interruptor, es un despliegue.
--
-- Mínimo privilegio, y aquí importa más que en otras tablas porque esta decide
-- a dónde va el dinero: se conceden `select` y `update` **solo** de las tres
-- columnas que expresan "quién cobra y si la regla está viva". NO se concede
-- `insert` ni `delete`: inventar o borrar un corredor sigue exigiendo una
-- migración revisada, que es donde debe estar esa decisión.
--
-- Sigue sin haber grant para `authenticated` ni `anon`: esto es server-side.
-- ============================================================================

grant select on public.payment_routing_rules to service_role;
grant update (charge_provider, payout_provider, is_active)
  on public.payment_routing_rules to service_role;
