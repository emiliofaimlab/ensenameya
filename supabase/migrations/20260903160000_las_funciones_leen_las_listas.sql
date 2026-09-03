-- ============================================================================
-- Enséñame Ya — las tres funciones que leían las columnas eliminadas.
--
-- `20260903140000` cambió `charge_provider`/`payout_provider` (singulares) por
-- `charge_providers`/`payout_providers` (listas ordenadas), y eso dejó ROTAS EN
-- RUNTIME tres funciones del camino del dinero. El typecheck no podía verlo: es
-- SQL dentro de Postgres.
--
--   create_booking_line        → crear una reserva. La más grave: sin esto no se
--                                puede vender nada.
--   confirm_simulated_payment  → confirmar un pago simulado.
--   payouts_backlog            → el único termómetro de dinero atascado.
--
-- (`build_payout_for_tutor` también las nombraba, pero solo en un comentario:
-- comprobado, no estaba rota.)
--
-- ── LO QUE CAMBIA EN CADA UNA, Y LO QUE NO ──────────────────────────────────
--
-- Las tres se reemplazan ENTERAS con su definición vigente y un cambio mínimo:
-- se copian de `pg_get_functiondef` y se toca solo lo que lee esas columnas. Lo
-- demás —candados, grants, guardas, mensajes— queda literal.
--
-- Y en `payouts_backlog` hay dos contadores que no se traducen a la nueva forma
-- con un simple cambio de nombre, porque con LISTAS la pregunta es otra:
--
--   `balance_ajeno`  pasa de «¿coincide el ejecutor con quien cobró?» a
--                    «¿NINGÚN candidato puede pagar esta orden?». Un candidato
--                    fondeado aparte (wise, paypal, manual…) no depende de quién
--                    cobró, así que basta uno de esos para que la orden no sea
--                    impagable por balance.
--   `sin_datos_de_cobro` pasa a mirar la tabla que corresponde a la FAMILIA de
--                    dato que pide el riel: coordenadas bancarias o un
--                    identificador. Un país puede tener candidatos de las dos
--                    —Colombia lo es— y manda la bancaria, porque es la de los
--                    rieles que van a pagar de verdad.
--
-- ⚠️ Ninguna de las dos comprueba si un candidato tiene ADAPTADOR: eso solo lo
-- sabe `src/lib/payments.ts`, y replicarlo en SQL crearía dos fuentes de verdad
-- que se desincronizan en el primer despliegue. El termómetro dice qué es
-- imposible por los datos; qué es imposible por falta de código lo dice el job.
-- ============================================================================

-- ── 1 · create_booking_line ────────────────────────────────────────────────
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
  select charge_providers[1] into v_provider
  from public.payment_routing_rules
  where is_active and payee_country is not distinct from v_payee and payer_country is null
  order by priority
  limit 1;
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

-- ── 2 · confirm_simulated_payment ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_simulated_payment(p_booking_id uuid, p_success boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_provider text;
begin
  -- Sigue siendo tuya o no existe (mismo mensaje: no se filtra si la reserva
  -- existe y es de otro).
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.student_id = (select auth.uid())
  ) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- ── Cerrojo 1 (NUEVO): ¿está la plataforma entera en simulado? ────────────
  -- Se mira ANTES que el snapshot de la reserva a propósito: es el que no
  -- depende de ningún dato que el usuario pueda mover. Si alguien encendió un
  -- cobrador real en cualquier corredor, aquí ya no se confirma nada.
  if exists (
    select 1 from public.payment_routing_rules r
     where r.is_active
       and r.charge_providers[1] is distinct from 'simulated'
  ) then
    raise exception 'un cobro real solo lo confirma el proveedor de pago'
      using errcode = 'insufficient_privilege';
  end if;

  -- ── Cerrojo 2: el de siempre, sobre el snapshot de ESTA reserva ───────────
  -- Se conserva y no es redundante: cubre la reserva creada antes de que se
  -- encendiera el proveedor real, que sigue teniendo 'simulated' congelado en
  -- su `payments` y no debe confirmarse por esta puerta.
  select p.provider into v_provider
    from public.payments p where p.booking_id = p_booking_id;

  if v_provider is distinct from 'simulated' then
    raise exception 'un cobro real solo lo confirma el proveedor de pago'
      using errcode = 'insufficient_privilege';
  end if;

  return public.confirm_payment(p_booking_id, p_success);
end;
$function$;

