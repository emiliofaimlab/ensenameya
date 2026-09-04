-- ============================================================================
-- Enséñame Ya — la lista de países, medida contra dLocal en vez de deducida
--
-- La regla del cliente es «dLocal SIEMPRE donde aplique; donde no, Stripe», y
-- la tabla no la cumplía en tres sitios distintos. El dato con el que se
-- corrige NO sale de la documentación de dLocal ni de este repositorio: sale de
-- llamar a `POST /v1/payments` de su sandbox con 47 países y mirar cuáles
-- acepta (4-sep-2026, cuenta ya aprobada en sandbox y producción).
--
--   ✅ 200 en 18 países, todos en USD:
--      AR BO BR CL CO CR DO EC GT MX PA PE PY UY  ·  ID KE MY NG
--   ❌ 400 `5000 The 'country' is invalid or unsupported`:
--      VE SV NI HN JM TT y todo Europa/Asia/África fuera de las cuatro de arriba
--   ❌ 400 `5010 Payment Method not available`: US, ES, PH — el país lo conoce,
--      pero no ofrece con qué pagar. A efectos de ruteo es lo mismo que un no.
--
-- ⚠️ Cobrar y pagar NO son la misma lista, y por eso las columnas van
-- separadas. dLocal paga en OCHO (AR BR CL EC MX PE PY UY); cobra en dieciocho.
-- En los diez que cobra y no paga el payout va por PayPal, que se fondea desde
-- nuestro banco y no está atado al balance de quien cobró (`ataduraDeBalance`
-- en `lib/payments.ts`). Sin esa asimetría el dinero se quedaría dentro de
-- dLocal.
--
-- ── LOS TRES ARREGLOS ──────────────────────────────────────────────────────
--
-- 1 · NUEVE PAÍSES SIN FILA en los que dLocal sí cobra. No es que no se
--     pudieran vender —desde `20260903190000` caen en la fila por defecto—,
--     es que la fila por defecto cobra por Stripe: se estaba pagando la tarifa
--     internacional de Stripe en nueve países donde dLocal cobra local.
--
-- 2 · COLOMBIA TENÍA EL ORDEN AL REVÉS (`{stripe, dlocal}`). dLocal cubre CO
--     —medido, 200— así que la regla dice que va primero. Su payout no cambia:
--     dLocal no paga en Colombia.
--
-- 3 · VENEZUELA LLEVABA `dlocal` DE RESPALDO Y ES IMPOSIBLE. Medido hoy: 400.
--     Era un candidato que solo podía perder tiempo y, si su 400 se clasificara
--     como `en-duda`, dejar al alumno sin comprar por un proveedor que nunca
--     iba a poder cobrarle. `docs/PAGOS-Y-PAYOUTS.md` §9 ya lo decía y la tabla
--     no se había enterado.
--
-- ⚠️ La autocomprobación del final NO afirma el estado de ningún ambiente —esa
-- es la que tumbó el despliegue a prod el 3-sep— sino la invariante que esta
-- migración protege: nadie puede tener `dlocal` como cobrador si dLocal no
-- cobra en su país. Si mañana dLocal abre un país, falla y se actualiza aquí,
-- que es donde debe estar escrito.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · LOS NUEVE QUE FALTABAN
-- ════════════════════════════════════════════════════════════════════════════
--
-- `payout_providers` es el mismo en los nueve porque dLocal no paga en ninguno:
-- PayPal (único con adaptador hoy), Wise cuando tenga credenciales, y Stripe
-- por si el cobro entró por Stripe — que es cuando su payout directo podría
-- ejecutarse sin cruzar balances.

insert into public.payment_routing_rules
  (payee_country, payer_country, charge_providers, payout_providers,
   priority, is_active, es_por_defecto, notes)
values
  ('BO', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Bolivia. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('CR', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Costa Rica. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('DO', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'República Dominicana. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('GT', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Guatemala. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('PA', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Panamá. dLocal cobra en USD (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('ID', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Indonesia. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('KE', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Kenia. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('MY', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Malasia. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.'),
  ('NG', null, array['dlocal', 'stripe'], array['paypal', 'wise', 'stripe'], 100, true, false,
   'Nigeria. dLocal cobra (medido 4-sep-2026) y no paga: payout por PayPal.')
on conflict do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · COLOMBIA: dLOCAL PRIMERO
-- ════════════════════════════════════════════════════════════════════════════

update public.payment_routing_rules
   set charge_providers = array['dlocal', 'stripe']
 where payee_country = 'CO' and not es_por_defecto;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · VENEZUELA: FUERA dLOCAL DE LA CADENA DE COBRO
-- ════════════════════════════════════════════════════════════════════════════

update public.payment_routing_rules
   set charge_providers = array_remove(charge_providers, 'dlocal')
 where payee_country = 'VE' and not es_por_defecto;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · LA INVARIANTE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Nadie cobra por dLocal en un país donde dLocal no cobra. Es la única cosa que
-- esta migración garantiza y no depende del ambiente: la lista de la izquierda
-- es la medición, no la configuración de dev.

do $$
declare
  v_cubre constant text[] := array[
    'AR','BO','BR','CL','CO','CR','DO','EC','GT','MX','PA','PE','PY','UY',
    'ID','KE','MY','NG'
  ];
  v_malas text;
begin
  select string_agg(payee_country, ', ' order by payee_country) into v_malas
    from public.payment_routing_rules
   where is_active
     and 'dlocal' = any (charge_providers)
     and payee_country is not null
     and not (payee_country = any (v_cubre));

  if v_malas is not null then
    raise exception 'dlocal no cobra en: % — quítalo de charge_providers o corrige la lista medida', v_malas;
  end if;
end $$;
