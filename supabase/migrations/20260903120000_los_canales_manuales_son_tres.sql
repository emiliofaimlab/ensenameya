-- ============================================================================
-- Enséñame Ya — los canales manuales son TRES, no cinco.
--
-- ── LA DECISIÓN ─────────────────────────────────────────────────────────────
--
-- Decisión del cliente del 3-sep-2026, respondiendo a la pregunta 4 de
-- `docs/PAGOS-Y-PAYOUTS.md` §10: los canales de cobro manual de Venezuela son
-- **Zinli, Binance y Zelle**. PayPal y Airtm NO son canales manuales: el
-- documento los clasifica como rieles AUTOMÁTICOS (§4), y el catálogo los
-- sembró como manuales solo porque `20260902110000` se escribió el día en que
-- se decidió no programar adaptadores sin cuenta.
--
-- O sea que esta migración no cambia de opinión sobre nada: alinea el catálogo
-- con la taxonomía que el documento ya tenía.
--
-- ── ⚠️ LO QUE HAY QUE ACEPTAR A SABIENDAS ───────────────────────────────────
--
-- PayPal es, con diferencia, la cuenta en dólares más extendida entre los
-- tutores venezolanos. A partir de aquí, un tutor cuya única forma de recibir
-- sea PayPal **no puede declarar ningún destino**: verá tres canales y ninguno
-- le sirve. No hay pantalla que lo explique porque no hay nada que ofrecerle.
--
-- No se resuelve apagando o encendiendo esta fila, se resuelve automatizando
-- PayPal — que exige la cuenta y la prueba de que admite destinatarios
-- venezolanos (§9 del documento, «lo primero que hay que probar»).
--
-- Y por eso NO se borran las filas: se marcan inactivas. `is_active = true`
-- vuelve a abrirlas con un UPDATE de una línea el día que haga falta, sin
-- migración y sin desplegar. Los destinos ya registrados por algún tutor **no
-- se tocan**: `manual_destination()` devuelve `is_active` justamente para que
-- el admin vea «este tutor registró PayPal y ese canal está cerrado» en vez de
-- encontrarse un tutor que parece no haber registrado nada.
--
-- ponytail: el techo es que la elección del canal la limita un dato y no una
-- regla. Si mañana hay que abrir PayPal solo para los tutores que ya lo tenían,
-- eso sí pide código; hoy no hace falta y no se escribe.
-- ============================================================================

update public.payout_manual_channels
   set is_active = false
 where channel in ('paypal', 'airtm');

-- ── Autocomprobación: que el catálogo diga lo que esta migración decide ─────
do $$
declare
  v_activos text;
  v_apagados int;
begin
  select string_agg(channel, ', ' order by sort_order)
    into v_activos
    from public.payout_manual_channels
   where is_active;

  if v_activos is distinct from 'zinli, binance, zelle' then
    raise exception 'los canales manuales activos deberían ser «zinli, binance, zelle» y son «%»', coalesce(v_activos, '(ninguno)');
  end if;

  -- Las filas NO se borran: apagarlas es reversible, borrarlas no.
  select count(*) into v_apagados
    from public.payout_manual_channels
   where channel in ('paypal', 'airtm');
  if v_apagados <> 2 then
    raise exception 'las filas de paypal y airtm tienen que seguir existiendo, apagadas: hay %', v_apagados;
  end if;

  raise notice 'canales manuales: zinli, binance, zelle. paypal y airtm apagados, no borrados.';
end $$;

-- ⚠️ Los destinos ya registrados con un canal apagado siguen ahí a propósito.
-- Para verlos:
--   select d.tutor_id, d.channel, c.is_active
--     from public.tutor_manual_payout_destinations d
--     join public.payout_manual_channels c using (channel)
--    where not c.is_active;