-- ── 3 · payouts_backlog ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payouts_backlog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(

    -- El reparto completo, sin interpretar. Si aquí aparece un estado que no
    -- esperabas, empieza por ahí.
    'por_estado', (
      select coalesce(jsonb_object_agg(t.estado, t.n), '{}'::jsonb)
        from (
          select p.status::text as estado, count(*) as n
            from public.payouts p
           group by 1
        ) t
    ),

    -- 🔴 LA CIFRA QUE NUNCA PUEDE QUEDARSE ARRIBA. Órdenes reclamadas de las que
    -- no se sabe si el proveedor llegó a crear el payout. No se resuelven solas
    -- (a propósito): hay que mirar el panel del PSP y anotar el id, o confirmar
    -- que no existe y devolver la fila a 'scheduled'.
    --   select id, tutor_id, amount, currency, provider_metadata
    --     from public.payouts
    --    where status = 'processing' and provider_payout_id is null;
    --
    -- 🔑 Y NO HAY QUE BUSCARLAS POR IMPORTE Y FECHA: cada payout que manda C2
    -- lleva su marca dentro. En dLocal Go va en `description` y es
    -- `EY-<payouts.id>-<intento>`, con el intento en
    -- `provider_metadata -> 'c2' -> 'intento'` (1 si no está). O sea que la fila
    -- de arriba se busca en el panel del proveedor pegando esa cadena, y la
    -- respuesta es sí o no — no «se le parece». Los ids de intentos anteriores
    -- que el proveedor dio por muertos quedan en
    -- `provider_metadata -> 'c2' -> 'intentos_muertos'`.
    --
    -- ⚠️ El riel manual NO pasa por aquí. Una orden pagada a mano no se queda en
    -- 'processing': `manage_payout(id,'mark_paid',referencia,canal)` la cierra en
    -- 'paid' en el mismo momento, con la referencia de la transferencia como
    -- `provider_payout_id`. Si aparece una fila venezolana en este contador, lo
    -- que hay que mirar es quién la puso en 'processing', no el panel de un PSP.
    'sin_identificar', (
      select count(*) from public.payouts p
       where p.status = 'processing'::public.payout_status
         and p.provider_payout_id is null
    ),

    -- En vuelo CON identificador: creadas en el proveedor y esperando a que el
    -- dinero llegue. dLocal Go las crea en PENDING, así que esto es lo normal
    -- entre el envío y el cobro; solo preocupa si no baja nunca.
    'en_vuelo', (
      select count(*) from public.payouts p
       where p.status = 'processing'::public.payout_status
         and p.provider_payout_id is not null
    ),

    -- Lo que hay delante ahora mismo. Mismo criterio que
    -- `process_scheduled_payouts()`, para que las dos cifras se puedan contrastar.
    -- ⚠️ INCLUYE las del riel manual, que el job no puede tocar: para saber
    -- cuántas de estas esperan a una persona y no a un PSP, `a_pagar_a_mano`.
    'en_cola', (
      select count(*) from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    ),
    'en_cola_importe', (
      select coalesce(jsonb_object_agg(t.currency, t.total), '{}'::jsonb)
        from (
          select p.currency::text as currency, sum(p.amount) as total
            from public.payouts p
           where p.status = 'scheduled'::public.payout_status
             and p.scheduled_for <= now()
           group by 1
        ) t
    ),

    -- 🟠 EL TRABAJO QUE NO LO HACE NINGÚN JOB. Órdenes vencidas cuyo destino
    -- rutea a 'manual' (hoy: Venezuela, `20260902150000`). No están rotas, no
    -- están bloqueadas y ninguna pasada de `/api/cron/payouts-process` las va a
    -- mover: esperan a que un admin abra `manual_destination(tutor_id)`, haga la
    -- transferencia y cierre la fila con `manage_payout(id,'mark_paid',…)`.
    --
    -- Existe porque sin ella ese trabajo era invisible: antes de hoy estas filas
    -- se contaban en `sin_ejecutor` (mezcladas con las impagables) o en
    -- `balance_ajeno` (declaradas imposibles), y en los dos casos el mensaje era
    -- «no se puede», cuando el mensaje correcto es «te toca a ti».
    --
    -- ⚠️ Puede solaparse con `bloqueos.sin_datos_de_cobro`: una orden manual cuyo
    -- tutor todavía no ha declarado a dónde cobrar sale en las dos, y así debe
    -- ser — es trabajo pendiente Y le falta un dato.
    'a_pagar_a_mano', (
      select count(*)
        from public.payouts p
        left join lateral (
          select rr.payout_providers
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
         and r.payout_providers && array['manual', 'banco-manual']::text[]
    ),

    -- Emitidas pero todavía no vencidas (retención de DP-02). No son un problema.
    'programadas_a_futuro', (
      select count(*) from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and (p.scheduled_for is null or p.scheduled_for > now())
    ),

    -- Rechazadas por el proveedor. Requieren `manage_payout(id,'retry')` o una
    -- decisión humana; no salen solas.
    'fallidas', (
      select count(*) from public.payouts p
       where p.status = 'failed'::public.payout_status
    ),

    -- ── POR QUÉ NO SALE LO QUE ESTÁ EN COLA ────────────────────────────────
    --
    -- Estos seis números explican una cola que no baja. Ninguno es un fallo del
    -- pago: son condiciones previas que el ejecutor comprueba ANTES de llamar a
    -- nadie, y que ninguna pasada del job va a resolver sola.
    --
    -- ⚠️ Se calculan aquí para poder mirarlos sin depender de que el workflow
    -- corra, PERO el que manda es el ejecutor: si algún día discrepan, gana el
    -- Route Handler, que es quien habla con el proveedor. Esta función explica;
    -- no decide.
    --
    -- ⚠️ Y desde C2m hay que leerlos sabiendo que `payout_provider` tiene TRES
    -- clases de valor, no dos: un PSP con adaptador ('stripe', 'dlocal'), el riel
    -- manual ('manual', que es una persona) y la ausencia de ejecutor ('simulated'
    -- o null). `rielDePayout()` en `src/lib/payments.ts` es la misma partición
    -- dicha en TypeScript, y si esa función y estos filtros discrepan, gana ella:
    -- es la que decide qué se le pinta al tutor y qué manda el job.
    'bloqueos', (
      select jsonb_build_object(

        -- Sin país de destino congelado no se puede pagar a ningún sitio.
        -- ⚠️ Hoy en dev son TODAS: el backfill de `20260901130000` copió
        -- `payments.payee_country`, que está a null en las 115 filas.
        'sin_pais',
          count(*) filter (where p.payee_country is null),

        -- A su destino no le corresponde ningún ejecutor: ni PSP ni persona. Se
        -- queda con `null` y con 'simulated', que es la ausencia de uno.
        -- ⚠️ VENEZUELA YA NO ESTÁ AQUÍ, y es correcto: desde `20260902150000` su
        -- fila dice 'manual', o sea que tiene riel — el de una persona. Lo único
        -- que debe quedar dentro es la fila del tutor que no ha declarado país.
        'sin_ejecutor',
          count(*) filter (where r.payout_providers is null
                              or r.payout_providers = array['simulated']),

        -- 🔴 EL DINERO ESTÁ EN OTRO BALANCE. Un payout se paga desde el balance
        -- del PSP que cobró ese dinero (`funding_provider`); si el que ejecuta es
        -- otro, la orden no es «difícil», es IMPAGABLE.
        -- ⚠️ C2r · ESTE COMENTARIO DESCRIBÍA EL MODELO SINGULAR y se ha
        -- reescrito con el de listas. Decía que toda orden de riel bancario
        -- entraba aquí porque las filas cobraban por Stripe y pagaban por
        -- dLocal; con `charge_providers` y `payout_providers` eso ya no se lee
        -- en una fila, se lee en dos listas. Lo que NO ha cambiado es el fondo:
        -- o se cobra por donde se paga, o se fondea el balance del que paga a
        -- propósito. Sigue siendo una decisión de tesorería, no de código, y es
        -- la decisión 1-bis de `docs/PAGOS-Y-PAYOUTS.md`.
        --
        -- ⚠️ C2m · Y POR ESO 'manual' QUEDA FUERA DEL FILTRO. Sin esa exclusión,
        -- toda orden venezolana entraba aquí —se fondea con Stripe y se «ejecuta»
        -- con 'manual', que nunca van a coincidir— y el termómetro declaraba
        -- imposible el mercado principal. 'manual' no tiene balance: el dinero
        -- sale de donde lo tengamos y lo mueve una persona. Cuando esa orden
        -- espera, no espera tesorería: espera a alguien. Eso es `a_pagar_a_mano`.
        'balance_ajeno',
          -- ⚠️ C2r · CON LISTAS DE CANDIDATOS ESTO YA NO ES UNA COMPARACIÓN, ES UN
        -- «NINGUNO». Una orden es impagable por balance solo si NINGÚN candidato
        -- puede pagarla: ni uno que esté fondeado aparte (wise, paypal, airtm,
        -- manual, banco-manual, que no dependen de quién cobró), ni uno atado a
        -- un balance que además CUADRE con `funding_provider`.
        -- No se comprueba si el candidato tiene adaptador: eso solo lo sabe el
        -- código, y duplicarlo aquí es cómo se desincronizan los dos.
        count(*) filter (where r.payout_providers is not null
                           and r.payout_providers <> array['simulated']
                           and not exists (
                                 select 1 from unnest(r.payout_providers) c
                                  where c not in ('dlocal', 'stripe')
                                     or c = p.funding_provider)),

        -- El saldo del tutor está en USD y el país cobra en su moneda. Quién
        -- asume el spread ya está decidido (2-sep: el tutor), así que esto ya no
        -- es tanto un bloqueo como un aviso de que esa orden pasa por conversión.
        -- Ecuador es el único de los ocho países que cobra en USD; Venezuela no
        -- entra porque `payout_country_rules` no tiene fila VE. Ver el techo
        -- `ponytail` de la cabecera de este bloque: el nombre de la clave se
        -- quedó viejo y se renombra cuando alguien toque la conversión de verdad.
        'cambio_sin_decidir',
          count(*) filter (where c.currency is not null
                             and c.currency <> p.currency),

        -- El tutor no ha registrado a dónde cobrar. Se arregla solo en cuanto lo
        -- guarde: la orden sigue en la cola, no en 'failed'.
        --
        -- ⚠️ C2m · CADA RIEL TIENE SU TABLA, Y HAY QUE MIRAR LA QUE TOCA. El riel
        -- bancario guarda en `tutor_payout_accounts` (B1, una fila por tutor); el
        -- manual guarda en `tutor_manual_payout_destinations` (`20260902110000`,
        -- VARIAS por tutor, una por canal). Mirar solo la primera contaba «sin
        -- datos» a todo tutor venezolano, incluidos los que habían registrado su
        -- Zelle correctamente — y ese contador es el que decide si alguien va a
        -- escribirle al tutor o no.
        --
        -- Sin riel resuelto (`null` / 'simulated') se mira la bancaria, que es lo
        -- mismo que se hacía antes: esa orden ya está contada en `sin_ejecutor` y
        -- el dato de cobro no es su problema principal.
        'sin_datos_de_cobro',
          count(*) filter (
            where case
                    -- ⚠️ C2r · QUÉ TABLA MIRAR DEPENDE DE QUÉ DATO LE PIDE EL RIEL AL TUTOR,
                    -- y con listas de candidatos un país puede tener de los dos:
                    --   coordenadas bancarias → dlocal, wise, stripe, banco-manual
                    --   un identificador      → manual, airtm, paypal
                    -- Manda la familia BANCARIA cuando el país tiene alguno de esos,
                    -- porque son los que de verdad van a pagar (y 'banco-manual' es el
                    -- que funciona hoy). Colombia es mixta y cae aquí; Venezuela no
                    -- tiene ninguno bancario y cae en la segunda rama.
                    when r.payout_providers && array['dlocal', 'wise', 'stripe', 'banco-manual']::text[]
                      then a.tutor_id is null
                    when r.payout_providers && array['manual', 'airtm', 'paypal']::text[]
                      then m.hay is not true
                    else a.tutor_id is null
                  end
          ),

        -- El importe agregado no cuadra con sus líneas. Es integridad nuestra, no
        -- del PSP, y el ejecutor se niega a mandarlo (regla de oro 2).
        'descuadradas',
          count(*) filter (where p.amount is distinct from coalesce(i.suma, 0))
      )
        from public.payouts p
        left join lateral (
          select rr.payout_providers
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
        left join public.payout_country_rules   c on c.country  = p.payee_country
        left join public.tutor_payout_accounts  a on a.tutor_id = p.tutor_id
        -- El destino manual se pregunta por EXISTENCIA y con `limit 1`, no con un
        -- `left join` a secas: la PK de esa tabla es `(tutor_id, channel)`, así
        -- que un tutor con Zinli y Zelle multiplicaría su fila de `payouts` por
        -- dos y TODOS los contadores de este bloque saldrían inflados.
        left join lateral (
          select true as hay
            from public.tutor_manual_payout_destinations d
           where d.tutor_id = p.tutor_id
           limit 1
        ) m on true
        left join lateral (
          select sum(pi.amount) as suma
            from public.payout_items pi
           where pi.payout_id = p.id
        ) i on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    )
  );
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- AUTOCOMPROBACIÓN — que las tres corran, que es justo lo que no hacían
-- ════════════════════════════════════════════════════════════════════════════
--
-- `create or replace` valida la SINTAXIS, no el cuerpo: el fallo de
-- `close_expired_sessions()` sobrevivió a una reescritura entera de la función
-- (regla de oro 11). Aquí se EJECUTAN.
do $$
declare
  v jsonb;
  n int;
begin
  -- 1) El termómetro corre y trae sus claves. Si alguna se perdió al traducir
  --    los contadores, el panel enseñaría un hueco sin decir nada.
  v := public.payouts_backlog();
  foreach n in array array[1] loop end loop;  -- no-op: mantiene `n` en uso
  if v is null then
    raise exception 'payouts_backlog() devolvió null';
  end if;
  if not (v ? 'a_pagar_a_mano' and v ? 'bloqueos' and v ? 'en_cola' and v ? 'por_estado') then
    raise exception 'payouts_backlog() perdió alguna clave de primer nivel: %', v;
  end if;
  if not (v -> 'bloqueos' ? 'balance_ajeno'
          and v -> 'bloqueos' ? 'sin_ejecutor'
          and v -> 'bloqueos' ? 'sin_datos_de_cobro') then
    raise exception 'payouts_backlog() perdió algún bloqueo: %', v -> 'bloqueos';
  end if;

  -- 2) Y que los contadores traducidos digan la verdad sobre lo que hay HOY en
  --    esta base. Venezuela está ruteada a {airtm,paypal,manual}: sus órdenes NO
  --    pueden contarse como impagables por balance —'manual' no tiene balance—,
  --    que es el fallo exacto que `20260902170000` arregló y que la traducción a
  --    listas podía reintroducir sin que nadie lo notara.
  select count(*) into n
    from public.payouts p
   where p.status = 'scheduled'::public.payout_status
     and p.payee_country = 'VE';
  if n > 0 and (v -> 'bloqueos' ->> 'balance_ajeno')::int > 0 then
    raise exception
      'hay % órdenes venezolanas en cola y balance_ajeno dice %: el riel manual se está contando como impagable',
      n, v -> 'bloqueos' ->> 'balance_ajeno';
  end if;

  raise notice 'payouts_backlog(): corre y conserva sus claves. balance_ajeno=%, a_pagar_a_mano=%',
    v -> 'bloqueos' ->> 'balance_ajeno', v ->> 'a_pagar_a_mano';
