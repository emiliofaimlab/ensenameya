-- ============================================================================
-- Enséñame Ya — el cobro lo decide el país del ALUMNO
--
-- Fase 1 de `docs/DICTADO-PAGOS.md` (aprobado por el cliente el 9-sep-2026).
--
-- ── QUÉ CAMBIA, EN UNA FRASE ───────────────────────────────────────────────
--
-- Hasta hoy la MISMA fila de `payment_routing_rules` se buscaba con UNA clave
-- —el país del tutor— y respondía a las dos preguntas del dinero. A partir de
-- aquí son dos claves:
--
--     ¿quién COBRA?          → ruta_de_pago(payer_country).charge_providers
--     ¿quién PAGA al tutor?  → ruta_de_pago(payee_country).payout_providers
--
-- La tabla no cambia. Sus filas no cambian. Cambia con qué clave se busca, y
-- por eso esta migración no crea ni una tabla: reusa `ruta_de_pago()` tal cual.
--
-- Medido antes de escribir esto: `ruta_de_pago('EC').charge_providers` =
-- {dlocal,stripe}, y `('ES')` y `(null)` = {stripe}. O sea que las listas que
-- ya existen SON el orden por fees que pide el dictado, leídas por la clave
-- nueva. No hay que reescribir ninguna.
--
-- ── DE DÓNDE SALE EL PAÍS DEL ALUMNO ───────────────────────────────────────
--
-- De su zona horaria, con `pais_de_cobro_por_zona()` y el mapa de 418 zonas de
-- `timezone_countries` (20260908130000). Es EXACTAMENTE la misma fuente con la
-- que ya se deduce el país de cobro del tutor, y por eso no se inventa nada:
-- si esa deducción vale para decidir a dónde sale el dinero, vale para decidir
-- por dónde entra.
--
-- ⚠️ SE DEDUCE Y SE CONGELA AQUÍ DENTRO, NO SE RECIBE POR PARÁMETRO. La firma
-- de esta función NO gana argumentos, y eso es una decisión de seguridad, no de
-- estilo: `create_booking_line` está concedida a `authenticated`, así que un
-- parámetro `p_payer` sería «el navegador elige por qué pasarela se cobra», que
-- es «el navegador elige a quién le pagamos la comisión». Se deduce del perfil
-- del alumno, que es un dato del servidor.
--
-- ⚠️ Y SE CONGELA, como todo lo demás del snapshot financiero. Un alumno que
-- cambie de zona horaria mañana no reescribe por dónde se cobró lo que ya
-- compró. Las dos columnas —`bookings.payer_country` y `payments.payer_country`—
-- YA EXISTEN desde 20260709140000 y llevan desde entonces a null en las 82
-- filas de pagos y las 139 de reservas de dev. Esta migración las estrena; no
-- se rellenan hacia atrás, porque inventar de dónde pagó alguien hace un mes
-- sería inventarse el dato, no recuperarlo.
--
-- ⚠️ UN ALUMNO SIN ZONA DEDUCIBLE NO SE QUEDA SIN COMPRAR. `ruta_de_pago(null)`
-- devuelve la fila del «sin país declarado», cuyo `charge_providers` es
-- {stripe} — comprobado, y la autocomprobación de abajo lo fija para que nadie
-- lo cambie a 'simulated' sin enterarse de que eso dejaría al alumno sin pagar.
--
-- ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
--
-- `payee_country` se sigue congelando igual y con el mismo valor: es la clave
-- del payout y el dictado no la toca. Aquí solo DEJA de decidir el cobro.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · LAS ZONAS HEREDADAS QUE EL MAPA NO TIENE
-- ════════════════════════════════════════════════════════════════════════════
--
-- `timezone_countries` salió de `zone.tab`, que ya no lista los nombres viejos.
-- Pero el runtime SÍ los sirve —`Intl` canonicaliza unos y conserva otros— y
-- un perfil creado hace meses puede tenerlos guardados. Cinco de ellos son
-- argentinos, y Argentina cobra por dLocal: sin estas filas, un alumno con
-- `America/Argentina/Buenos_Aires` guardado deduciría null y cobraría por
-- Stripe, que es la pasarela cara para él.
--
-- `on conflict do update` y no `do nothing`: si alguna ya está, que quede con
-- el país correcto y no con el que hubiera.
insert into public.timezone_countries (timezone, country) values
  ('America/Argentina/Buenos_Aires', 'AR'),
  ('America/Argentina/Catamarca',    'AR'),
  ('America/Argentina/Cordoba',      'AR'),
  ('America/Argentina/Jujuy',        'AR'),
  ('America/Argentina/Mendoza',      'AR'),
  ('America/Buenos_Aires',           'AR'),
  ('America/Cordoba',                'AR'),
  ('America/Mendoza',                'AR'),
  ('America/Rosario',                'AR'),
  ('Europe/Kiev',                    'UA'),
  ('Asia/Calcutta',                  'IN'),
  ('America/Godthab',                'GL')
