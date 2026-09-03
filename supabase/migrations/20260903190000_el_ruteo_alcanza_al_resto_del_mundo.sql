-- ============================================================================
-- Enséñame Ya — el ruteo alcanza al resto del mundo, deja de pagar a mano
-- fuera de Venezuela, y el respaldo del cobro deja de mentir.
--
-- Tres huecos entre lo que el flujo definitivo dice y lo que el código hacía.
-- Salieron de auditar el diagrama contra la base, uno por uno.
--
-- ── 1 · «FUERA DE VENEZUELA JAMÁS SE PAGA A MANO» ───────────────────────────
--
-- La regla es del cliente (3-sep) y el ruteo la contradecía: Colombia y los
-- ocho de dLocal llevaban `banco-manual` como último candidato. Como ninguno de
-- los anteriores tiene adaptador todavía, una orden colombiana NO se quedaba
-- esperando — caía a un pago a mano, que es justo lo que no debe pasar.
-- Se quita. La consecuencia buscada: esas órdenes esperan en cola hasta que
-- exista Wise, PayPal o el payout de Stripe, y eso es lo correcto.
--
-- ── 2 · «PARA LOS PAÍSES QUE dLOCAL NO CUBRE, STRIPE» ──────────────────────
--
-- No había forma de decirlo. La resolución es una coincidencia EXACTA por
-- `payee_country`, así que un tutor español no tenía fila y su reserva ni
-- siquiera se creaba: `create_booking_line` levantaba «sin ruta de pago
-- disponible». La cuarta fila del flujo definitivo no existía en el código.
--
-- ⚠️ Y LA FILA DEL «SIN PAÍS DECLARADO» NO SERVÍA PARA ESTO, aunque lo parezca.
-- Significan cosas distintas y hay que mantenerlas separadas:
--
--     payee_country IS NULL   «este tutor todavía no ha dicho de dónde es»
--                             → no se le puede pagar: no sabemos a dónde
--     es_por_defecto = true   «este tutor es de un país sin regla propia»
--                             → sí se le puede pagar, por los rieles globales
--
-- Fundirlas dejaría a un tutor español con `payout_providers = {simulated}`,
-- o sea impagable por una razón que no es la suya.
--
-- ── 3 · EL RESPALDO DEL COBRO ESCRIBÍA EN UNA COLUMNA QUE NO PODÍA TOCAR ────
--
-- `payments.provider` significa QUIÉN COBRÓ, y de ella cuelgan dos cosas: de
-- qué saldo sale el pago al tutor, y por dónde se le devuelve el dinero a un
-- alumno. Si el cobro lo abre el segundo candidato de la cadena, esa columna
-- tiene que cambiar — y `service_role` solo tiene
-- `grant update (provider_payment_id, provider_metadata)` (20260806170000:49).
--
-- No se concede `update (provider)` a secas: sería una columna de dinero
-- abierta a cualquier código de servidor. Va por una RPC que solo admite
-- moverla a un proveedor QUE ESTÉ EN LA LISTA DE RUTEO de esa fila y solo
-- mientras el cobro sigue pendiente.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · FUERA DE VENEZUELA NO SE PAGA A MANO
-- ════════════════════════════════════════════════════════════════════════════

update public.payment_routing_rules
   set payout_providers = array_remove(payout_providers, 'banco-manual')
 where 'banco-manual' = any (payout_providers);

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LA FILA POR DEFECTO
-- ════════════════════════════════════════════════════════════════════════════

alter table public.payment_routing_rules
  add column es_por_defecto boolean not null default false;

comment on column public.payment_routing_rules.es_por_defecto is
  'Marca la fila que se usa cuando el país del tutor NO tiene fila propia — la cuarta fila del flujo definitivo, «países que dLocal no cubre». NO es lo mismo que payee_country IS NULL, que significa «el tutor aún no ha declarado país» y por eso se queda sin ejecutor de payout. Solo puede haber una fila por defecto (índice único parcial) y su payee_country es null por construcción: no describe un país, describe a todos los demás.';

