-- ============================================================================
-- Enséñame Ya — Colombia se quedó sin el respaldo de cobro que le tocaba.
--
-- `20260903140000` sembró la fila de Colombia copiando `charge_providers` de la
-- fila «sin país declarado», con el criterio correcto —no encender un PSP desde
-- una migración, ver `20260901140000`— pero eligiendo mal la fuente: esa fila es
-- la ÚNICA a la que esa misma migración le quitó el respaldo a propósito («no es
-- una región de la decisión, es todavía no sabemos de dónde es este tutor»).
--
-- Resultado: Colombia quedó con `{stripe}` cuando la decisión del cliente dice
-- «Stripe SIEMPRE; si no está disponible, dLocal». Sin el segundo elemento, el
-- respaldo del checkout no tiene a dónde caerse y un alumno se queda sin poder
-- comprar si Stripe falla.
--
-- Se corrige poniendo el respaldo detrás SIN tocar el primero, que es el que
-- decide quién cobra hoy en cada ambiente. Añadir 'dlocal' como SEGUNDO no
-- enciende nada: solo existe para el caso en que el primero no esté disponible,
-- y el resolvedor de `src/lib/payments.ts` lo descarta si le falta la credencial
-- — que es exactamente lo que pasa hoy en producción, donde la cuenta de dLocal
-- está rechazada.
-- ============================================================================

update public.payment_routing_rules
   set charge_providers = charge_providers || array['dlocal']
 where payee_country = 'CO'
   and not (charge_providers && array['dlocal']::text[]);

do $$
declare v text[];
begin
  select charge_providers into v
    from public.payment_routing_rules where payee_country = 'CO';

  -- El primero NO se toca: es el proveedor que cobra hoy en este ambiente.
  if v[1] <> 'stripe' then
    raise exception 'CO: el primer proveedor de cobro debería seguir siendo stripe y es %', v[1];
  end if;
  if not (v && array['dlocal']::text[]) then
    raise exception 'CO: sigue sin respaldo de cobro (%)', array_to_string(v, ',');
  end if;
  if cardinality(v) <> 2 then
    raise exception 'CO: se esperaban 2 proveedores de cobro y hay % (%)', cardinality(v), array_to_string(v, ',');
  end if;

  -- Y que no se haya duplicado al re-aplicar: el `where` lo evita, pero el
  -- `||` sobre un array es el tipo de operación que se ejecuta dos veces sin
  -- que nadie lo note.
  if exists (
    select 1 from public.payment_routing_rules
     where cardinality(charge_providers) <> cardinality(array(select distinct unnest(charge_providers)))
  ) then
    raise exception 'alguna fila tiene proveedores de cobro repetidos';
  end if;

  raise notice 'CO: cobro stripe → dlocal.';
end $$;
