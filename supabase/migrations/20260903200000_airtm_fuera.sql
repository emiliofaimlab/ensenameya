-- ============================================================================
-- Enséñame Ya — Airtm fuera. Enséñame Ya es una entidad estadounidense.
--
-- Decisión del cliente (3-sep-2026). No es una preferencia de coste: Airtm era
-- el payout RECOMENDADO de Venezuela por precio ($2,10 sobre $300, 0,70 %) y
-- era además el único camino legal a stablecoin que el documento contemplaba
-- —MSB de FinCEN, §4 de `docs/PAGOS-Y-PAYOUTS.md`—. Se cae igual.
--
-- Consecuencia que hay que aceptar a sabiendas: Venezuela se queda con
-- **PayPal y el riel manual**, y PayPal todavía no tiene adaptador. O sea que
-- hoy Venezuela se paga a mano, exactamente igual que ayer — lo único que
-- cambia es que el primer candidato de su lista ya no existe.
--
-- ponytail: la fila de 'airtm' en `payout_manual_channels` NO se borra. Ya está
-- inactiva desde `20260903120000` y de ella pueden colgar destinos que algún
-- tutor registró; borrarla es romper ese rastro para no ganar nada. Si mañana
-- estorba, un `delete` con su cascada es la línea que hace falta.
-- ============================================================================

update public.payment_routing_rules
   set payout_providers = array_remove(payout_providers, 'airtm')
 where 'airtm' = any (payout_providers);

do $$
declare n int; v text[];
begin
  select count(*) into n from public.payment_routing_rules
   where 'airtm' = any (payout_providers);
  if n <> 0 then
    raise exception '% filas de ruteo siguen nombrando a airtm', n;
  end if;

  -- Venezuela conserva sus dos candidatos, en ese orden: el automático que
  -- algún día existirá y la persona que paga hoy.
  select payout_providers into v from public.ruta_de_pago('VE');
  if v is distinct from array['paypal', 'manual'] then
    raise exception 'Venezuela quedó en % en vez de {paypal, manual}', array_to_string(v, ', ');
  end if;

  -- Y la constraint de lista no vacía sigue contenta en todas partes.
  select count(*) into n from public.payment_routing_rules
   where cardinality(payout_providers) = 0;
  if n <> 0 then
    raise exception '% filas se quedaron sin ningún candidato de payout', n;
  end if;

  raise notice 'airtm fuera del ruteo; Venezuela = {paypal, manual}.';
end $$;