-- Solo puede haber una. Dos filas por defecto es una ambigüedad silenciosa
-- resuelta por el orden que decida Postgres.
create unique index payment_routing_rules_una_sola_por_defecto
  on public.payment_routing_rules ((true)) where es_por_defecto;

-- ⚠️ `charge_providers` = {stripe} y NO {stripe, dlocal}: si el país no lo cubre
-- dLocal, ponerlo de respaldo es ofrecer una pasarela que va a rechazar el cobro.
-- El respaldo se añade el día que se sepa a qué países aplica.
--
-- `payout_providers` = {stripe, paypal, wise}, en ese orden y sin dLocal, que no
-- llega a estos países. Stripe primero porque cuando el cobro entró por Stripe
-- es el que cuadra con el saldo; los otros dos no dependen de quién cobró.
-- Los tres son AUTOMÁTICOS. Ninguno tiene adaptador todavía, así que hoy estas
-- órdenes esperan — y eso es exactamente lo previsto, no un fallo.
insert into public.payment_routing_rules
  (payee_country, payer_country, charge_providers, payout_providers,
   priority, is_active, es_por_defecto, notes)
values
  (null, null, array['stripe'], array['stripe', 'paypal', 'wise'],
   900, true, true,
   'FILA POR DEFECTO — cualquier país sin regla propia (España, EE. UU., Europa…). '
   'Cobro por Stripe: dLocal no llega aquí. Payout automático por Stripe, PayPal o Wise '
   'según por dónde entró el pago. NO lleva riel manual: fuera de Venezuela no se paga a mano.');

-- ── EL RESOLVEDOR ──────────────────────────────────────────────────────────
--
-- Un solo sitio decide, y por eso es una función y no un `select` repetido en
-- cada llamador: cuando la regla de desempate vive en cuatro consultas, se
-- desincronizan y el ruteo pasa a depender de cuál se ejecutó.
create or replace function public.ruta_de_pago(p_payee char(2))
returns public.payment_routing_rules
language plpgsql
stable
set search_path = ''
as $$
declare
  r public.payment_routing_rules;
begin
  -- 1) La fila del país, si la tiene. `is not distinct from` para que el null
  --    del tutor sin declarar case con SU fila y con ninguna otra.
  --
  --    ⚠️ `not es_por_defecto` es imprescindible: la fila por defecto TAMBIÉN
  --    tiene `payee_country` a null, así que sin este filtro se llevaría por
  --    delante a la del «sin país declarado» y un tutor que aún no ha dicho de
  --    dónde es pasaría a resolver por los rieles globales. Son dos cosas
  --    distintas y la cabecera de esta migración explica por qué.
  select * into r
    from public.payment_routing_rules
   where is_active and payer_country is null and not es_por_defecto
     and payee_country is not distinct from p_payee
   order by priority
   limit 1;
  if found then
    return r;
  end if;

  -- 2) Y si no la tiene, la de por defecto: «cualquier otro país».
  select * into r
    from public.payment_routing_rules
   where is_active and es_por_defecto
   limit 1;
  return r;   -- null si no hay fila por defecto: base mal configurada
end $$;

comment on function public.ruta_de_pago(char) is
  'La regla de ruteo que aplica a un país: la suya si la tiene, la de por defecto si no. ÚNICO sitio donde vive ese desempate — create_booking_line y los resolvedores de TypeScript la usan, y duplicar la consulta es cómo se desincronizan. Devuelve cero filas solo si no hay fila por defecto activa, que es una base mal configurada.';

revoke execute on function public.ruta_de_pago(char) from public;
grant  execute on function public.ruta_de_pago(char) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · create_booking_line resuelve con la fila por defecto
-- ════════════════════════════════════════════════════════════════════════════
--
-- Copia literal de su versión vigente (20260903160000) con UN cambio: el
-- `select` de la regla pasa a `ruta_de_pago()`. Todo lo demás —el candado por
-- solape, el split congelado, el snapshot de país, las sesiones— va igual.