end $$;

-- ⚠️ `create_booking_line` y `confirm_simulated_payment` NO se ejercitan aquí, y
-- es a propósito: la primera INSERTA una reserva con sus sesiones y la segunda
-- mueve un pago. Una autocomprobación que escribe filas de verdad en la base de
-- cada ambiente es peor que no tenerla — deja basura en producción y falla el
-- día que los datos de prueba que da por hechos no estén.
-- Se ejercitan desde fuera, y así se hizo: ver el barrido de C2r.
--
-- Lo que sí se puede comprobar sin escribir nada es que no quede CÓDIGO —no un
-- comentario— leyendo las columnas eliminadas.
--
-- ⚠️ Y hay que distinguirlos, que es lo que aprendió esta comprobación a golpes:
-- su primera versión miraba `prosrc` en crudo y señaló DOS veces a funciones que
-- no estaban rotas, `payouts_backlog` y `build_payout_for_tutor`, porque
-- nombraban la columna vieja en un comentario. Un contador que grita por un
-- comentario obsoleto enseña a ignorarlo.
do $$
declare
  n int;
  quienes text;
begin
  with sin_comentarios as (
    select p.proname,
           (select string_agg(l, E'\n')
              from regexp_split_to_table(p.prosrc, E'\n') l
             where btrim(l) not like '--%') as codigo
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
  )
  select count(*), string_agg(proname, ', ')
    into n, quienes
    from sin_comentarios
   where codigo ~ '\ycharge_provider\y' or codigo ~ '\ypayout_provider\y';

  if n <> 0 then
    raise exception '% funciones siguen leyendo las columnas singulares en código: %', n, quienes;
  end if;

  raise notice 'ningún cuerpo de funcion en public lee ya charge_provider ni payout_provider.';
end $$;
