-- ============================================================================
-- Enséñame Ya — Colombia vuelve a Stripe delante. Revierte 20260903170000.
--
-- `20260903170000` dio la vuelta a Colombia aplicándole la regla general
-- «dLocal por encima de Stripe donde esté disponible». Fue un error de lectura:
-- la especificación del cliente (3-sep-2026) tiene una línea EXPLÍCITA para
-- Colombia y dice lo contrario —
--
--   «para colombia → el checkout debe mostrar stripe como pasarela SIEMPRE,
--    si no está disponible, mostramos dlocal»
--
-- — igual que la de Venezuela. La regla general de dLocal-primero es la de la
-- tercera línea, la del RESTO DEL MUNDO, y esa ya estaba bien aplicada desde
-- `20260903140000`: los ocho países de dLocal cobran `{dlocal, stripe}`.
--
-- O sea que no había nada que corregir, y la corrección fue el error. Se deja
-- escrito porque las dos migraciones quedan en el historial y sin esto la
-- siguiente persona no sabe cuál de las dos leer.
--
-- Lo que manda, y no vuelve a tocarse sin que el cliente lo diga:
--
--   VE  cobro  stripe → dlocal      (explícito)
--   CO  cobro  stripe → dlocal      (explícito)  ← esto restaura
--   ×8  cobro  dlocal → stripe      (regla del resto del mundo)
--   —   cobro  stripe               (sin país declarado)
-- ============================================================================

update public.payment_routing_rules
   set charge_providers = array['stripe', 'dlocal']
 where payee_country = 'CO'
   and charge_providers is distinct from array['stripe', 'dlocal'];

do $$
declare v_co text[]; v_ve text[]; n int;
begin
  select charge_providers into v_co from public.payment_routing_rules where payee_country = 'CO';
  select charge_providers into v_ve from public.payment_routing_rules where payee_country = 'VE';

  if v_co is distinct from array['stripe', 'dlocal'] then
    raise exception 'CO tenía que quedar {stripe,dlocal} y quedó %', array_to_string(v_co, ',');
  end if;
  if v_ve is distinct from array['stripe', 'dlocal'] then
    raise exception 'VE tenía que seguir {stripe,dlocal} y está %', array_to_string(v_ve, ',');
  end if;

  -- Y los ocho SIGUEN COMO ESTUVIERAN: esta migración no los toca.
  --
  -- ⚠️ AQUÍ SE PEDÍA `charge_providers[1] = 'dlocal'` Y ESO ES ESTADO DE DEV.
  -- En producción los ocho cobran por Stripe —la cuenta de dLocal está
  -- rechazada, ver `20260903170000`— así que esta comprobación levantaba
  -- excepción allí y tumbaba el despliegue ENTERO de migraciones, no solo esta.
  -- Es el accidente de `2a5c4ed` otra vez.
  --
  -- Lo que de verdad hay que comprobar es que los ocho sigan COHERENTES entre
  -- sí, que es lo que significa «no los toqué». Cuál sea el proveedor lo decide
  -- el ambiente, y esta migración no opina.
  select count(distinct charge_providers[1]) into n
    from public.payment_routing_rules
   where payee_country in ('AR','BR','CL','EC','MX','PE','PY','UY');
  if n <> 1 then
    raise exception 'los 8 países de dLocal dejaron de cobrar todos por lo mismo (% proveedores distintos)', n;
  end if;

  raise notice 'CO y VE por stripe → dlocal. Los ocho por dlocal → stripe.';
end $$;
