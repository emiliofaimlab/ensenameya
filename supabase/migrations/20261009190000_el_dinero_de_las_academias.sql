-- ============================================================================
-- Enséñame Ya — el dinero de las academias (REQUERIMIENTOS §3.2 · Fase C)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/REQUERIMIENTOS.md` §3.2. Lo que se cobra por una oferta de academia es
-- DE LA ACADEMIA (RA-10): se congela en la reserva (RA-09), no entra en el
-- saldo ni en los payouts del tutor que la dio, y se le paga al administrador
-- de la academia por los mismos rieles y con la misma retención (RA-11).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · TODAS las funciones de abajo REEMPLAZAN a su versión VIVA de dev
--   (`pg_get_functiondef`, 9-oct), con los cambios marcados «A ·» (academias)
--   o «G ·» (grupales). Las que ya habíamos reescrito para grupales se parten
--   de ESA versión, como pide el §2 del plan: create_booking_line
--   (20261008140000), cancel_booking y proponer_reagenda (20261008200000),
--   build_payout_for_tutor / tutor_balance / account_deletion_state
--   (20261009090000), products_guarda_grupal (20261008160000). Firmas
--   intactas: ninguna necesita drop + create.
--
-- · create_booking_line, rama de academia: academia activa (RA-20), privada
--   solo para su lista (RA-07, por p_student: la asignación de A3b reserva por
--   el alumno), de pago solo con comisión (RA-22), sin grupales (RG-21). El
--   reparto es la comisión de la academia y no el nivel del tutor; el país de
--   cobro, el de la academia. `mandatory` NO se pone aquí: lo marca la RPC de
--   asignación (A3b) sobre la reserva que esta función devuelve.
--
-- · 🔴 ARREGLO de `20261009090000`: `run_payout_batch` elegía a qué tutores
--   pagar mirando solo `status = 'paid'`, así que un tutor cuyo único saldo
--   fuera un ciclo grupal con una fecha cancelada (`partially_refunded`) no
--   entraba NUNCA en el lote, aunque `build_payout_for_tutor` sí lo habría
--   pagado. Ahora la selección usa la misma regla que el builder.
--
-- · `build_payout_for_academy`: gemela de build_payout_for_tutor, sin el
--   bloque de créditos (RA-13). Beneficiario = `academies.owner_id`; sin
--   dueño no hay a quién pagar y devuelve NULL (el dinero espera, no se
--   pierde: el siguiente lote lo vuelve a intentar).
--
-- · ⚠️ Regla 11: `run_payout_batch` corre por pg_cron (`run-payout-batch`).
--   Tras aplicar, se mira su corrida.
--
-- · Lo que NO está aquí y va después: la cuenta de cobro del administrador de
--   la academia (portal, A3). Hasta que la conecte, su payout se queda
--   esperando igual que el de un tutor sin datos de cobro.
-- ============================================================================

-- ── create_booking_line ───────────────────────────────────────────────────
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
  v_ac       record;                -- A · la academia de la oferta
  v_ocupados int;
begin
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.package_num_sessions, p.capacity,
         p.academy_id, p.visibility
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  -- ── A · OFERTA DE ACADEMIA (REQUERIMIENTOS §3.2) ──────────────────────────
  if v_prod.academy_id is not null then
    select a.id, a.name, a.status, a.commission_pct, a.payout_country
      into v_ac
      from public.academies a where a.id = v_prod.academy_id;
    -- RA-20: suspendida (o aún en borrador) no admite reservas nuevas.
    if v_ac.status is distinct from 'active' then
      raise exception 'esta academia no admite reservas ahora mismo' using errcode = 'check_violation';
    end if;
    -- RA-07: la privada solo para su lista activa. Con p_student y no con
    -- auth.uid(): la asignación de la academia (A3b) reserva por el alumno.
    if v_prod.visibility = 'private' and not exists (
      select 1 from public.academy_members m
       where m.academy_id = v_ac.id and m.role = 'student'
         and m.status = 'active' and m.profile_id = p_student
    ) then
      raise exception 'Esta clase es solo para alumnos de %', v_ac.name using errcode = 'check_violation';
    end if;
    -- RA-22: sin comisión pactada, solo gratis.
    if v_prod.price_amount > 0 and v_ac.commission_pct is null then
      raise exception 'esta oferta todavía no se puede pagar: % no tiene acuerdo de comisión', v_ac.name
        using errcode = 'check_violation';
    end if;
    -- RG-21: grupales de academia, no hasta la Fase I.
    if v_prod.pricing_model = 'group' then
      raise exception 'las clases grupales de academia todavía no están disponibles' using errcode = 'check_violation';
    end if;
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

  -- A · RA-09/13: en una academia el reparto es SU comisión, no el nivel del
  -- tutor. Sin comisión solo llegan aquí ofertas gratuitas (RA-22, arriba):
  -- 100 es un marcador inocuo, con importe 0 no se reparte nada.
  if v_prod.academy_id is not null then
    v_split := coalesce(v_ac.commission_pct, 100);
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

  -- A · RA-09: el dinero de la academia lo cobra la academia, en su país.
  if v_prod.academy_id is not null then
    v_payee := v_ac.payout_country;
  end if;

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
    payee_country, payer_country, academy_id
  ) values (
    p_student, v_prod.id, v_prod.tutor_id, 'pending_payment', v_prod.pricing_model, v_required,
    v_prod.session_duration_min, v_prod.currency, v_total, v_total, v_split,
    v_payee, v_payer, v_prod.academy_id   -- A · RA-09, congelado
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

-- ── products_guarda_grupal ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.products_guarda_grupal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- A · RG-21: una oferta de academia no es grupal hasta la Fase I.
  if new.pricing_model = 'group' and new.academy_id is not null then
    raise exception 'las clases grupales de academia todavía no están disponibles'
      using errcode = 'check_violation';
  end if;

  -- Hacerse grupal exige el interruptor del admin.
  if new.pricing_model = 'group'
     and (tg_op = 'INSERT' or old.pricing_model is distinct from 'group')
     and not exists (
       select 1 from public.tutor_profiles tp
        where tp.profile_id = new.tutor_id and tp.group_classes_enabled
     )
  then
    raise exception 'las clases grupales no están habilitadas para este tutor'
      using errcode = 'check_violation';
  end if;

  -- Una clase con fechas no cambia de tipo: sus fechas y sus inscritos
  -- quedarían colgando de una mentoría 1:1.
  if tg_op = 'UPDATE'
     and old.pricing_model is distinct from new.pricing_model
     and exists (select 1 from public.group_classes g where g.product_id = old.id)
  then
    raise exception 'una clase grupal publicada no cambia de tipo'
      using errcode = 'check_violation';
  end if;

  -- Activarse sin fechas es publicar una clase vacía. Solo en la TRANSICIÓN a
  -- 'active': una clase cuyas fechas ya pasaron sigue pudiendo editarse.
  if new.pricing_model = 'group' and new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not exists (
       select 1 from public.group_classes g
        where g.product_id = new.id and g.status = 'scheduled'
     )
  then
    raise exception 'una clase grupal se publica con sus fechas'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ── build_payout_for_tutor ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_payout_for_tutor(p_tutor_id uuid, p_retention_days integer, p_status payout_status DEFAULT 'scheduled'::payout_status)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cutoff   timestamptz := now() - make_interval(days => p_retention_days);
  v_rec      record;
  v_payout   uuid;
  -- ⚠️ Ver el aviso 1 de la cabecera. Mientras esto sea false, todo el bloque
  -- de recompensas ni se prepara, y esta función se comporta EXACTAMENTE como
  -- la de hoy salvo por las dos columnas nuevas.
  v_hay_cred boolean := to_regclass('public.credits') is not null;
  v_cred     record;
  v_destino  uuid;
  v_pais     char(2);
  v_riel     text;
begin
  -- Se agrupa por MONEDA, por BALANCE DE ORIGEN y por PAÍS DE DESTINO. La
  -- moneda porque sumar monedas distintas no significa nada (RN-13); el balance
  -- porque el dinero vive donde vive y un payout que mezcle dos no lo puede
  -- ejecutar ninguno de los dos; y el país porque es quien elige al EJECUTOR
  -- (`payment_routing_rules.payout_providers`), y mezclar destinos produce una
  -- orden que no se sabe a dónde mandar.
  --
  -- Los tres son la misma idea aplicada tres veces: en la clave va todo lo que
  -- tiene que ser IGUAL en las líneas para que la orden resultante sea pagable.
  -- Un payout de más es un inconveniente; un payout impagable es dinero parado
  -- sin que nadie se entere.
  --
  -- 🔑 LO QUE CAMBIA HOY: la clave del balance deja de ser `p.provider` —quién
  -- PROCESÓ el cargo— y pasa a ser `p.funding_provider` —dónde está la CAJA—.
  -- Con `funding_provider` backfilleado a `provider` las dos son idénticas en
  -- las 127 filas de dev, que es justo lo que hay que verificar antes de
  -- construir nada encima.
  for v_rec in
    select p.currency,
           coalesce(p.funding_provider, p.provider) as funding_provider,
           p.payee_country                          as payee_country,
           sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)) as total,
           sum(public.parte_del_tutor(p.platform_funded_amount, p.gross_amount, p.refunded_amount)) as falta,
           array_agg(p.id)                          as payment_ids
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where b.tutor_id = p_tutor_id
      -- reembolsados fuera (S-29)… salvo G · el ciclo grupal con fechas
      -- canceladas por el tutor, que cobra la parte que sí dio.
      and (p.status = 'paid'
           or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
      and b.academy_id is null   -- A · RA-10: lo de academia es de la academia
      and b.status = 'completed'
      and b.completed_at <= v_cutoff              -- retención vencida (DP-02)
      and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
    group by p.currency, coalesce(p.funding_provider, p.provider), p.payee_country
  loop
    insert into public.payouts (tutor_id, status, currency, amount,
                                funding_provider, payee_country,
                                platform_funded_amount,
                                retention_until, scheduled_for)
    values (p_tutor_id, p_status, v_rec.currency, v_rec.total,
            v_rec.funding_provider, v_rec.payee_country,
            coalesce(v_rec.falta, 0), v_cutoff, now())
    returning id into v_payout;
    -- `provider` se queda a null a propósito: lo escribe quien ejecute (C2).

    insert into public.payout_items (payout_id, payment_id, amount)
    select v_payout, pid, public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)
    from unnest(v_rec.payment_ids) as pid
    join public.payments p on p.id = pid;
  end loop;

  -- ── SEGUNDO BUCLE · LAS RECOMPENSAS EN DINERO DEL TUTOR ───────────────────
  --
  -- El diagrama dice «le llega solo, en el siguiente ciclo». H-4 demuestra que
  -- la versión ingenua —crear un payout por la recompensa y ya— produce una
  -- orden con `funding_provider` y `payee_country` a NULL que
  -- `payouts-process/route.ts` descarta en DOS puertas seguidas (:437 por
  -- balance, :453 por país) sin marcar nada, y que se queda 'scheduled' para
  -- siempre en un contador que solo sale por `console.error`. Así que el orden
  -- de preferencia es este, y es el de H-4:
  --
  --   1) ENGANCHARLA A UNA ORDEN QUE YA EXISTE de ese tutor y esa moneda. Es el
  --      caso normal —la recompensa llega con clases dentro— y hereda un
  --      `funding_provider` y un `payee_country` que ya son buenos. Va detrás
  --      del primer bucle a propósito: así también engancha con las órdenes
  --      recién creadas en esta misma pasada.
  --   2) Si no hay ninguna, CREARLA, pero solo si se sabe a dónde (el
  --      `payout_country` del tutor) y por dónde (un riel de su ruta).
  --   3) Si no se sabe, NO CREARLA. El crédito se queda 'active' y vuelve a
  --      intentarlo en la pasada siguiente. Una recompensa que sigue viva vale
  --      infinitamente más que una orden 'scheduled' que nadie ejecuta.
  --
  if v_hay_cred then
    for v_cred in
      select c.id, c.currency, (c.amount - c.consumed_amount) as importe
        from public.credits c
       where c.beneficiary_id = p_tutor_id
         and c.destino = 'payout'
         and c.status  = 'active'
         and c.amount  > c.consumed_amount
         and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id)
       order by c.created_at
         for update of c
    loop
      -- (1) ¿Hay ya una orden a la que engancharla?
      -- 'on_hold' queda fuera: está retenida por un motivo y meterle una
      -- recompensa dentro la retiene también. 'processing' y 'paid' ni se
      -- miran: ya están en manos del proveedor.
      select po.id
        into v_destino
        from public.payouts po
       where po.tutor_id = p_tutor_id
         and po.currency = v_cred.currency
         and po.status in ('pending', 'scheduled')
         and po.funding_provider is not null
         and po.payee_country    is not null
       order by po.created_at desc
       limit 1;

      -- (2) Si no, se crea — con destino y riel resueltos, o no se crea.
      if v_destino is null then
        select tp.payout_country into v_pais
          from public.tutor_profiles tp
         where tp.profile_id = p_tutor_id;

        v_riel := null;
        if v_pais is not null then
          -- 🔑 EL PRIMER CANDIDATO QUE NO ESTÉ ATADO A UN BALANCE. Una orden que
          -- es SOLO recompensa no tiene caja detrás en ningún PSP: es dinero que
          -- la plataforma regala. Un riel atado a balance (hoy 'stripe' y
          -- 'dlocal', `src/lib/payments.ts:276` y `:295`) exigiría transferirle
          -- el importe entero antes del ciclo; los fondeados aparte (wise,
          -- paypal, manual, banco-manual) recargan desde nuestro banco y no
          -- dependen de quién cobró, que es exactamente lo que hace falta aquí.
          -- ⚠️ Ese par ('dlocal','stripe') está DUPLICADO en SQL a sabiendas:
          -- `payouts_backlog()` ya lo lleva escrito igual, en su contador
          -- `balance_ajeno`. Si algún día un riel cambia de bando hay que tocar
          -- los dos sitios Y `src/lib/payments.ts`, que es el que manda.
          -- H-4 decía «dejarla fuera si el riel está atado»; se implementa un
          -- paso más fino: se busca el primer candidato NO atado de la lista, y
          -- solo si no hay ninguno se deja fuera. Mismo invariante, menos
          -- recompensas paradas.
          select cand
            into v_riel
            from unnest((public.ruta_de_pago(v_pais)).payout_providers)
                   with ordinality as t(cand, ord)
           where cand not in ('dlocal', 'stripe', 'simulated')
           order by t.ord
           limit 1;
        end if;

        -- (3) Sin país o sin riel servible: el crédito no se toca y se reintenta
        -- en la pasada siguiente. Queda visible como `credits` 'active'.
        if v_riel is null then
          continue;
        end if;

        insert into public.payouts (tutor_id, status, currency, amount,
                                    funding_provider, payee_country,
                                    platform_funded_amount, adjustment_amount,
                                    retention_until, scheduled_for)
        values (p_tutor_id, p_status, v_cred.currency, 0,
                v_riel, v_pais,
                0, 0,
                now(), now())   -- una recompensa no tiene clase que retener
        returning id into v_destino;
      end if;

      insert into public.payout_adjustments (payout_id, credit_id, amount)
      values (v_destino, v_cred.id, v_cred.importe);

      -- `amount` sube porque hay que pagarlo; `platform_funded_amount` sube LO
      -- MISMO porque no hay caja detrás. Las dos cosas a la vez o la vista de
      -- fondeo miente.
      update public.payouts
         set amount                 = amount + v_cred.importe,
             adjustment_amount      = adjustment_amount + v_cred.importe,
             platform_funded_amount = platform_funded_amount + v_cred.importe
       where id = v_destino;

      update public.credits
         set consumed_amount = amount,
             status          = 'consumed',
             consumed_at     = now()
       where id = v_cred.id;

      v_payout := v_destino;
    end loop;
  end if;

  -- Se crea un payout por cada (moneda, balance, país) y se devuelve el último.
  -- Quien lo llama solo mira si es null: `request_withdrawal` para saber si
  -- había saldo, `run_payout_batch` para contar tutores. Ninguno usa el id.
  -- ⚠️ Desde hoy también devuelve no-null cuando lo único que pasó fue
  -- ENGANCHAR una recompensa a una orden que ya existía. Es correcto para los
  -- dos llamadores: había algo que pagar.
  return v_payout;
end;
$function$;

-- ── tutor_balance ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tutor_balance(p_retention_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_cutoff   timestamptz := now() - make_interval(days => p_retention_days);
  -- Las recompensas, en dos arrays paralelos (moneda ↔ importe). Arrays y no un
  -- `union` dentro del `select` por lo mismo que el bloque 11: `public.credits`
  -- puede no existir, y una rama no tomada de PL/pgSQL no se prepara. Con esto,
  -- una sola versión de la función vale en los dos órdenes de aplicación.
  v_monedas  char(3)[] := '{}'::char(3)[];
  v_importes bigint[]  := '{}'::bigint[];
  v_hay_cred boolean   := to_regclass('public.credits') is not null;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  if v_hay_cred then
    select coalesce(array_agg(t.currency order by t.currency), '{}'::char(3)[]),
           coalesce(array_agg(t.total    order by t.currency), '{}'::bigint[])
      into v_monedas, v_importes
      from (
        -- ⚠️ EL `::bigint` NO ES ADORNO: `sum(bigint)` devuelve `numeric`, y
        -- meter un `numeric[]` en una variable `bigint[]` solo funciona porque
        -- PL/pgSQL cae a la conversión por texto. Funcionar por accidente en
        -- una función que suma dinero es cómo se descubre un fallo el día que
        -- alguien cambia un tipo. Se dice el tipo.
        select c.currency, sum(c.amount - c.consumed_amount)::bigint as total
          from public.credits c
         where c.beneficiary_id = v_uid
           and c.destino = 'payout'
           and c.status  = 'active'
           and c.amount  > c.consumed_amount
           and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id)
         group by c.currency
      ) t;
  end if;

  return jsonb_build_object(
    -- Disponible: pago 'paid' de reserva completada, retención vencida, no
    -- pagado aún — MÁS las recompensas en dinero que el lote va a meter en la
    -- próxima orden. Los dos orígenes se agregan por moneda antes de agrupar:
    -- sumar monedas distintas no significa nada (RN-13).
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('currency', a.currency, 'amount', a.total) order by a.currency)
      from (
        select x.currency, sum(x.monto) as total
        from (
          select p.currency, public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount) as monto
          from public.payments p
          join public.bookings b on b.id = p.booking_id
          where b.tutor_id = v_uid and b.status = 'completed'
            and (p.status = 'paid' or (p.status = 'partially_refunded' and b.pricing_model = 'group'))  -- G ·
            and b.academy_id is null  -- A · RA-10
            and b.completed_at <= v_cutoff
            and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
          union all
          select r.moneda, r.importe
          from unnest(v_monedas, v_importes) as r(moneda, importe)
        ) x
        group by x.currency
      ) a
    ), '[]'::jsonb),
    -- En retención: liquidable salvo que la retención aún no venció. Sin
    -- recompensas: no hay clase detrás, así que no hay nada que retener.
    'in_retention', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select p.currency, sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)) as total
        from public.payments p
        join public.bookings b on b.id = p.booking_id
        where b.tutor_id = v_uid and b.status = 'completed'
            and (p.status = 'paid' or (p.status = 'partially_refunded' and b.pricing_model = 'group'))  -- G ·
            and b.academy_id is null  -- A · RA-10
          and b.completed_at > v_cutoff
          and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
        group by p.currency
      ) r
    ), '[]'::jsonb),
    -- Ya pagado: payouts liquidados. `payouts.amount` YA lleva dentro el
    -- `adjustment_amount`, así que la recompensa pagada se cuenta aquí sola y
    -- sumarla otra vez sería duplicarla.
    'paid_out', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'amount', total) order by currency)
      from (
        select currency, sum(amount) as total
        from public.payouts
        where tutor_id = v_uid and status = 'paid'
        group by currency
      ) pd
    ), '[]'::jsonb)
  );
end;
$function$;

-- ── account_deletion_state ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_deletion_state(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with
  -- Clases futuras ya vendidas. Se mira `sessions` y no `bookings` porque la
  -- fecha vive ahí: `create_booking` mete una sesión por hueco del paquete.
  futuras_tutor as (
    select count(*) as n from public.sessions s
     where s.tutor_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  futuras_alumno as (
    select count(*) as n from public.sessions s
     where s.student_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  -- Saldo pendiente. La definición de «liquidable» se copia LITERALMENTE de
  -- `tutor_balance` (`20260716150000`), que a su vez la comparte con
  -- `build_payout_for_tutor`: una sola fuente para los tres. Se juntan
  -- `available` e `in_retention` porque para darse de baja da igual que la
  -- retención haya vencido o no — es dinero suyo que todavía no ha cobrado.
  --
  -- `ultimo_completado` es lo que permite decirle CUÁNDO: la retención de 7
  -- días (DP-02, el default de `run_payout_batch`) corre desde `completed_at`,
  -- así que el saldo entero es liquidable a partir del último + 7 días. La
  -- pantalla lo redondea al lote semanal; aquí se da el dato crudo.
  sin_liquidar as (
    select coalesce(sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)), 0) as importe,
           count(distinct p.currency)           as monedas,
           min(p.currency)                      as moneda,
           max(b.completed_at)                  as ultimo_completado
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.tutor_id = p_user_id
       and (p.status = 'paid' or (p.status = 'partially_refunded' and b.pricing_model = 'group'))  -- G ·
       and b.academy_id is null  -- A · RA-10: no es dinero del tutor
       and b.status   = 'completed'
       and not exists (
         select 1 from public.payout_items pi where pi.payment_id = p.id
       )
  ),
  -- Dinero ya en vuelo: un retiro emitido que aún no ha aterrizado.
  -- ⚠️ 'failed' está DENTRO, a diferencia de EY-192: un payout fallido es
  -- dinero que se le debe y que espera un `admin_payout_action('retry')`.
  -- Dejarlo fuera dejaba anonimizar a quien no habías pagado.
  payouts_vivos as (
    select count(*) as n from public.payouts po
     where po.tutor_id = p_user_id
       and po.status in ('pending', 'scheduled', 'processing', 'on_hold', 'failed')
  ),
  -- Reembolso pendiente HACIA el alumno. No bloquea por el dinero —el abono va
  -- contra el pago del PSP, no contra el perfil— sino porque irse mientras te
  -- deben algo deja a la persona sin a dónde reclamar.
  reembolsos_vivos as (
    select count(*) as n
      from public.refund_requests rr
      join public.bookings b on b.id = rr.booking_id
     where b.student_id = p_user_id
       and rr.status = 'pending'
  ),
  -- 🔴 NUEVO · UN REGALO PAGADO POR UN TERCERO QUE ESTA PERSONA NO HA AGENDADO.
  -- La fecha manda sobre el status (el barrido es diario): uno ya vencido no
  -- bloquea nada porque ya no vale.
  regalos_sin_usar as (
    select count(*) as n from public.credits c
     where c.beneficiary_id = p_user_id
       and c.source  = 'gift'
       and c.status  = 'active'
       and c.destino = 'cobro'
       and c.amount > c.consumed_amount
       and (c.expires_at is null or c.expires_at > now())
  ),
  -- 🔴 NUEVO · LA RECOMPENSA EN DINERO DEL TUTOR QUE TODAVÍA NO HA ENTRADO EN
  -- UN CICLO. `payout_adjustments.credit_id` es único: en cuanto el lote la
  -- mete, el crédito pasa a 'consumed' y esta cuenta baja sola.
  recompensas_payout as (
    select coalesce(sum(c.amount - c.consumed_amount), 0) as importe,
           count(*)                                       as n
      from public.credits c
     where c.beneficiary_id = p_user_id
       and c.destino = 'payout'
       and c.status  = 'active'
       and c.amount > c.consumed_amount
  )
  select jsonb_build_object(
    'accionables', jsonb_strip_nulls(jsonb_build_object(
      'clases_futuras_como_tutor',
        case when (select n from futuras_tutor)  > 0 then (select n from futuras_tutor)  end,
      'clases_futuras_como_alumno',
        case when (select n from futuras_alumno) > 0 then (select n from futuras_alumno) end,
      'regalos_sin_agendar',
        case when (select n from regalos_sin_usar) > 0 then (select n from regalos_sin_usar) end
    )),
    'en_espera', jsonb_strip_nulls(jsonb_build_object(
      'saldo_sin_liquidar',
        case when (select importe from sin_liquidar) > 0
             then (select importe from sin_liquidar) end,
      -- Solo cuando hay UNA moneda: con varias, sumar no significa nada
      -- (RN-13) y la pantalla se calla el importe en vez de mentirlo.
      'saldo_moneda',
        case when (select importe from sin_liquidar) > 0
              and (select monedas from sin_liquidar) = 1
             then (select moneda from sin_liquidar) end,
      'saldo_liquidable_desde',
        case when (select importe from sin_liquidar) > 0
             then (select ultimo_completado + interval '7 days' from sin_liquidar) end,
      'payouts_en_curso',
        case when (select n from payouts_vivos)   > 0 then (select n from payouts_vivos)   end,
      'reembolsos_pendientes',
        case when (select n from reembolsos_vivos) > 0 then (select n from reembolsos_vivos) end,
      'recompensas_sin_cobrar',
        case when (select n from recompensas_payout) > 0
             then (select n from recompensas_payout) end
    ))
  );
$function$;

-- ── expire_stale_bookings ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_stale_bookings(p_payment_cutoff interval DEFAULT '00:07:00'::interval, p_acceptance_cutoff interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Las candidatas que vio la foto…
  v_pay_ids  uuid[];
  -- …y las que de verdad se cancelaron. NO tienen por qué coincidir: esa
  -- diferencia es la carrera, y por eso se cuenta abajo en vez de esconderse.
  v_pay_done uuid[];
  v_acc_ids  uuid[];
  -- Las aceptaciones vencidas cuyo reembolso NO se pudo repartir. No se cierran:
  -- marcarlas 'refunded' sin haber encolado nada es la mentira creíble de
  -- siempre. Se quedan para la pasada siguiente (la clave de idempotencia hace
  -- que reintentar no duplique nada).
  v_acc_mal  uuid[] := '{}'::uuid[];
  v_acc_ok   uuid[];
  v_r        record;
  v_cred     record;
  v_encolados    int := 0;
  v_liberados    int := 0;
  v_fallos_cred  int := 0;
  v_fallos_ref   int := 0;
begin
  -- 1) pending_payment vencidas (nunca se cobró) → cancelled, sin reembolso.
  select array_agg(id) into v_pay_ids
  from public.bookings
  where status = 'pending_payment'
    and created_at < now() - p_payment_cutoff
    and not mandatory;   -- A · RA-25: la asignada de pago espera; la academia decide

  if v_pay_ids is not null then
    -- ⚠️ `payments` PRIMERO, y no por costumbre: fija el mismo orden de bloqueo
    -- que `confirm_payment` (evita el deadlock) y de paso valla al webhook
    -- mientras dura esta transacción.
    update public.payments set status = 'failed', failed_at = now()
      where booking_id = any(v_pay_ids) and status = 'pending';

    -- ⚠️ AQUÍ ESTÁ LA GUARDA. `and status = 'pending_payment'` es lo que impide
    -- cancelar una reserva que el webhook confirmó entre la foto y este update;
    -- el `returning` es lo que permite que las sesiones se cancelen SOLO de las
    -- reservas que de verdad se cancelaron.
    with canceladas as (
      update public.bookings
         set status = 'cancelled', cancelled_at = now()
       where id = any(v_pay_ids)
         and status = 'pending_payment'
      returning id
    )
    select array_agg(id) into v_pay_done from canceladas;

    if v_pay_done is not null then
      update public.sessions set status = 'cancelled', cancelled_at = now()
        where booking_id = any(v_pay_done) and status = 'scheduled';

      -- 🔴 NUEVO · DEVOLVER EL CRÉDITO. Esta rama corre CADA MINUTO sobre todo
      -- lo que lleve 7 minutos sin pagar, y es la puerta por la que se destruía
      -- un regalo que alguien pagó de verdad: el destinatario agenda, se aplica
      -- el crédito, el checkout devuelve `{modo:"credito"}` y hace falta una
      -- SEGUNDA llamada del navegador para confirmarlo. Si cierra la pestaña,
      -- aquí moría. Se hace sobre `v_pay_done` —las que de verdad se
      -- cancelaron— y no sobre `v_pay_ids`, o le devolveríamos el crédito a
      -- alguien cuya reserva se salvó por la carrera.
      --
      -- ⚠️ Y CADA FILA EN SU PROPIO `begin … exception`. Esto es un bucle con
      -- una RPC por fila DENTRO de un job que corre CADA MINUTO: sin el
      -- cinturón, un solo crédito con la aritmética mal aborta la transacción
      -- entera y con ella el cierre de TODOS los checkouts vencidos de la
      -- plataforma, en silencio, en `cron.job_run_details` (regla de oro 11). Un
      -- regalo que no se devuelve es un incidente; una pasada que no cierra
      -- nada, día tras día, es el agujero de los 12.446 fallos seguidos.
      -- El `raise warning` es el mismo patrón que ya usa `notify_email_confirmed`.
      for v_cred in
        select p.id from public.payments p
         where p.booking_id = any(v_pay_done)
           and p.credit_id is not null
      loop
        begin
          perform public.liberar_credito_de_pago(v_cred.id);
          v_liberados := v_liberados + 1;
        exception when others then
          v_fallos_cred := v_fallos_cred + 1;
          raise warning 'expire_stale_bookings: no se pudo devolver el crédito del pago % : %',
            v_cred.id, sqlerrm;
        end;
      end loop;
    end if;
  end if;

  -- 2) pending_acceptance vencidas (tutor no respondió) → cancelled + 100%.
  select array_agg(b.id) into v_acc_ids
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.status = 'pending_acceptance'
    and p.paid_at < now() - p_acceptance_cutoff;

  if v_acc_ids is not null then
    -- ⚠️ ANTES DEL UPDATE, y no después. El tramo a devolver es
    -- `gross_amount - refunded_amount` LEÍDO AHORA; en cuanto el update ponga
    -- el acumulado al máximo, esa resta da cero y no se encolaría nada.
    for v_r in
      select p.id, p.booking_id, p.gross_amount, p.refunded_amount,
             p.gross_amount - p.refunded_amount as delta
        from public.payments p
       where p.booking_id = any(v_acc_ids)
         and p.gross_amount > p.refunded_amount
    loop
      -- 🔴 NUEVO · SE PARTE EL TRAMO. Antes esto encolaba `delta` entero contra
      -- la pasarela. En un cobro de 180 con 45 de crédito, eso son 180 contra
      -- un cargo de 135: Stripe lo rechaza en cada pasada del cron para
      -- siempre, mientras `payments.status` ya dice `refunded`. El alumno no
      -- recibe nada y el estado afirma que se le devolvió todo.
      --
      -- Mismo cinturón que la rama 1, y aquí pesa más: el tope nuevo de
      -- `enqueue_refund` ABORTA a propósito cuando el llamador pide más efectivo
      -- del que entró, y sin este `exception` ese grito —que está bien dado— se
      -- llevaría por delante la pasada entera.
      --
      -- `p_ya_devuelto` es `refunded_amount` LEÍDO AHORA: el `update` que lo
      -- pone al máximo va después del bucle, a propósito.
      begin
        perform public.reembolsar_con_credito(
          v_r.id,
          v_r.delta,
          v_r.refunded_amount,
          'RN-38 · el tutor no respondió en 24 h (100 %)',
          'X01:payment:' || v_r.id || ':' || v_r.gross_amount
        );
        v_encolados := v_encolados + 1;
      exception when others then
        v_fallos_ref := v_fallos_ref + 1;
        v_acc_mal    := v_acc_mal || v_r.booking_id;
        raise warning 'expire_stale_bookings: no se pudo repartir el reembolso del pago % : %',
          v_r.id, sqlerrm;
      end;
    end loop;

    -- 🔴 Y SOLO SE CIERRA LO QUE DE VERDAD SE REPARTIÓ. Si el reparto de una
    -- fila falló, marcarla `refunded` diría que se devolvió todo con la cola
    -- vacía —el mismo estado que miente que esta migración vino a arreglar—.
    -- Se queda `pending_acceptance` y la pasada del minuto siguiente lo vuelve a
    -- intentar; la clave de idempotencia impide que un reintento duplique nada.
    select coalesce(array_agg(x), '{}'::uuid[]) into v_acc_ok
      from (select unnest(v_acc_ids) as x
            except
            select unnest(v_acc_mal)) s;

    if array_length(v_acc_ok, 1) is not null then
      update public.payments set status = 'refunded', refunded_amount = gross_amount
        where booking_id = any(v_acc_ok);
      update public.bookings set status = 'cancelled', cancelled_at = now()
        where id = any(v_acc_ok);
      update public.sessions set status = 'cancelled', cancelled_at = now()
        where booking_id = any(v_acc_ok) and status = 'scheduled';
    end if;
  end if;

  return jsonb_build_object(
    'payment_expired',    coalesce(array_length(v_pay_done, 1), 0),
    -- 🔎 EL TERMÓMETRO DE LA CARRERA. Candidatas que la guarda salvó porque
    -- dejaron de estar pendientes entre la foto y el update.
    'payment_raced',      coalesce(array_length(v_pay_ids, 1), 0)
                          - coalesce(array_length(v_pay_done, 1), 0),
    'acceptance_expired', coalesce(array_length(v_acc_ok, 1), 0),
    'refunds_enqueued',   v_encolados,
    -- Clave NUEVA. Si esto sube, hay gente perdiendo su regalo entre el canje y
    -- la confirmación: el número que hay que mirar para decidir si el canje
    -- tiene que volverse atómico.
    'credits_released',   v_liberados,
    -- 🔎 LOS DOS TERMÓMETROS DEL CINTURÓN. Cualquiera de los dos por encima de 0
    -- es un `raise warning` en `cron.job_run_details` que alguien tiene que
    -- mirar: la pasada no aborta a propósito, así que este número es lo único
    -- que lo cuenta. `refunds_failed` además deja reservas sin cerrar.
    'credits_failed',     v_fallos_cred,
    'refunds_failed',     v_fallos_ref
  );
end;
$function$;

-- ── cancel_booking ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_bk       record;
  v_is_tutor boolean;
  v_earliest timestamptz;
  v_pay      record;
  v_pct      int;
  v_refund   bigint := 0;   -- acumulado tras esta cancelación
  v_prev     bigint := 0;   -- lo que ya se había devuelto antes
  v_delta    bigint := 0;   -- lo que hay que mover DE VERDAD ahora
  v_reparto  jsonb  := jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
begin
  select id, student_id, tutor_id, status, mandatory, academy_id
    into v_bk
  from public.bookings
  where id = p_booking_id
    and (student_id = v_uid or tutor_id = v_uid)
    and status in ('pending_payment', 'pending_acceptance', 'confirmed');
  if v_bk.id is null then
    raise exception 'reserva no cancelable o inexistente' using errcode = 'check_violation';
  end if;

  v_is_tutor := (v_uid = v_bk.tutor_id);

  -- A · RA-24: una clase asignada por la academia no la cancela el alumno.
  if not v_is_tutor and v_bk.mandatory then
    raise exception 'Esta clase es obligatoria; habla con %',
      coalesce((select a.name from public.academies a where a.id = v_bk.academy_id), 'tu academia')
      using errcode = 'check_violation';
  end if;

  -- G · RG-16: de un ciclo grupal el alumno solo se da de baja ANTES de la
  -- primera fecha. Sin esto, quien faltó a la primera (su reserva sigue
  -- 'confirmed', no 'in_progress') cancelaría a mitad de ciclo y RN-37, que
  -- mira la próxima sesión agendada, le devolvería el ciclo entero. Las
  -- fechas que canceló el tutor no cuentan como empezadas.
  if not v_is_tutor and exists (
    select 1 from public.sessions s
     where s.booking_id = p_booking_id and s.group_class_id is not null
       and s.status <> 'cancelled' and s.start_at <= now()
  ) then
    raise exception 'la clase ya empezó: ya no puedes darte de baja' using errcode = 'check_violation';
  end if;

  -- RN-37 sobre la sesión más próxima aún agendada.
  select min(start_at) into v_earliest
  from public.sessions
  where booking_id = p_booking_id and status = 'scheduled';

  if v_is_tutor then
    v_pct := 100;
  elsif v_earliest is null or v_earliest - now() >= interval '24 hours' then
    v_pct := 100;
  else
    v_pct := 50;
  end if;

  -- G · RG-11: si el tutor movió una fecha de la clase, el alumno al que no
  -- le sirva la hora nueva se va con el 100 % aunque falten menos de 24 h.
  if not v_is_tutor and v_pct < 100 and exists (
    select 1 from public.sessions s
      join public.group_classes g on g.id = s.group_class_id
     where s.booking_id = p_booking_id and s.status = 'scheduled'
       and g.rescheduled_at is not null
  ) then
    v_pct := 100;
  end if;

  -- Reembolso solo si el pago fue capturado.
  select id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where booking_id = p_booking_id;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev   := coalesce(v_pay.refunded_amount, 0);
    v_refund := round(v_pay.gross_amount * v_pct / 100.0);
    -- El acumulado no retrocede jamás.
    v_refund := greatest(v_refund, v_prev);
    v_delta  := v_refund - v_prev;

    update public.payments
      set status = (case when v_pct >= 100 then 'refunded' else 'partially_refunded' end)::public.payment_status,
          refunded_amount = v_refund
      where booking_id = p_booking_id;

    -- 🔴 NUEVO · SE PARTE EL TRAMO. Antes esto encolaba `v_delta` entero contra
    -- la pasarela. Reserva de 180 con 45 de crédito y 135 de tarjeta, cancelada
    -- a menos de 24 h: `v_delta` = 90 contra un cargo de 135. El PSP lo acepta
    -- y **el alumno recibe 90 en efectivo por 135 que puso**, cuando lo suyo
    -- eran 67,5. Y el crédito se quedaba consumido encima.
    --
    -- `p_ya_devuelto` es `v_prev`, el acumulado de ANTES: el `update` de encima
    -- ya movió la fila, así que leerlo de ahí dentro daría el de después y el
    -- reparto se desplazaría un tramo entero. Pasarlo explícito es lo que hace
    -- que el orden de estas dos sentencias deje de ser load-bearing.
    v_reparto := public.reembolsar_con_credito(
      v_pay.id,
      v_delta,
      v_prev,
      'RN-37 · cancela ' || (case when v_is_tutor then 'el tutor' else 'el alumno' end)
        || ' (' || v_pct || ' %)',
      'X01:payment:' || v_pay.id || ':' || v_refund
    );

  elsif v_pay.status = 'pending' then
    -- Nunca se cobró (pending_payment): sin reembolso. Este 'failed' es además
    -- el que hace que X-02 rechace un cobro que llegue tarde por esta reserva.
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    -- 🔴 NUEVO · Y LA CUARTA PUERTA: cancelar a mano una reserva sin pagar con
    -- el crédito ya aplicado. `payments` acaba de quedar bloqueado por el
    -- update de arriba, así que el orden payments → credits se conserva.
    perform public.liberar_credito_de_pago(v_pay.id);
    v_refund := 0;
  end if;

  update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
    where id = p_booking_id;
  update public.sessions set status = 'cancelled', cancelled_at = now()
    where booking_id = p_booking_id and status = 'scheduled';

  -- `refund_amount` sigue siendo el ACUMULADO EN PRECIO, que es lo que la
  -- pantalla enseña como "se te devolverá X": la forma NO cambia, la consume
  -- cancel-form.tsx. Las claves nuevas son aditivas y son lo que hay que enseñar
  -- cuando hubo crédito: «135 a tu tarjeta, 45 a tu saldo».
  --
  -- ⚠️ Y AQUÍ HAY UNA TENTACIÓN QUE HAY QUE RESISTIR. Cancelar al 50 % una
  -- reserva pagada al 100 % con una mentoría gratis no devuelve NADA (el premio
  -- es todo o nada, ver `reembolsar_con_credito`) y sin embargo esta función
  -- escribe igualmente `refunded_amount = 600` y `partially_refunded`: el estado
  -- afirma una devolución que no existió. Lo correcto NO es escribir ahí lo que
  -- de verdad se movió: `payments.refunded_amount` es la base de la fórmula
  -- acumulada, y si deja de ser el precio acumulado, el siguiente tramo se
  -- calcula sobre una base más baja y la suma de los tramos en efectivo PUEDE
  -- PASARSE de lo que la pasarela cobró — que es exactamente la fuga que el tope
  -- de `enqueue_refund` está ahí para frenar. Así que el libro se queda en
  -- precio y la VERDAD se cuenta aparte, con tres números: lo que va a la
  -- tarjeta, lo que vuelve al saldo y lo que se pierde.
  return jsonb_build_object(
    'refund_pct',            v_pct,
    'refund_amount',         v_refund,
    'refund_cash',           coalesce((v_reparto ->> 'cash')::bigint, 0),
    'refund_credit',         coalesce((v_reparto ->> 'credit')::bigint, 0),
    'refund_credit_perdido', coalesce((v_reparto ->> 'credito_perdido')::bigint, 0)
  );
end;
$function$;

-- ── proponer_reagenda ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proponer_reagenda(p_session_id uuid, p_new_start timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_s    record;
  v_rol  text;
  v_dia  date := (p_new_start at time zone 'UTC')::date;
  v_id   uuid;
begin
  select se.id, se.booking_id, se.student_id, se.tutor_id, se.start_at, se.status,
         se.group_class_id, b.product_id, b.status as booking_status,
         b.mandatory, b.academy_id
    into v_s
    from public.sessions se
    join public.bookings b on b.id = se.booking_id
   where se.id = p_session_id
     for update of se;

  if not found then
    raise exception 'No encontramos esa sesión.' using errcode = 'no_data_found';
  end if;

  v_rol := case v_uid when v_s.student_id then 'student' when v_s.tutor_id then 'tutor' end;
  if v_rol is null then
    raise exception 'No participas en esta sesión.' using errcode = 'insufficient_privilege';
  end if;

  -- G · RG-11: en una clase grupal nadie propone. El tutor mueve la fecha
  -- para todos con reagendar_clase_grupal.
  if v_s.group_class_id is not null then
    raise exception 'En una clase grupal la hora la cambia el tutor.';
  end if;

  -- A · RA-24: la obligatoria no la reagenda el alumno.
  if v_rol = 'student' and v_s.mandatory then
    raise exception 'Esta clase es obligatoria; habla con %',
      coalesce((select a.name from public.academies a where a.id = v_s.academy_id), 'tu academia');
  end if;

  if v_s.status <> 'scheduled' or v_s.booking_status not in ('confirmed', 'in_progress') then
    raise exception 'Esta sesión ya no se puede reagendar.';
  end if;

  -- §14: con al menos 24 h de antelación respecto de la hora PROGRAMADA.
  if v_s.start_at < now() + interval '24 hours' then
    raise exception 'Solo se puede reagendar con al menos 24 horas de anticipación.';
  end if;

  if p_new_start = v_s.start_at then
    raise exception 'Esa ya es la hora de la sesión.';
  end if;

  -- La disponibilidad la decide la misma función que alimenta la reserva: un
  -- día a cada lado porque sus fechas son de pared del tutor, no UTC.
  if not exists (
    select 1
      from public.get_available_slots(v_s.product_id, v_dia - 1, v_dia + 1) g
     where g.slot_start = p_new_start
  ) then
    raise exception 'Ese horario ya no está disponible. Elige otro.';
  end if;

  if exists (
    select 1 from public.session_reschedules r
     where r.session_id = p_session_id and r.status = 'pending' and r.proposed_by <> v_rol
  ) then
    raise exception 'Hay una propuesta de la otra parte esperando tu respuesta.';
  end if;

  update public.session_reschedules
     set status = 'withdrawn', responded_at = now()
   where session_id = p_session_id and status = 'pending';

  insert into public.session_reschedules (session_id, proposed_by, old_start_at, new_start_at)
  values (p_session_id, v_rol, v_s.start_at, p_new_start)
  returning id into v_id;

  perform public.enqueue_notification(
    case v_rol when 'student' then v_s.tutor_id else v_s.student_id end,
    'NTF-RSC', 'email', 'reschedule_requested',
    jsonb_build_object(
      'booking_id', v_s.booking_id,
      'session_id', v_s.id,
      'antes',      public.iso_utc(v_s.start_at),
      'propuesta',  public.iso_utc(p_new_start),
      'para',       case v_rol when 'student' then 'tutor' else 'student' end
    ),
    'RSC:' || v_id || ':requested'
  );

  return v_id;
end;
$function$;

-- ── aplicar_credito ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_credito(p_booking_id uuid, p_credit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_b       record;
  v_p       record;
  v_c       record;
  v_r       jsonb;
  v_cubre   bigint;
  v_caja    bigint;
  v_falta   bigint;
  v_funding text;
  v_abierto boolean;
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  select b.id, b.product_id, b.num_sessions, b.academy_id
    into v_b
  from public.bookings b
  where b.id = p_booking_id and b.student_id = v_uid;
  if v_b.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- A · RA-13: a las academias no les aplican créditos.
  if v_b.academy_id is not null then
    raise exception 'los créditos no sirven para clases de academia' using errcode = 'check_violation';
  end if;

  -- ⚠️ ORDEN DE BLOQUEO: `payments` primero, `credits` después. Es el mismo que
  -- toman expire_stale_bookings, confirm_payment y refund_payment. Invertirlo
  -- aquí crearía el ciclo de deadlock que hoy no existe.
  select p.* into v_p from public.payments p where p.booking_id = p_booking_id for update;
  if v_p.id is null then
    raise exception 'esta reserva no tiene cobro' using errcode = 'no_data_found';
  end if;

  -- Cerrojo 1 — solo antes de cobrar. El mismo que `set_charge_provider`
  -- (`20260910120000:303`) y por la misma razón.
  if v_p.status <> 'pending' then
    raise exception 'el pago de esta reserva ya está en %', v_p.status
      using errcode = 'check_violation';
  end if;

  -- Cerrojo 3 (S9) — esta reserva ya tiene crédito. Sin esto, un doble clic o
  -- dos pestañas pisan `payments.credit_id` y el PRIMER crédito se queda
  -- `consumed` sin que nada lo devuelva: `quitar_credito` solo sabe deshacer lo
  -- que `payments.credit_amount` dice AHORA.
  if v_p.credit_id is not null then
    raise exception 'esta reserva ya tiene un crédito aplicado'
      using errcode = 'check_violation',
            hint = 'Quítalo antes con quitar_credito si quieres usar otro.';
  end if;

  -- ⚠️ Y LA FECHA, QUE FALTABA. `status = 'active'` no basta: `caducar_creditos`
  -- corre UNA VEZ AL DÍA (03:17), así que un crédito vencido a las 00:01 sigue
  -- diciendo 'active' durante ~27 horas y hasta hoy se podía gastar entero.
  -- El barrido es el que ORDENA la caducidad; quien la DECIDE es esta fecha.
  select c.* into v_c
  from public.credits c
  where c.id = p_credit_id
    and c.beneficiary_id = v_uid
    and c.status  = 'active'
    and c.destino = 'cobro'
    and (c.expires_at is null or c.expires_at > now())
  for update;
  if v_c.id is null then
    raise exception 'crédito no disponible' using errcode = 'no_data_found';
  end if;

  -- ⚠️ SE RECALCULA AQUÍ, NO SE CONFÍA EN EL NAVEGADOR (regla de oro 2). Lo
  -- único que manda el navegador es un `credit_id`; el importe sale de
  -- `payments.gross_amount` y del propio crédito, ya bloqueados.
  v_r := public.credito_aplicable(
           v_c.kind, v_c.source, v_c.amount, v_c.consumed_amount,
           v_c.currency, v_c.product_id,
           v_p.gross_amount, v_b.num_sessions, v_p.currency, v_b.product_id);

  if not (v_r ->> 'usable')::boolean then
    raise exception '%', coalesce(v_r ->> 'motivo', 'este crédito no se puede usar aquí')
      using errcode = 'check_violation';
  end if;
  v_cubre := (v_r ->> 'cubre')::bigint;

  -- 🔴 CERROJO 2 — Y AHORA NO ESTÁ VACÍO. Ver §3. Las tres señales valen; la
  -- que de verdad sostiene el caso normal es `checkout_opened_at`, porque las
  -- otras dos se escriben tarde o no se escriben. Y se consiente el caso en que
  -- el cobro abierto YA es por el importe que quedaría: eso significa que el
  -- marcador y el crédito cuadran y no hay nada que explotar (es lo que pasa
  -- cuando dos pestañas aplican el mismo crédito).
  v_abierto := v_p.provider_payment_id is not null
            or coalesce(v_p.provider_metadata, '{}'::jsonb) ? 'checkout'
            or v_p.checkout_opened_at is not null;

  if v_abierto and coalesce(v_p.checkout_amount, -1) <> (v_p.gross_amount - v_cubre) then
    raise exception 'ya hay un cobro abierto para esta reserva por otro importe'
      using errcode = 'check_violation',
            hint = 'Ciérralo o espera a que caduque la reserva antes de cambiar el crédito.';
  end if;

  -- ── EL FONDEO (quién pone el dinero con el que se paga al tutor) ──────────
  --
  -- `funding_provider` es el PSP donde está la CAJA de este cobro;
  -- `platform_funded_amount` es lo que falta en esa caja para pagarle al tutor.
  --
  -- 🔴 NO SE REIMPLEMENTA AQUÍ. La aritmética vive en
  -- `public.fondeo_del_cobro()` (`20260912100000:249`), cuyo propio
  -- `comment on column` dice que es la única válida y que esta función tiene que
  -- llamarla. Había dos versiones y NO daban lo mismo: ésta sumaba las dos cajas
  -- (la del regalo y la del cobro) y eso INFRA-FONDEA el payout, porque un
  -- payout se ejecuta contra UN SOLO BALANCE. Regalo de 6000 cobrado por dLocal,
  -- el tutor sube el precio a 20000, el destinatario paga 14000 por Stripe y el
  -- neto del tutor es 16000: sumando cajas sale «la plataforma pone 0» cuando a
  -- Stripe —que es quien va a pagar— le faltan 2000. `fondeo_del_ciclo` no
  -- enseñaría el hueco, operaciones no transferiría nada y la orden se iría a
  -- `failed` por saldo semanas después, que es exactamente el fallo que las dos
  -- migraciones dicen venir a evitar.
  --
  -- Con una sola caja las dos fórmulas siguen coincidiendo donde tienen que
  -- coincidir (regalo que cubre el neto → se paga desde el PSP del regalo y el
  -- fondeo es 0), que es el caso que el diagrama describe.
  select f.funding_provider, f.caja, f.platform_funded_amount
    into v_funding, v_caja, v_falta
  from public.fondeo_del_cobro(
         v_p.gross_amount,
         v_p.tutor_net_amount,
         v_cubre,            -- lo que el crédito pone EN ESTE cobro
         v_p.provider,       -- quién procesa el cargo
         v_c.source,         -- 'gift' = ya hay caja; 'referral' = la pone la casa
         -- 🔴 LO QUE DEL REGALO SIGUE SIN COMPROMETER, no lo que se cobró.
         --    Cambiado el 16-sep-2026 y es DINERO: hasta entonces un regalo era
         --    siempre `kind='mentoria'` y se gastaba de una vez, así que la caja
         --    se contaba una sola vez y las dos expresiones coincidían
         --    (`consumed_amount` vale 0 al aplicarlo). Desde
         --    `20260916100000_el_regalo_sobrevive_al_tutor.sql` un regalo puede
         --    convertirse en BONO (`kind='saldo'`) cuando el tutor se da de baja,
         --    y un bono SÍ se parte entre varias reservas: con `v_c.amount` la
         --    misma caja se contaría ENTERA en cada una. Regalo de 10000, dos
         --    reservas de neto 9600: `platform_funded_amount` = 0 en las dos
         --    cuando de verdad faltan 9200 — `fondeo_del_ciclo` no enseñaría el
         --    hueco, operaciones no transferiría nada y la orden se iría a
         --    `failed` por saldo semanas después. Es exactamente el fallo que
         --    `20260912100000` dice venir a evitar, entrando por la otra puerta.
         v_c.amount - v_c.consumed_amount,
         v_c.provider        -- y dónde está esa caja
       ) f;

  update public.payments p
     set credit_id              = p_credit_id,
         credit_amount          = v_cubre,
         funding_provider       = v_funding,
         platform_funded_amount = v_falta
   where p.id = v_p.id;

  -- ⚠️ 'mentoria' CONSUME EL TOPE ENTERO. `amount` es un tope, no un importe:
  -- el sobrante es de la plataforma. Escribir `consumed_amount + v_cubre`
  -- violaría `credits_mentoria_entera` en cuanto la mentoría cueste menos que
  -- el tope, que es siempre — y ese es el `check` que hacía que la mentoría
  -- gratis no funcionara nunca.
  update public.credits c
     set consumed_amount = case when c.kind = 'mentoria'
                                then c.amount
                                else c.consumed_amount + v_cubre end,
         status = case when (case when c.kind = 'mentoria'
                                  then c.amount
                                  else c.consumed_amount + v_cubre end) >= c.amount
                       then 'consumed' else c.status end,
         -- ⚠️ `consumed_at` SOLO CUANDO SE GASTA DEL TODO. Un saldo parcial
         -- sigue 'active' con dinero dentro, y sellarle la fecha de consumo hace
         -- que `mis_regalos_comprados.canjeado` —que se deriva de esta columna—
         -- diga «canjeado» de algo que todavía se puede gastar.
         consumed_at = case when (case when c.kind = 'mentoria'
                                       then c.amount
                                       else c.consumed_amount + v_cubre end) >= c.amount
                            then now() else c.consumed_at end
   where c.id = p_credit_id;

  return jsonb_build_object(
    'credit_id',              p_credit_id,
    'gross_amount',           v_p.gross_amount,
    'credit_amount',          v_cubre,
    'a_pagar',                v_p.gross_amount - v_cubre,
    'funding_provider',       v_funding,
    'platform_funded_amount', v_falta
  );
end;
$function$;

-- ── comprar_regalo ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comprar_regalo(p_product_id uuid, p_recipient_email text, p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer    uuid := (select auth.uid());
  v_correo   text := lower(btrim(coalesce(p_recipient_email, '')));
  v_mio      text;
  v_prod     record;
  v_total    bigint;
  v_payer    char(2);
  v_provider text;
  v_abiertos int;
  v_id       uuid;
begin
  if v_buyer is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  if v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'ese correo no parece un correo' using errcode = 'check_violation';
  end if;

  select lower(btrim(u.email)) into v_mio from auth.users u where u.id = v_buyer;
  if v_correo = v_mio then
    raise exception 'no puedes regalarte a ti mismo' using errcode = 'check_violation';
  end if;

  -- ⚠️ EL TOPE DE REGALOS SIN PAGAR, Y NO ES ADORNO. Esta RPC la puede llamar
  -- cualquier sesión y CREA FILAS EN LA TABLA DEL DINERO: sin límite, un usuario
  -- con sesión las fabrica a ritmo de petición. Nacen sin cobrar y
  -- `caducar_creditos` las revoca a los 30 días, pero entretanto están ahí, se
  -- las pinta `mis_regalos_comprados` enteras y son el material perfecto para
  -- que un incidente de verdad pase desapercibido entre el ruido.
  --
  -- Tres a la vez es generoso para el caso real (se compra uno, se paga, y si
  -- el pago se cae se reintenta) y ridículo para un bucle. No es un `check` de
  -- tabla porque un `check` no puede contar filas de la propia tabla.
  select count(*) into v_abiertos
    from public.credits c
   where c.purchased_by = v_buyer
     and c.status = 'pending_payment'
     and (c.expires_at is null or c.expires_at > now());
  if v_abiertos >= 3 then
    raise exception 'tienes % regalos sin pagar: termina o abandona uno antes de empezar otro', v_abiertos
      using errcode = 'check_violation',
            hint = 'Un regalo sin pagar se abandona solo a los 30 días.';
  end if;

  -- ⚠️ NO SE RESUELVE AQUÍ SI ESE CORREO TIENE CUENTA. Escribir
  -- `beneficiary_id` antes de cobrar convierte esta pantalla en un oráculo
  -- gratis de existencia de cuentas para cualquier dirección: el comprador lee
  -- su propia fila por `credits_select_comprador` y ve si vino resuelta, sin
  -- llegar a pagar nunca. Hoy `profiles` es own-only y esto sería una
  -- regresión. Se resuelve en `confirm_gift_payment`, después de que el dinero
  -- se mueva, que es lo que le pone precio a la pregunta.
  select p.id, p.tutor_id, p.pricing_model, p.price_amount, p.currency,
         p.session_duration_min, p.academy_id, p.capacity
    into v_prod
  from public.products p
  join public.tutor_profiles tp on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  where p.id = p_product_id and p.status = 'active';
  if v_prod.id is null then
    raise exception 'producto no reservable' using errcode = 'check_violation';
  end if;

  -- A · RA-13: las clases de academia no se regalan.
  if v_prod.academy_id is not null then
    raise exception 'las clases de academia no se pueden regalar' using errcode = 'check_violation';
  end if;

  -- G · RG-17: un cupo se regala con cupos libres y a más de 24 h de la
  -- primera fecha. (Si al canjearlo ya no hay cupo, el regalo queda como
  -- crédito sin gastar: create_booking_line rechaza la reserva y nada lo consume.)
  if v_prod.pricing_model = 'group' then
    if coalesce((select min(g.start_at) from public.group_classes g
                  where g.product_id = v_prod.id and g.status <> 'cancelled'), now())
       <= now() + interval '24 hours' then
      raise exception 'esta clase ya no se puede regalar' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.bookings bk
         where bk.product_id = v_prod.id and bk.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress')) >= v_prod.capacity then
      raise exception 'esta clase ya no tiene cupos para regalar' using errcode = 'check_violation';
    end if;
  end if;

  if v_prod.tutor_id = v_buyer then
    raise exception 'no puedes regalar tu propia mentoría' using errcode = 'check_violation';
  end if;

  -- Precio congelado AQUÍ y no en el navegador (regla de oro 2), con la misma
  -- aritmética de `create_booking_line` (`20260910120000:176-180`).
  v_total := case
    when v_prod.pricing_model = 'per_hour'
      then round(v_prod.price_amount * v_prod.session_duration_min / 60.0)
    else v_prod.price_amount
  end;
  if v_total <= 0 then
    raise exception 'esa mentoría no tiene precio' using errcode = 'check_violation';
  end if;

  -- El cobro lo decide el país del que PAGA (docs/DICTADO-PAGOS.md), y quien
  -- paga aquí es el comprador.
  select public.pais_de_cobro_por_zona(pr.timezone) into v_payer
    from public.profiles pr where pr.id = v_buyer;

  select (public.ruta_de_pago(v_payer)).charge_providers[1] into v_provider;
  if v_provider is null then
    raise exception 'sin ruta de pago disponible' using errcode = 'check_violation';
  end if;

  -- ⚠️ NO CREA RESERVA, NI `sessions`, NI TOCA LA AGENDA DEL TUTOR. El regalo
  -- no bloquea un hueco: eso lo hace el destinatario cuando agende. Y por eso
  -- `expire_stale_bookings` no tiene nada que caducar aquí; si el comprador
  -- abandona el pago, la fila se queda en 'pending_payment' y la barre
  -- `caducar_creditos()`.
  insert into public.credits (
    beneficiary_email, source, kind, destino, status, amount, currency,
    product_id, purchased_by, gift_message, provider, payer_country, expires_at
  ) values (
    v_correo, 'gift', 'mentoria', 'cobro', 'pending_payment', v_total, v_prod.currency,
    v_prod.id, v_buyer, nullif(left(btrim(coalesce(p_message, '')), 500), ''),
    v_provider, v_payer,
    -- Caducidad provisional del cobro sin terminar: si nadie paga, esto lo barre
    -- el cron. Al confirmarlo se reescribe con la de verdad (gift_expiry_days).
    now() + interval '30 days'
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- ── referral_conversions_pending ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.referral_conversions_pending(p_limit integer DEFAULT 50)
 RETURNS TABLE(profile_id uuid, first_name text, email text, referral_code text, rf_campaign_id integer, audience text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id,
         nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') as first_name,
         u.email::text,
         p.referral_code,
         m.rf_campaign_id,
         c.audience
    from public.profiles p
    join auth.users u on u.id = p.id
    join public.referral_memberships m on m.code = p.referral_code
    join public.referral_campaigns   c on c.rf_campaign_id = m.rf_campaign_id
   where p.referral_converted_at is null
     and p.referral_code is not null
     and m.profile_id <> p.id
     and u.email is not null
     and (
       (c.audience = 'alumnos' and exists (
          select 1
            from public.payments pay
            join public.bookings b on b.id = pay.booking_id
           where b.student_id = p.id
             and pay.status = 'paid'
             and b.academy_id is null))   -- A · RA-13
       or
       (c.audience = 'tutores' and exists (
          select 1
            from public.sessions s
           where s.tutor_id = p.id
             and s.status = 'completed')
        and not exists (select 1 from public.tutor_profiles tp     -- A · RA-13
                         where tp.profile_id = p.id and tp.academy_id is not null))
     )
   order by p.created_at
   -- Acotado como en `pending_email_notifications`: el lote del cron son 50, y
   -- un `p_limit` sin techo era media base de datos en una sola llamada.
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

-- La guarda grupal también salta al colgar una grupal de una academia.
drop trigger if exists products_guarda_grupal on public.products;
create trigger products_guarda_grupal
  before insert or update of pricing_model, status, academy_id on public.products
  for each row execute function public.products_guarda_grupal();


-- ── build_payout_for_academy (RA-10/11) ─────────────────────────────────────
create or replace function public.build_payout_for_academy(
  p_academy        uuid,
  p_retention_days integer,
  p_status         public.payout_status default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_retention_days);
  v_owner  uuid;
  v_rec    record;
  v_payout uuid;
begin
  select a.owner_id into v_owner from public.academies a where a.id = p_academy;
  if v_owner is null then
    return null;   -- sin administrador no hay beneficiario; el dinero espera
  end if;

  -- Misma agrupación que el builder del tutor: un payout por moneda, caja y
  -- país, para que cada orden sea pagable por un solo riel.
  for v_rec in
    select p.currency,
           coalesce(p.funding_provider, p.provider) as funding_provider,
           p.payee_country                          as payee_country,
           sum(public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)) as total,
           sum(public.parte_del_tutor(p.platform_funded_amount, p.gross_amount, p.refunded_amount)) as falta,
           array_agg(p.id)                          as payment_ids
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.academy_id = p_academy
       and (p.status = 'paid'
            or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
       and b.status = 'completed'
       and b.completed_at <= v_cutoff              -- retención vencida (DP-02), igual que los tutores
       and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id)
     group by p.currency, coalesce(p.funding_provider, p.provider), p.payee_country
  loop
    insert into public.payouts (tutor_id, academy_id, status, currency, amount,
                                funding_provider, payee_country,
                                platform_funded_amount,
                                retention_until, scheduled_for)
    values (v_owner, p_academy, p_status, v_rec.currency, v_rec.total,
            v_rec.funding_provider, v_rec.payee_country,
            coalesce(v_rec.falta, 0), v_cutoff, now())
    returning id into v_payout;

    insert into public.payout_items (payout_id, payment_id, amount)
    select v_payout, pid, public.parte_del_tutor(p.tutor_net_amount, p.gross_amount, p.refunded_amount)
      from unnest(v_rec.payment_ids) as pid
      join public.payments p on p.id = pid;
  end loop;

  return v_payout;
end;
$$;

comment on function public.build_payout_for_academy(uuid, integer, public.payout_status) is
  'RA-10/11 · gemela de build_payout_for_tutor para el dinero de una academia: reservas con academy_id completadas y con la retención vencida → payouts con tutor_id = owner_id (beneficiario) y academy_id. Sin créditos (RA-13). Sin owner_id devuelve NULL y no crea nada.';

revoke execute on function public.build_payout_for_academy(uuid, integer, public.payout_status) from public, anon, authenticated;
grant  execute on function public.build_payout_for_academy(uuid, integer, public.payout_status) to service_role;


-- ── run_payout_batch: tutores (arreglado) y academias ───────────────────────
create or replace function public.run_payout_batch(p_retention_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor     uuid;
  v_academia  uuid;
  v_made      int := 0;
  v_made_ac   int := 0;
  v_tutores   uuid[];
  v_academias uuid[];
  v_hay_cred  boolean := to_regclass('public.credits') is not null;
begin
  -- Tutores con algo que cobrar. 🔴 ARREGLO: la MISMA regla que
  -- build_payout_for_tutor (paid, o grupal prorrateada) y sin lo de academia.
  select coalesce(array_agg(distinct b.tutor_id), '{}'::uuid[])
    into v_tutores
    from public.payments p
    join public.bookings b on b.id = p.booking_id
   where (p.status = 'paid'
          or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
     and b.academy_id is null
     and b.status = 'completed'
     and b.completed_at <= now() - make_interval(days => p_retention_days)
     and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id);

  -- Recompensas en dinero pendientes (sin cambios).
  if v_hay_cred then
    select v_tutores || coalesce(array_agg(distinct c.beneficiary_id), '{}'::uuid[])
      into v_tutores
      from public.credits c
     where c.beneficiary_id is not null
       and c.destino = 'payout'
       and c.status  = 'active'
       and c.amount  > c.consumed_amount
       and not exists (select 1 from public.payout_adjustments pa where pa.credit_id = c.id);
  end if;

  for v_tutor in select distinct u.tutor_id from unnest(v_tutores) as u(tutor_id) order by 1
  loop
    if public.build_payout_for_tutor(v_tutor, p_retention_days, 'scheduled') is not null then
      v_made := v_made + 1;
    end if;
  end loop;

  -- A · academias con dinero y con administrador a quien pagar.
  select coalesce(array_agg(distinct b.academy_id), '{}'::uuid[])
    into v_academias
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    join public.academies a on a.id = b.academy_id
   where a.owner_id is not null
     and (p.status = 'paid'
          or (p.status = 'partially_refunded' and b.pricing_model = 'group'))
     and b.status = 'completed'
     and b.completed_at <= now() - make_interval(days => p_retention_days)
     and not exists (select 1 from public.payout_items pi where pi.payment_id = p.id);

  foreach v_academia in array v_academias loop
    if public.build_payout_for_academy(v_academia, p_retention_days, 'scheduled') is not null then
      v_made_ac := v_made_ac + 1;
    end if;
  end loop;

  return jsonb_build_object('tutors_paid_out', v_made, 'academies_paid_out', v_made_ac);
end;
$$;
