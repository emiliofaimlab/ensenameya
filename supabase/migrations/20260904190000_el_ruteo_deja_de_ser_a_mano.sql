-- ============================================================================
-- Enséñame Ya — el ruteo deja de vivir en `UPDATE`s a mano
--
-- ── LA CAUSA RAÍZ, Y NO ES DE PRODUCCIÓN ───────────────────────────────────
--
-- Producción y dev llevan semanas con ruteos distintos, y el motivo no es que a
-- prod le falten migraciones: es que las de dev nunca fueron migraciones.
-- `CLAUDE.md` lo dice con todas las letras —«la fila de `payment_routing_rules`
-- (ya un `UPDATE`, no una migración)»— y eso rompe la regla de oro 5: el
-- esquema, y esta tabla es configuración de plataforma, se versiona en git.
--
-- El resultado medible: en dev los diez países cobran por dLocal o Stripe; en
-- producción, por `simulated`, porque allí nadie ejecutó esos `UPDATE`. No hay
-- forma de alinearlos «aplicando lo que falta»: lo que falta no existe en
-- ningún fichero.
--
-- Esta migración es ese fichero. Declara el ruteo COMPLETO, país por país, en
-- vez de parchear el que hubiera. Es idempotente por construcción: en dev no
-- cambia una sola fila —ya es esto— y en producción la deja igual que dev.
--
-- ⚠️ Y A PARTIR DE AQUÍ, TOCAR EL RUTEO ES UNA MIGRACIÓN. Un `UPDATE` suelto en
-- dev vuelve a abrir exactamente esta brecha, y la brecha no se ve: las dos
-- bases responden, cada una con su respuesta.
--
-- ── LO QUE ESTO SIGNIFICA EN PRODUCCIÓN, DICHO CLARO ───────────────────────
--
-- Producción pasa a tener las mismas pasarelas que dev, y las claves que tiene
-- allí son de *test mode*. `docs/ENTORNOS.md` §3 avisa de esto y el aviso sigue
-- siendo bueno: un cobro de prueba en producción acepta la tarjeta 4242 y no
-- cobra nada. Se hace igual porque **el sitio no está lanzado y no lo conoce
-- nadie** —es la premisa de todo el proyecto hoy— y porque dos bases con
-- configuraciones distintas es lo que ha hecho que una migración escrita contra
-- dev tumbe el despliegue de producción (3-sep, `20260903170000`).
--
-- El interruptor de «cobrar de verdad» no es esta tabla: son las claves de
-- Vercel. Esto solo hace que las dos bases digan lo mismo.
-- ============================================================================

-- ── 1 · los países que rutean por su propia fila ───────────────────────────
--
-- `charge_providers`: dLocal SIEMPRE donde dLocal cobra (medido, §9.1 del doc
-- de pagos), Stripe detrás como respaldo. Venezuela solo Stripe: dLocal no la
-- cubre ni para cobrar ni para pagar.
--
-- `payout_providers`: dLocal primero SOLO en los ocho donde de verdad paga.
-- En los otros diez cobra y no paga, así que abre PayPal — que no está atado al
-- balance de quien cobró y por eso puede pagar lo que entró por dLocal.

with intencion(payee_country, charge_providers, payout_providers) as (
  values
    -- Los OCHO donde dLocal cobra Y paga.
    ('AR', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('BR', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('CL', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('EC', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('MX', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('PE', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('PY', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    ('UY', array['dlocal','stripe'], array['dlocal','paypal','wise','stripe']),
    -- Colombia: dLocal cobra y NO paga («7000 Payout is not enabled for country
    -- CO», medido el 4-sep). Wise va delante por coste, aunque aún no ejecute.
    ('CO', array['dlocal','stripe'], array['wise','paypal','stripe']),
    -- Los otros nueve donde dLocal cobra y no paga.
    ('BO', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('CR', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('DO', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('GT', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('PA', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('ID', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('KE', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('MY', array['dlocal','stripe'], array['paypal','wise','stripe']),
    ('NG', array['dlocal','stripe'], array['paypal','wise','stripe']),
    -- Venezuela: fuera de dLocal por los dos lados. Riel manual al final, que
    -- es el único país donde se paga a mano (decisión del cliente, 3-sep).
    ('VE', array['stripe'],           array['paypal','manual'])
)
update public.payment_routing_rules r
   set charge_providers = i.charge_providers,
       payout_providers = i.payout_providers
  from intencion i
 where r.payee_country = i.payee_country
   and not r.es_por_defecto
   and (r.charge_providers is distinct from i.charge_providers
     or r.payout_providers is distinct from i.payout_providers);

-- ── 2 · el tutor que aún no ha declarado país ──────────────────────────────
-- Cobra por Stripe (deja vender) y NO promete payout: no sabemos a dónde.
update public.payment_routing_rules
   set charge_providers = array['stripe'],
       payout_providers = array['simulated']
 where payee_country is null and not es_por_defecto;

-- ── 3 · la autocomprobación ────────────────────────────────────────────────
--
-- ⚠️ COMPRUEBA LA INVARIANTE, NO EL AMBIENTE. Es la lección del 3-sep: una
-- autocomprobación que afirma el estado de dev levanta excepción en producción
-- y aborta la corrida ENTERA. Aquí lo que se afirma es lo que esta migración
-- acaba de escribir, que es verdad en las dos bases por definición.

do $$
declare
  v_faltan text;
begin
  select string_agg(c, ', ') into v_faltan
    from unnest(array['AR','BO','BR','CL','CO','CR','DO','EC','GT','MX',
                      'PA','PE','PY','UY','ID','KE','MY','NG','VE']) c
   where not exists (
     select 1 from public.payment_routing_rules r
      where r.payee_country = c and r.is_active and not r.es_por_defecto
   );
  if v_faltan is not null then
    raise exception 'sin fila de ruteo activa: % — el país no se puede vender', v_faltan;
  end if;

  if not exists (select 1 from public.payment_routing_rules where es_por_defecto and is_active) then
    raise exception 'no hay fila por defecto: cualquier país sin regla propia deja de venderse';
  end if;
end $$;
