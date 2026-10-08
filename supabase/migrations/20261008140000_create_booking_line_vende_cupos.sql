-- ============================================================================
-- Enséñame Ya — create_booking_line vende cupos de clases grupales (Fase C)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2: cada cupo es una reserva y un
-- pago normales (RG-06). Esta es la función que los crea, así que es la que
-- cuenta el cupo, aparta el hold (RG-08) y ata cada sesión a su fecha grupal.
--
-- ⚠️ REEMPLAZA a la versión de `20260910120000:97` (comparada con
-- `pg_get_functiondef` en dev el 8-oct: idéntica). Copia literal con DOS
-- bloques nuevos marcados «G ·»: la rama grupal antes de validar horarios y la
-- creación de sesiones con `group_class_id`. Todo lo 1:1 —tier, montos, los
-- dos países, ruteo, el 5 % (lo pone el trigger de `20260916120000`), la
-- traducción de la carrera— no cambia una letra.
--
-- Academias (`REQUERIMIENTOS.md` §3.2) añadirá su rama en ESTA función: se
-- parte de esta versión, no de la de septiembre (§2 del plan).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Firma intacta: la llaman `create_booking` y `create_order`
--   (`20260827150000:468`, `:524`), que no se tocan.
-- · Para una grupal, `p_slots` son las fechas de la clase (las manda el
--   cliente, porque `create_order` rechaza una línea sin horarios). Si no
--   coinciden con las publicadas se rechaza.
-- · Los mensajes nuevos no contienen las subcadenas de `esCarreraDeHorario`
--   (`lib/checkout/hold.ts:260`): «sin cupo» no es «elige otro horario».
-- · Lo que ESTA versión no hace aún, y es a propósito: reembolsos, bajas y
--   reagendas de grupales (cancel_booking, proponer_reagenda…) van en sus
--   propias migraciones de la Fase C.
-- ============================================================================

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
  v_clases   record;                -- G · fechas de la clase grupal
  v_inicio   timestamptz;
  v_ocupados int;
begin
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions, p.capacity
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

  if v_prod.pricing_model = 'group' then
    -- ── G · CLASE GRUPAL (RG-06/RG-08) ────────────────────────────────────
    -- 🔒 Bloquea la fila del PRODUCTO: es lo que serializa la carrera por el
    -- último cupo. La transacción que llegue segunda espera aquí, y el conteo
    -- de abajo —sentencia nueva, snapshot nuevo en READ COMMITTED— ya ve la
    -- reserva de la primera. Solo en grupales: una 1:1 no compite por cupo.
    perform 1 from public.products where id = v_prod.id for update;

    select count(*), min(g.start_at) into v_required, v_inicio
      from public.group_classes g
     where g.product_id = v_prod.id and g.status = 'scheduled';
    if v_required = 0 then
      raise exception 'producto no reservable' using errcode = 'check_violation';
    end if;
    if v_inicio <= now() then
      raise exception 'la inscripción a esta clase ya cerró' using errcode = 'check_violation';
    end if;

    -- Las fechas NO se eligen: son las de la clase. El cliente las manda
    -- igual —`create_order` exige horarios en cada línea y con ellos suelta
    -- los holds del mismo alumno que se pisen— y aquí se exige que coincidan
    -- con las publicadas. Si el tutor reagendó mientras el alumno pagaba, se
    -- para en vez de inscribirlo a una hora que no vio.
    if array(select s from unnest(p_slots) s order by s)
       is distinct from
       array(select g.start_at from public.group_classes g
              where g.product_id = v_prod.id and g.status = 'scheduled'
              order by g.start_at) then
      raise exception 'las fechas de esta clase cambiaron, vuelve a cargarla' using errcode = 'check_violation';
    end if;

    -- Un cupo por alumno: sin esto dos pestañas le venden dos.
    if exists (
      select 1 from public.bookings b
       where b.product_id = v_prod.id and b.student_id = p_student
         and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress')
    ) then
      raise exception 'ya estás inscrito en esta clase' using errcode = 'check_violation';
    end if;

    -- El cupo lo ocupan las reservas VIVAS, holds de pago incluidos (RG-08):
    -- al caducar un hold su reserva sale de esta lista y el cupo vuelve solo.
    -- ⚠️ El texto no puede contener «acaba de ser tomado» ni «ya no está
    -- disponible»: `esCarreraDeHorario` (lib/checkout/hold.ts:260) lo leería
    -- como carrera de horario y el checkout ofrecería elegir otro.
    select count(*) into v_ocupados
      from public.bookings b
     where b.product_id = v_prod.id
       and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress');
    if v_ocupados >= v_prod.capacity then
      raise exception 'esta clase ya no tiene cupos' using errcode = 'check_violation';
    end if;
  else

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
  end if;  -- G · fin de la rama 1:1

  -- Montos (unidades menores) según modelo (RN-10).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount   -- per_session (1), per_package (precio del paquete = total) o group (RG-02: el cupo, también en un ciclo)
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
  if v_prod.pricing_model = 'group' then
    -- G · una sesión por fecha, atada a su group_class. El candado de solape
    -- no las mira (group_class_id no nulo): comparten hora a propósito.
    for v_clases in
      select g.id, g.sequence_no, g.start_at, g.end_at
        from public.group_classes g
       where g.product_id = v_prod.id and g.status = 'scheduled'
       order by g.start_at
    loop
      insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status, group_class_id)
      values (v_booking, v_prod.tutor_id, p_student, v_clases.sequence_no, v_clases.start_at,
              v_clases.end_at, 'scheduled', v_clases.id);
    end loop;
  else
  foreach v_slot in array p_slots loop
    v_seq := v_seq + 1;
    insert into public.sessions (booking_id, tutor_id, student_id, sequence_no, start_at, end_at, status)
    values (v_booking, v_prod.tutor_id, p_student, v_seq, v_slot,
            v_slot + make_interval(mins => v_prod.session_duration_min), 'scheduled');
  end loop;
  end if;

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
