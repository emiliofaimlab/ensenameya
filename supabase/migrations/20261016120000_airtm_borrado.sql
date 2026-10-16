-- ============================================================================
-- Enséñame Ya — Airtm, borrado para siempre.
--
-- `20260903200000` lo sacó del ruteo y dejó su fila en `payout_manual_channels`
-- apagada «por si de ella colgaban destinos». Decisión de Jose (16-oct-2026):
-- no se usa ni se usará jamás, y la fila seguía pintándose en
-- /admin/metodos-de-cobro como «Oculto». Es el `delete` que aquella cabecera
-- dejó anunciado.
--
-- La FK de `tutor_manual_payout_destinations.channel` no lleva cascada, así que
-- los destinos van primero. `payouts.provider` es `text` sin FK: si algún payout
-- histórico dijera 'airtm' se queda como está —rastro financiero, regla de
-- baja lógica—, pero se cuenta para que no pase desapercibido.
-- ============================================================================

delete from public.tutor_manual_payout_destinations where channel = 'airtm';
delete from public.payout_manual_channels where channel = 'airtm';

do $$
declare n int;
begin
  select count(*) into n from public.payout_manual_channels where channel = 'airtm';
  if n <> 0 then
    raise exception 'airtm sigue en payout_manual_channels';
  end if;

  select count(*) into n from public.payment_routing_rules
   where 'airtm' = any (payout_providers) or 'airtm' = any (charge_providers);
  if n <> 0 then
    raise exception '% filas de ruteo nombran a airtm', n;
  end if;

  select count(*) into n from public.payouts where provider = 'airtm';
  raise notice 'airtm borrado; % payouts históricos lo nombran y se conservan.', n;
end $$;