on conflict (timezone) do update set country = excluded.country;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · create_booking_line — DOS PAÍSES CONGELADOS, DOS PREGUNTAS DISTINTAS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Copia literal de su versión vigente (20260903190000) con TRES cambios, todos
-- marcados con «D-1» abajo:
--   a) se deduce `v_payer` del perfil del alumno;
--   b) el cobro se rutea con `ruta_de_pago(v_payer)` en vez de `(v_payee)`;
--   c) los dos países viajan a `bookings` y a `payments`.
-- El resto —el candado por solape, el split congelado, las sesiones, el manejo
-- de la carrera de horario— va exactamente igual.

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
  v_payee    char(2);               -- dónde COBRA el tutor → decide el payout
  v_payer    char(2);               -- D-1 · desde dónde PAGA el alumno → decide el cobro
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

  -- El país de cobro sale de quien cobra, no de un literal. Puede venir null
  -- (tutor que aún no lo ha declarado) y eso NO es un error: es el caso que
  -- atiende la fila con `payee_country` null.
  --
  -- ⚠️ DESDE EL DICTADO, ESTE VALOR YA NO DECIDE POR DÓNDE SE COBRA. Sigue
  -- congelándose porque es la clave del PAYOUT, que no ha cambiado.
  select tp.payout_country into v_payee
    from public.tutor_profiles tp
   where tp.profile_id = v_prod.tutor_id;

  -- 🔑 D-1 · DE DÓNDE PAGA EL ALUMNO. La misma deducción que ya usa el trigger
  -- de `profiles` para el país del tutor: la zona horaria de su perfil contra
  -- el mapa de la tzdb. Null cuando su zona es 'UTC' (el default, o sea
  -- ausencia de dato) o cuando no está en el mapa — y null NO lo deja sin
  -- comprar: `ruta_de_pago(null)` da {stripe}, que es la fila por defecto de
  -- los que no declaran nada.
  select public.pais_de_cobro_por_zona(pr.timezone) into v_payer
    from public.profiles pr
   where pr.id = p_student;

  -- 🔑 D-1 · EL COBRO SE RUTEA POR EL PAGADOR. Este es el cambio del dictado, y
  -- es UNA línea: `ruta_de_pago(v_payer)` donde antes decía `(v_payee)`.
  --
  -- ⚠️ `charge_providers[1]`, o sea el PRIMER candidato, y no la lista entera.
  -- Lo que se congela en `payments.provider` significa QUIÉN COBRÓ, y aquí
  -- todavía no ha cobrado nadie: el cobro se abre después, en el Route Handler,
  -- que es el único que puede caerse al segundo de la lista.
  --
  -- Se congela el primero porque es el que va a cobrar en el caso normal, y
  -- quien abra el cobro ACTUALIZA esta columna (`set_charge_provider`) si acaba
  -- cobrando otro. La alternativa —dejarla null hasta el cobro— rompería todo
  -- lo que hoy da por hecho que una reserva nace con proveedor, incluido el
  -- propio checkout.
  select (public.ruta_de_pago(v_payer)).charge_providers[1] into v_provider;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible para el destino' using errcode = 'check_violation';
  end if;

  insert into public.bookings (
    student_id, product_id, tutor_id, status, pricing_model, num_sessions,
    session_duration_min, currency, subtotal_amount, total_amount, tier_split_pct,
    payee_country, payer_country
  ) values (
    p_student, v_prod.id, v_prod.tutor_id, 'pending_payment', v_prod.pricing_model, v_required,
    v_prod.session_duration_min, v_prod.currency, v_total, v_total, v_split,
    v_payee, v_payer
  ) returning id into v_booking;

  -- US-702: split congelado en el pago (server-side).
  insert into public.payments (
    booking_id, status, currency, gross_amount, platform_fee_amount, tutor_net_amount,
    tier_split_pct, payee_country, payer_country, provider
  ) values (
    v_booking, 'pending', v_prod.currency, v_total, v_fee, v_net, v_split,
    v_payee, v_payer, v_provider
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
-- 3 · set_charge_provider — VALIDA CONTRA LA RUTA DEL PAGADOR
-- ════════════════════════════════════════════════════════════════════════════
--
-- Es el gemelo obligatorio del cambio de arriba y sin él la fase queda coja:
-- esta función es la que deja al Route Handler corregir `payments.provider`
-- cuando la cadena de respaldo se cae al segundo candidato, y valida que el
-- proveedor nuevo esté en la ruta DE ESE PAGO. Si sigue validando contra la
-- ruta del tutor mientras el cobro se abre por la del alumno, las dos listas
-- pueden no coincidir y un respaldo legítimo se rechaza con «el proveedor no
-- está en la ruta de este pago».
--
-- Ejemplo real de lo que pasaría sin este cambio: alumno de España
-- ({stripe}) comprándole a un tutor de Ecuador ({dlocal,stripe}). Se abre por
-- Stripe, correcto. Si Stripe fallara, la cadena no tiene a dónde caer — y eso
-- está bien. Al revés: alumno de Ecuador y tutor español. La ruta del alumno es
-- {dlocal,stripe} y la del tutor {stripe}; el respaldo a Stripe pasaría, pero
-- un cobro abierto por dLocal —el primero de SU lista— no estaría permitido por
-- la lista del tutor. La comprobación tiene que mirar la misma lista que se usó
-- para elegir.
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

  -- ⚠️ Y SOLO A UN CANDIDATO DE SU PROPIA RUTA — la del PAGADOR desde el
  -- dictado. Sin esto, esta función sería «cambia el proveedor de un pago a lo
  -- que quieras», que es exactamente la razón por la que no se concedió
  -- `grant update (provider)` a secas.
  select charge_providers into v_permitidos
    from public.ruta_de_pago(v_pago.payer_country);

  if v_permitidos is null or not (p_provider = any (v_permitidos)) then
    raise exception 'el proveedor % no está en la ruta de este pago (%)',
      p_provider, coalesce(array_to_string(v_permitidos, ', '), 'sin ruta')
      using errcode = 'check_violation';
  end if;

  update public.payments set provider = p_provider where id = p_payment_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · QUE LA TABLA CUENTE LA VERDAD NUEVA
-- ════════════════════════════════════════════════════════════════════════════
--
-- La columna `payer_country` de `payment_routing_rules` SIGUE MUERTA y esto no
-- la resucita. `ruta_de_pago()` filtra `payer_country is null`, así que una
-- fila con ese campo puesto no la ve nadie. Que ahora exista un concepto
-- llamado «país del pagador» hace MÁS probable que alguien añada una fila ahí
-- creyendo que discrimina el cobro, y por eso el comentario lo dice con estas
-- palabras.

comment on table public.payment_routing_rules is
  'Ruteo de pagos. Desde el dictado del 9-sep-2026 la MISMA fila responde a DOS preguntas con DOS claves distintas: el cobro se busca con el país del ALUMNO (ruta_de_pago(payments.payer_country).charge_providers) y el payout con el del TUTOR (ruta_de_pago(payee_country).payout_providers). ⚠️ La columna payer_country de ESTA tabla no interviene en nada: ruta_de_pago() filtra payer_country is null, así que una fila con ese campo puesto no la ve nadie y añadirla no cambia el ruteo. La clave de búsqueda es payee_country en las dos preguntas; lo que cambia es QUÉ país se le pasa.';

comment on column public.payments.payer_country is
  'País desde el que paga el alumno (ISO-3166-1 alpha-2), CONGELADO al crear la reserva. Es la clave con la que se resolvió charge_providers (dictado del 9-sep-2026). Lo deduce create_booking_line con pais_de_cobro_por_zona(profiles.timezone) del alumno; NULL = su zona es UTC (ausencia de dato) o no está en timezone_countries, y entonces rutea por la fila por defecto. No se recalcula al pagar ni al cambiar el alumno de zona horaria: es snapshot financiero (regla de oro 2). Las filas anteriores al 10-sep-2026 lo tienen a null y NO se rellenan hacia atrás.';

comment on column public.bookings.payer_country is
  'Copia del payments.payer_country de esta reserva: desde dónde pagó el alumno, congelado al crear la línea. Ver el comentario de payments.payer_country.';

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · AUTOCOMPROBACIÓN
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ AFIRMA LA INVARIANTE, NO EL AMBIENTE. Todo lo que se comprueba aquí es
-- verdad en dev y en producción por igual, porque lo escribe esta migración o
-- una anterior que ya está en las dos. Una autocomprobación que afirmara «en
-- dev hay 21 filas» abortaría la corrida entera del CI en producción — es la
-- lección del 3-sep (20260903170000).

do $$
declare
  v_ec text;
  v_es text;
  v_nulo text;
begin
  -- Los tres casos del dictado, leídos por la clave nueva.
  select (public.ruta_de_pago('EC')).charge_providers[1] into v_ec;
  select (public.ruta_de_pago('ES')).charge_providers[1] into v_es;
  select (public.ruta_de_pago(null)).charge_providers[1] into v_nulo;

  if v_ec is distinct from 'dlocal' then
    raise exception 'un alumno de Ecuador tendría que cobrar por dLocal y cobra por %', coalesce(v_ec, 'nada');
  end if;

  if v_es is distinct from 'stripe' then
    raise exception 'un alumno de España tendría que cobrar por Stripe y cobra por %', coalesce(v_es, 'nada');
  end if;

  -- Un alumno sin zona horaria deducible TIENE que poder pagar. Si esta fila
  -- llegara a decir 'simulated', el checkout le enseñaría el botón de simular
  -- pago de un entorno de pruebas sobre un cobro real.
  if v_nulo is null or v_nulo = 'simulated' then
    raise exception 'un alumno sin país deducible no podría pagar de verdad (rutea a %)', coalesce(v_nulo, 'nada');
  end if;

  -- Las zonas heredadas del bloque 1 tienen que resolver.
  if public.pais_de_cobro_por_zona('America/Argentina/Buenos_Aires') is distinct from 'AR' then
    raise exception 'la zona heredada de Buenos Aires no deduce Argentina';
  end if;

  -- Y la propia deducción tiene que seguir devolviendo null para 'UTC', que es
  -- ausencia de dato y no un país.
  if public.pais_de_cobro_por_zona('UTC') is not null then
    raise exception 'UTC no es un país y se está deduciendo como tal';
  end if;
end $$;