CREATE OR REPLACE FUNCTION public.create_booking_line(p_student uuid, p_product_id uuid, p_slots timestamp with time zone[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prod     record;
  v_required int;
  v_total    bigint;
  v_split    numeric(5,2);          -- US-1103: lo resuelve el tier del tutor (RN-06)
  v_net      bigint;
  v_fee      bigint;
  v_payee    char(2);               -- Cambio A · lo declara el tutor; null = no lo ha dicho
  v_provider text;
  v_avail    int;
  v_booking  uuid;
  v_slot     timestamptz;
  v_seq      int := 0;
begin
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  -- US-1103 (RN-06): el split lo define el tier del tutor. Sin tier asignado
  -- cae al default; si tampoco hay default se PARA en vez de inventar un número
  -- — es dinero, no un valor cosmético.
  select tt.split_pct into v_split
    from public.tutor_profiles tp
    join public.tutor_tiers tt on tt.id = tp.tier_id
   where tp.profile_id = v_prod.tutor_id;

  if v_split is null then
    select split_pct into v_split from public.tutor_tiers where is_default;
  end if;

  if v_split is null then
    raise exception 'el tutor no tiene tier asignado y no hay tier por defecto'
      using errcode = 'check_violation';
  end if;

  v_required := case when v_prod.pricing_model = 'per_package'
                     then coalesce(v_prod.package_num_sessions, 1) else 1 end;
  if coalesce(array_length(p_slots, 1), 0) <> v_required then
    raise exception 'debes elegir % horario(s)', v_required using errcode = 'check_violation';
  end if;

  -- Cada slot pedido debe seguir disponible (reglas − excepciones − ocupados, S-41).
  --
  -- ⚠️ DENTRO DE UN PEDIDO, ESTA COMPROBACIÓN VE LAS LÍNEAS ANTERIORES. Las N
  -- reservas se crean en la misma transacción, así que al llegar a la línea 2
  -- las `sessions` de la línea 1 ya existen y `get_available_slots` las
  -- descuenta. Es lo correcto —un tutor no da dos clases a la vez— y es lo que
  -- hace que un carrito con dos mentorías del mismo tutor a la misma hora se
  -- caiga aquí en vez de venderse.
  --
  -- ⚠️ LO QUE NO VE, y por eso existe la constraint de exclusión: los slots de
  -- ESTA MISMA llamada. Se validan todos en esta sentencia y se insertan
  -- después, así que un paquete con dos horarios que se pisan entre sí pasa por
  -- aquí sin enterarse. El motor lo corta abajo, en el INSERT.
  select count(*) into v_avail
  from unnest(p_slots) as s(slot)
  where exists (
    select 1 from public.get_available_slots(p_product_id, current_date, current_date + 30) g
    where g.slot_start = s.slot
  );
  if v_avail <> v_required then
    raise exception 'algún horario ya no está disponible' using errcode = 'check_violation';
  end if;

  -- Montos (unidades menores) según modelo (RN-10).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount   -- per_session (1) o per_package (precio del paquete = total)
  end;
  v_net := round(v_total * v_split / 100.0);
  v_fee := v_total - v_net;

  -- Cambio A · A0: el país de cobro sale de quien cobra, no de un literal.
  -- Puede venir null (tutor que aún no lo ha declarado) y eso NO es un error:
  -- es el caso que atiende la fila con `payee_country` null. Lo que se congela
  -- abajo en `bookings`/`payments` es este valor tal cual, null incluido —
  -- escribir 'VE' ahí era inventarle un destino al dinero.
  select tp.payout_country into v_payee
    from public.tutor_profiles tp
   where tp.profile_id = v_prod.tutor_id;

  -- US-701: ruteo por geografía; sin regla activa → bloqueada (RN-33).
  -- Cambio B · `is not distinct from`: el null del tutor casa con la fila del
  -- «sin declarar» y con ninguna otra. Ver el bloque 2 sobre los dos nulls.
  -- ⚠️ `charge_providers[1]`, o sea el PRIMER candidato, y no la lista entera.
  -- Lo que se congela en `payments.provider` significa QUIÉN COBRÓ, y aquí
  -- todavía no ha cobrado nadie: el cobro se abre después, en el Route Handler,
  -- que es el único que puede caerse al segundo de la lista.
  --
  -- Se congela el primero porque es el que va a cobrar en el caso normal, y
  -- quien abra el cobro ACTUALIZA esta columna si acaba cobrando otro. La
  -- alternativa —dejarla null hasta el cobro— rompería todo lo que hoy da por
  -- hecho que una reserva nace con proveedor, incluido el propio checkout.
  -- ⚠️ CAMBIO DEL 3-SEP: la resolución ya NO es una coincidencia exacta.
  -- `ruta_de_pago()` busca primero la fila del país y, si no existe, cae en la
  -- fila POR DEFECTO. Es lo que hace vendible a un tutor español o
  -- estadounidense sin enumerar doscientos países en esta tabla. Lee esa
  -- función: ahí está explicado por qué la fila del «sin país declarado» NO
  -- sirve para eso.
  select (public.ruta_de_pago(v_payee)).charge_providers[1] into v_provider;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible para el destino' using errcode = 'check_violation';
  end if;

  insert into public.bookings (
    student_id, product_id, tutor_id, status, pricing_model, num_sessions,
    session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct, payee_country
  ) values (
    p_student, v_prod.id, v_prod.tutor_id, 'pending_payment', v_prod.pricing_model, v_required,
    v_prod.session_duration_min, v_prod.currency, v_total, v_total, v_split, v_payee
  ) returning id into v_booking;

  -- US-702: split congelado en el pago (server-side).
  insert into public.payments (
    booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
    tier_split_pct, payee_country, provider
  ) values (
    v_booking, 'pending', v_prod.currency, v_total, v_fee, v_net, v_split, v_payee, v_provider
  );

  -- Sessions = hold del slot (S-41). La constraint de exclusión cierra la
  -- carrera Y el solape dentro del propio paquete.
  foreach v_slot in array p_slots loop
    v_seq := v_seq + 1;
    insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status)
    values (v_booking, v_prod.tutor_id, p_student, v_seq, v_slot,
            v_slot + make_interval(mins => v_prod.session_duration_min), 'scheduled');
  end loop;

  return v_booking;
exception
  -- Los dos disfraces del mismo suceso. `exclusion_violation` (23P01) es el
  -- choque de agenda desde que existe `sessions_sin_solape_por_tutor`;
  -- `unique_violation` (23505) sigue vivo por el `booking_id` único de
  -- `payments`. Mismo mensaje en los dos: desde fuera son lo mismo, y el texto
  -- es el que reconoce `esCarreraDeHorario`.
  when exclusion_violation or unique_violation then
    raise exception 'ese horario acaba de ser tomado' using errcode = 'check_violation';
end;
$function$;
-- ════════════════════════════════════════════════════════════════════════════
-- 4 · QUIÉN COBRÓ DE VERDAD
-- ════════════════════════════════════════════════════════════════════════════
--
-- La puerta estrecha que el respaldo del cobro necesitaba. Solo mueve
-- `payments.provider`, solo a un proveedor que la fila de ruteo de ESE pago
-- nombra, y solo mientras el cobro sigue pendiente. Fuera de eso, no.
create or replace function public.set_charge_provider(
  p_payment_id uuid,
  p_provider   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pago    public.payments;
  v_permitidos text[];
begin
  select * into v_pago from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'no existe el pago %', p_payment_id using errcode = 'check_violation';
  end if;

  -- ⚠️ SOLO MIENTRAS EL COBRO ESTÁ PENDIENTE. Una vez confirmado, `provider` es
  -- historia: de él cuelgan el saldo del que sale el payout y el proveedor por
  -- el que se reembolsa. Moverlo después es reescribir por dónde entró un
  -- dinero que ya entró.
  if v_pago.status <> 'pending'::public.payment_status then
    raise exception 'el pago % está en % y su proveedor ya no se puede mover', p_payment_id, v_pago.status
      using errcode = 'check_violation';
  end if;

  if v_pago.provider is not distinct from p_provider then
    return;  -- idempotente: reabrir el mismo cobro no es un error
  end if;

  -- ⚠️ Y SOLO A UN CANDIDATO DE SU PROPIA RUTA. Sin esto, esta función sería
  -- «cambia el proveedor de un pago a lo que quieras», que es exactamente la
  -- razón por la que no se concedió `grant update (provider)` a secas.
  select charge_providers into v_permitidos
    from public.ruta_de_pago(v_pago.payee_country);

  if v_permitidos is null or not (p_provider = any (v_permitidos)) then
    raise exception 'el proveedor % no está en la ruta de este pago (%)',
      p_provider, coalesce(array_to_string(v_permitidos, ', '), 'sin ruta')
      using errcode = 'check_violation';
  end if;

  update public.payments set provider = p_provider where id = p_payment_id;
end $$;

comment on function public.set_charge_provider(uuid, text) is
  'Mueve payments.provider al proveedor que ABRIÓ el cobro de verdad, y solo eso. La usa el checkout cuando la cadena de respaldo se cae al segundo candidato: sin ella, la reserva seguiría diciendo que cobró el primero y el payout se ataría al saldo equivocado (y el reembolso saldría por el proveedor equivocado). Solo admite un proveedor que esté en charge_providers de la ruta de ese pago, y solo mientras status = pending.';

revoke execute on function public.set_charge_provider(uuid, text) from public;
revoke execute on function public.set_charge_provider(uuid, text) from anon;
revoke execute on function public.set_charge_provider(uuid, text) from authenticated;
grant  execute on function public.set_charge_provider(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · AUTOCOMPROBACIÓN
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare n int; v text[];
begin
  -- 1) Fuera de Venezuela no queda ni un riel manual.
  select count(*) into n from public.payment_routing_rules
   where is_active and payout_providers && array['banco-manual','manual']::text[]
     and payee_country is distinct from 'VE';
  if n <> 0 then
    raise exception '% países fuera de Venezuela siguen con riel manual', n;
  end if;

  -- 2) Y Venezuela SÍ lo conserva: es el único que debe tenerlo.
  if not exists (select 1 from public.payment_routing_rules
                  where payee_country = 'VE' and 'manual' = any (payout_providers)) then
    raise exception 'Venezuela perdió su riel manual, que es el único que debe existir';
  end if;

  -- 3) Un país sin fila propia resuelve por la de por defecto.
  select charge_providers into v from public.ruta_de_pago('ES');
  if v is distinct from array['stripe'] then
    raise exception 'ES tenía que caer en la fila por defecto y devolvió %', coalesce(array_to_string(v,','),'nada');
  end if;
  select payout_providers into v from public.ruta_de_pago('ES');
  if v is distinct from array['stripe','paypal','wise'] then
    raise exception 'el payout por defecto quedó en %', coalesce(array_to_string(v,','),'nada');
  end if;

  -- 4) 🔑 Y la fila por defecto NO se come a la del «sin país declarado», que es
  --    el error que la separación entre las dos existe para evitar.
  select payout_providers into v from public.ruta_de_pago(null);
  if v is distinct from array['simulated'] then
    raise exception 'un tutor sin país declarado resolvió a % en vez de quedarse sin ejecutor', array_to_string(v,',');
  end if;

  -- 5) Los países con fila propia siguen resolviendo a la suya.
  select charge_providers into v from public.ruta_de_pago('MX');
  if v[1] <> 'dlocal' then
    raise exception 'MX dejó de cobrar por dLocal (quedó %)', v[1];
  end if;
  select charge_providers into v from public.ruta_de_pago('CO');
  if v[1] <> 'stripe' then
    raise exception 'CO dejó de cobrar por Stripe (quedó %)', v[1];
  end if;

  -- 6) Colombia y los ocho quedan solo con automáticos.
  if not exists (select 1 from public.payment_routing_rules
                  where payee_country = 'CO'
                    and payout_providers = array['wise','paypal','stripe']) then
    raise exception 'Colombia no quedó con {wise,paypal,stripe}';
  end if;
  select count(*) into n from public.payment_routing_rules
   where payee_country in ('AR','BR','CL','EC','MX','PE','PY','UY')
     and payout_providers = array['dlocal','paypal','wise','stripe'];
  if n <> 8 then
    raise exception 'solo % de los 8 quedaron con {dlocal,paypal,wise,stripe}', n;
  end if;

  raise notice 'ruteo alineado: manual solo en VE, fila por defecto viva, y el sin-declarar intacto.';
end $$;
