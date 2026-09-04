-- ============================================================================
-- Enséñame Ya — los rieles atados a un balance van PRIMERO, o no van nunca
--
-- 🔴 EL BUG: STRIPE ERA INALCANZABLE EN LOS 18 PAÍSES QUE LO LISTABAN.
--
-- `payoutProviderFor` recorre `payout_providers` en orden y se queda con el
-- primer candidato que (a) puede pagar hoy y (b) pasa la puerta del balance.
-- PayPal cumple SIEMPRE las dos: tiene adaptador y `ataduraDeBalance = false`,
-- porque se fondea desde nuestro banco y no depende de quién cobró.
--
-- Así que un riel atado colocado DESPUÉS de PayPal no se elige jamás. No es que
-- se elija poco: es inalcanzable, y en silencio. El adaptador de Stripe Connect
-- se escribió el 4-sep y el enrutador no lo habría llamado ni una vez.
--
-- ── LA REGLA, Y POR QUÉ ES LA CORRECTA Y NO SOLO LA QUE DESATASCA ──────────
--
-- Un riel ATADO solo puede pagar el dinero que él mismo cobró. O sea que
-- ponerlo primero **no le quita el turno a nadie**: si el dinero no está en su
-- balance, la puerta lo descarta y pasa al siguiente en la misma pasada.
--
-- Y cuando sí está, es la mejor opción disponible: el dinero YA ESTÁ AHÍ. Pagar
-- por un riel fondeado aparte obliga a adelantar ese importe desde nuestro banco
-- mientras el saldo del PSP que cobró sigue creciendo sin usarse. Eso es coste
-- de tesorería puro, invisible en la contabilidad y real en la caja.
--
--     atado primero  → «paga con lo que ya cobraste, y si no cobraste, aparta»
--     atado después  → «no pagues nunca» (lo que había)
--
-- ── BRASIL SALE DE LA LISTA DE STRIPE ──────────────────────────────────────
--
-- Medido el 4-sep-2026: `POST /v1/accounts` con acuerdo *recipient* y
-- `country=BR` devuelve 400 — «The recipient ToS agreement is not supported for
-- platforms in US creating accounts in BR». Dejarlo listado sería peor que
-- inútil: con el cobro entrado por Stripe, el enrutador elegiría Stripe, el
-- tutor no podría darse de alta nunca y su orden se quedaría esperando un alta
-- imposible en vez de irse por PayPal.
--
-- Venezuela ya no lo lista y así se queda: Stripe no la admite por ningún lado.
-- ============================================================================

with intencion(payee_country, payout_providers) as (
  values
    -- dLocal paga aquí, y Stripe también: los dos atados, en orden de
    -- preferencia. Quien haya cobrado se lleva el payout; el otro se aparta.
    ('AR', array['dlocal','stripe','paypal','wise']),
    ('CL', array['dlocal','stripe','paypal','wise']),
    ('EC', array['dlocal','stripe','paypal','wise']),
    ('MX', array['dlocal','stripe','paypal','wise']),
    ('PE', array['dlocal','stripe','paypal','wise']),
    ('PY', array['dlocal','stripe','paypal','wise']),
    ('UY', array['dlocal','stripe','paypal','wise']),
    -- 🔴 Brasil sin Stripe: Connect no admite cuentas *recipient* brasileñas
    -- desde una plataforma estadounidense.
    ('BR', array['dlocal','paypal','wise']),
    -- dLocal NO paga en estos diez, así que el único atado es Stripe.
    ('CO', array['stripe','wise','paypal']),
    ('BO', array['stripe','paypal','wise']),
    ('CR', array['stripe','paypal','wise']),
    ('DO', array['stripe','paypal','wise']),
    ('GT', array['stripe','paypal','wise']),
    ('PA', array['stripe','paypal','wise']),
    ('ID', array['stripe','paypal','wise']),
    ('KE', array['stripe','paypal','wise']),
    ('MY', array['stripe','paypal','wise']),
    ('NG', array['stripe','paypal','wise'])
)
update public.payment_routing_rules r
   set payout_providers = i.payout_providers
  from intencion i
 where r.payee_country = i.payee_country
   and not r.es_por_defecto
   and r.payout_providers is distinct from i.payout_providers;

-- ════════════════════════════════════════════════════════════════════════════
-- LA INVARIANTE — la que habría impedido este bug
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ningún riel atado a un balance puede ir detrás de uno fondeado aparte. Si va
-- detrás, no se elige nunca.
--
-- ⚠️ Las dos listas de abajo repiten `ataduraDeBalance` de `lib/payments.ts`, y
-- es a sabiendas: una migración no puede importar TypeScript. Son cinco claves
-- y la de al lado tiene su comentario; el día que aparezca un riel nuevo, esto
-- hay que tocarlo. Lo que se gana a cambio es que el orden malo no se pueda
-- guardar, ni aquí ni en producción.

do $$
declare
  v_atados    constant text[] := array['dlocal', 'stripe'];
  v_fondeados constant text[] := array['paypal', 'wise', 'manual', 'banco-manual'];
  v_malas     text;
begin
  select string_agg(format('%s (%s)', payee_country, array_to_string(payout_providers, '>')), ', ')
    into v_malas
    from public.payment_routing_rules r
   where r.is_active
     and exists (
       select 1
         from unnest(r.payout_providers) with ordinality a(clave, pos)
         join unnest(r.payout_providers) with ordinality b(clave, pos) on b.pos < a.pos
        where a.clave = any (v_atados)
          and b.clave = any (v_fondeados)
     );

  if v_malas is not null then
    raise exception
      'riel atado a un balance detrás de uno fondeado aparte: %. Nunca se elegiría — ver payoutProviderFor',
      v_malas;
  end if;
end $$;
