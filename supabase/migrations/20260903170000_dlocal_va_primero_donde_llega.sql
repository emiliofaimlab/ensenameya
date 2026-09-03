-- ============================================================================
-- Enséñame Ya — dLocal va PRIMERO donde llega. Colombia se da la vuelta.
--
-- ── LA REGLA, TAL COMO LA FIJÓ EL CLIENTE (3-sep-2026) ──────────────────────
--
--   «dLocal está por encima de Stripe donde esté disponible —países de LATAM
--    principalmente—, si no, Stripe. Eso es regla.»
--
-- Es una regla GENERAL, y por eso esta migración existe: `20260903140000`
-- sembró Colombia con `{stripe, dlocal}` porque el enunciado por regiones
-- decía «Stripe siempre» para Colombia y Venezuela. La regla general manda, y
-- donde chocan gana la general.
--
-- ── A QUIÉN AFECTA DE VERDAD ────────────────────────────────────────────────
--
--   COLOMBIA  → SE DA LA VUELTA. dLocal SÍ cobra en Colombia (es uno de sus
--               mercados principales; lo que no cubre es el PAYOUT, y por eso
--               `payout_providers` no se toca aquí).
--   VENEZUELA → NO CAMBIA, y no es una excepción a la regla: es la regla. dLocal
--               no cubre Venezuela para NADA —ni cobros ni payouts—, así que
--               «donde esté disponible» ahí significa Stripe. La fila conserva
--               dLocal detrás como respaldo, que es lo que pidió el enunciado
--               por regiones y la regla general no contradice.
--   LOS OCHO  → ya estaban `{dlocal, stripe}`. No se tocan.
--   SIN PAÍS  → sigue `{stripe}`: no es una región, es «aún no sabemos de dónde
--               es este tutor».
--
-- ── ⚠️ Y SIGUE SIN ENCENDER UN PSP EN PRODUCCIÓN ───────────────────────────
--
-- El criterio de `20260901140000` no se rompe. Colombia NO se pone a dLocal a
-- pelo: se rutea **como ya estén ruteados en ESTE ambiente los países que dLocal
-- cubre**, o sea copiando el primer proveedor de la fila de México. Así:
--
--   · en dev, donde los ocho ya cobran por dLocal → Colombia pasa a
--     `{dlocal, stripe}` y la regla queda cumplida;
--   · en producción, donde los ocho siguen en Stripe porque la cuenta de dLocal
--     está RECHAZADA → Colombia se queda `{stripe, dlocal}` y el checkout no se
--     rompe.
--
-- El día que se apruebe la cuenta de producción, el mismo UPDATE que voltee los
-- los ocho voltea Colombia:
--
--   update public.payment_routing_rules
--      set charge_providers = array['dlocal','stripe']
--    where payee_country in ('AR','BR','CL','CO','EC','MX','PE','PY','UY');
-- ============================================================================

update public.payment_routing_rules co
   set charge_providers = mx.charge_providers
  from public.payment_routing_rules mx
 where co.payee_country = 'CO'
   and mx.payee_country = 'MX'
   and mx.payer_country is null
   and co.charge_providers is distinct from mx.charge_providers;

do $$
declare
  v_co text[];
  v_mx text[];
  v_ve text[];
begin
  select charge_providers into v_co from public.payment_routing_rules where payee_country = 'CO';
  select charge_providers into v_mx from public.payment_routing_rules where payee_country = 'MX';
  select charge_providers into v_ve from public.payment_routing_rules where payee_country = 'VE';

  -- Colombia se rutea como los países que dLocal cubre EN ESTE AMBIENTE.
  if v_co is distinct from v_mx then
    raise exception 'CO quedó en % y los países de dLocal en % — tenían que coincidir',
      array_to_string(v_co, ','), array_to_string(v_mx, ',');
  end if;

  -- Venezuela NO puede llevar dLocal delante: dLocal no cubre Venezuela, así que
  -- ahí no hay nada que voltear.
  --
  -- ⚠️ AQUÍ SE EXIGÍA `v_ve[1] = 'stripe'` Y ESO ES ESTADO DE DEV. Tumbó el
  -- despliegue a producción el 3-sep-2026, porque allí VE cobra por
  -- **'simulated'** — y los ocho países de dLocal también. El CLAUDE.md decía
  -- que prod cobraba por Stripe y era falso; prod es un *coming soon* y nunca
  -- tuvo pasarela real en esas filas.
  --
  -- La invariante que esta migración protege no es «VE usa Stripe», es «VE no
  -- usa dLocal». Escribirla como una igualdad convertía un ambiente legítimo en
  -- un error, y encima abortaba las seis migraciones siguientes.
  if v_ve[1] = 'dlocal' then
    raise exception 'VE no puede tener dLocal delante: dLocal no cubre Venezuela';
  end if;

  -- Y el payout de Colombia no se ha tocado: dLocal cobra allí pero NO paga.
  if not exists (
    select 1 from public.payment_routing_rules
     where payee_country = 'CO'
       and payout_providers = array['wise', 'paypal', 'stripe', 'banco-manual']
  ) then
    raise exception 'se tocó el payout de Colombia, y esta migración es solo del cobro';
  end if;

  raise notice 'CO cobra por % (como los de dLocal). VE sigue por %.',
    array_to_string(v_co, ' → '), array_to_string(v_ve, ' → ');
end $$;
