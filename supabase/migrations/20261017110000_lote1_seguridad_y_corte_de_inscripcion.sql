-- ============================================================================
-- Enséñame Ya — lote 1 del sondeo de grupales: seguridad y corte de inscripción
--
-- `docs/SONDEO-GRUPALES-LOTES.md`, lote 1. Cierra B2, B5, A7, M9, M11, M25 (la
-- columna), P32 y P33. B1 es Route Handler (`api/recordings/[sessionId]`).
--
-- ── Qué versión reemplaza cada función (regla del plan §2) ─────────────────
-- · create_booking_line ...... 20261009190000:47  (+ B2 corte y precio, + M11)
-- · comprar_regalo ........... 20261009190000:1439 (+ B2 precio del cupo)
-- · tutor_balance ............ 20261009190000:583 (+ P32)
-- · get_available_slots ...... 20261013190000 (EY-228) + bloques «G ·» de
--                              20261008160000:33: EY-228 copió la versión
--                              ANTERIOR a grupales y se comió RG-05 (B5).
-- · build_payout_for_tutor ... 20261009190000:381 (+ P32)
-- · run_payout_batch ......... 20261009190100:78  (+ P32)
-- · group_classes_public ..... 20261010090000     (+ 2 columnas al final)
-- Nuevas: cierre_de_inscripcion, precio_vigente_grupal, grupal_al_cambiar_fechas
-- y products_protege_cierre (triggers), regalos_de_grupales_cerradas (+ cron
-- `regalos-grupales-cerrados`).
--
-- ── B2 · una sola definición de «la inscripción cerró» ─────────────────────
-- La primera fecha NO cancelada, se haya dado o no. `create_booking_line`
-- miraba la primera `scheduled`: en cuanto el cron cerraba la fecha 1 de un
-- ciclo, la clase volvía al catálogo y cobraba el ciclo entero por menos
-- fechas. `cierre_de_inscripcion()` es la regla; `products.inscripcion_cierra_at`
-- la guarda para que el catálogo filtre EN LA CONSULTA (M9: el contador decía
-- «3 mentorías» y pintaba 2, porque `conGrupales` filtraba después de paginar)
-- y la mantiene un trigger en `group_classes`, así cubre publicar, reagendar y
-- cancelar sin tocar esas tres RPC.
-- ⚠️ La columna es para PINTAR. `create_booking_line` y el cron de regalos no
-- se fían de ella y recalculan con la función. Además, como el tutor tiene grant
-- de escritura sobre su fila de `products`, `products_protege_cierre` descarta
-- cualquier escritura directa: solo la cambia el trigger de `group_classes`.
--
-- ── B2 · el precio del cupo, en un solo sitio ──────────────────────────────
-- Un ciclo al que el tutor le canceló fechas antes de empezar cobra solo las
-- que quedan: round(precio · vivas / N), el mismo tramo que `cancelar_fecha_grupal`
-- devuelve a los inscritos. `precio_vigente_grupal()` lo calcula para
-- `create_booking_line` Y para `comprar_regalo` (un regalo más caro que el cupo
-- se consumía entero al canjearlo). Un regalo comprado ANTES de que cancelaran
-- una fecha pasa a saldo en ese momento (causa `fecha_cancelada`).
--
-- ── M9 · una grupal sin fechas pendientes se archiva ───────────────────────
-- El mismo trigger la pasa a `archived` cuando su última fecha deja de estar
-- `scheduled` (se dio o se canceló). Los inscritos la siguen viendo por
-- `products_select_booked`. Archivar dispara `products_regalos_clase_cancelada`
-- («la clase se canceló»); para que eso solo llegue cuando de verdad se canceló
-- todo, el trigger convierte antes los regalos de una clase que sí se dio con la
-- causa `inscripcion_cerrada`.
--
-- ── A7 · el regalo de un cupo vuelve como saldo al cerrarse la inscripción ─
-- Antes solo pasaba si la clase se llenaba o se cancelaba: si empezaba sin
-- llenarse, el regalo quedaba atado a una clase que ya no se podía reservar y
-- caducaba. Un cron de 15 min (regla 11: un `begin … exception` por producto).
-- ============================================================================


-- ── 0 · la columna ─────────────────────────────────────────────────────────
alter table public.products
  add column if not exists inscripcion_cierra_at timestamptz;

comment on column public.products.inscripcion_cierra_at is
  'B2/M9 · solo grupales: primera fecha no cancelada (cierre_de_inscripcion). La mantiene el trigger grupal_al_cambiar_fechas. Es para pintar y filtrar el catálogo; create_booking_line recalcula.';


-- ── 1 · la regla ───────────────────────────────────────────────────────────
create or replace function public.cierre_de_inscripcion(p_product uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(g.start_at)
    from public.group_classes g
   where g.product_id = p_product
     and g.status <> 'cancelled'
$$;

comment on function public.cierre_de_inscripcion(uuid) is
  'B2 · cuándo cierra la inscripción de una grupal: al empezar su primera fecha no cancelada, dada o no. Null si no le queda ninguna.';

revoke execute on function public.cierre_de_inscripcion(uuid) from public, anon, authenticated;

create or replace function public.precio_vigente_grupal(p_product uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(p.package_num_sessions, 0) > v.vivas and v.vivas > 0
             then round(p.price_amount * v.vivas::numeric / p.package_num_sessions)::bigint
           else p.price_amount
         end
    from public.products p
    cross join lateral (
      select count(*)::int as vivas
        from public.group_classes g
       where g.product_id = p.id and g.status = 'scheduled'
    ) v
   where p.id = p_product
$$;

comment on function public.precio_vigente_grupal(uuid) is
  'B2 · lo que cuesta hoy un cupo de una grupal: el precio, o la parte de las fechas que quedan si el tutor canceló alguna (round(precio · vivas / N)). Lo usan create_booking_line y comprar_regalo.';

revoke execute on function public.precio_vigente_grupal(uuid) from public, anon, authenticated;


-- ── 2 · el trigger que la mantiene (y archiva la grupal terminada) ─────────
create or replace function public.grupal_al_cambiar_fechas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod  uuid := coalesce(new.product_id, old.product_id);
  v_vivas int;
begin
  -- ⚠️ Todo en su propio bloque: el UPDATE pasa por `products_publish_guard`,
  -- que aborta en un producto `active` de un tutor no aprobado (suspendido). Sin
  -- esto, cerrar la fecha de ese tutor tumbaría `close_expired_sessions` entero.
  begin
    select count(*) into v_vivas
      from public.group_classes g
     where g.product_id = v_prod and g.status = 'scheduled';

    -- Los regalos vivos de la clase pasan a saldo con la causa que toca, ANTES
    -- de archivar (el trigger de archivo los avisaría como «se canceló»):
    if tg_op = 'UPDATE' and new.status = 'cancelled'
       and old.status is distinct from 'cancelled' and v_vivas > 0 then
      -- una fecha cancelada abarata el cupo: el regalo ya no cabe entero en él.
      perform public.regalos_de_clase_a_saldo(v_prod, 'fecha_cancelada');
    elsif v_vivas = 0 and exists (select 1 from public.group_classes g
                                   where g.product_id = v_prod and g.status <> 'cancelled') then
      -- la clase se dio (al menos una fecha): su inscripción cerró.
      perform public.regalos_de_clase_a_saldo(v_prod, 'inscripcion_cerrada');
    end if;

    update public.products p
       set inscripcion_cierra_at = public.cierre_de_inscripcion(v_prod),
           status = case
                      when p.status = 'active' and v_vivas = 0
                      then 'archived'::public.product_status
                      else p.status
                    end
     where p.id = v_prod
       and p.pricing_model = 'group';
  exception when others then
    raise warning 'grupal_al_cambiar_fechas(%): %', v_prod, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.grupal_al_cambiar_fechas() is
  'B2/M9/A7 · tras cada cambio de fechas de una grupal: convierte sus regalos vivos en saldo si se canceló una fecha o la clase terminó, recalcula products.inscripcion_cierra_at y archiva el producto activo que se quedó sin fechas scheduled.';

revoke execute on function public.grupal_al_cambiar_fechas() from public, anon, authenticated;

drop trigger if exists group_classes_actualiza_producto on public.group_classes;
create trigger group_classes_actualiza_producto
  after insert or delete or update of status, start_at on public.group_classes
  for each row execute function public.grupal_al_cambiar_fechas();


-- ── 3 · relleno de lo que ya existe ────────────────────────────────────────
-- Mismo patrón que `20261002120000` (slug): sin `products_publish_guard`, que
-- abortaría en una grupal activa de un tutor ya no aprobado, ni `updated_at`.
alter table public.products disable trigger products_publish_guard;
alter table public.products disable trigger products_set_updated_at;
update public.products p
   set inscripcion_cierra_at = public.cierre_de_inscripcion(p.id)
 where p.pricing_model = 'group';
alter table public.products enable trigger products_publish_guard;
alter table public.products enable trigger products_set_updated_at;

-- La columna solo la escribe el trigger de `group_classes` (anidado: profundidad
-- 2). Una escritura directa —el tutor tiene grant de UPDATE de tabla sobre su
-- fila— se descarta. ⚠️ Un relleno futuro tiene que desactivar este trigger.
create or replace function public.products_protege_cierre()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 then
    new.inscripcion_cierra_at := old.inscripcion_cierra_at;
  end if;
  return new;
end;
$$;

comment on function public.products_protege_cierre() is
  'B2 · products.inscripcion_cierra_at solo la escribe grupal_al_cambiar_fechas; una escritura directa conserva el valor anterior.';

revoke execute on function public.products_protege_cierre() from public, anon, authenticated;

drop trigger if exists products_protege_cierre on public.products;
create trigger products_protege_cierre
  before update of inscripcion_cierra_at on public.products
  for each row execute function public.products_protege_cierre();

-- Las que ya terminaron, archivadas (con los triggers en marcha: los regalos
-- vivos de esas clases pasan a saldo).
update public.products p
   set status = 'archived'
 where p.pricing_model = 'group'
   and p.status = 'active'
   and exists (select 1 from public.group_classes g where g.product_id = p.id)
   and not exists (select 1 from public.group_classes g
                    where g.product_id = p.id and g.status = 'scheduled');


-- ── 4 · la vista pública gana el corte y el mínimo (al final) ──────────────
-- `min_seats` lo usa el lote 7 (A12: decirlo antes de pagar). Las dos son
-- columnas de `products`, ya legibles para anon.
create or replace view public.group_classes_public
with (security_invoker = true) as
  select g.id,
         g.product_id,
         g.sequence_no,
         g.start_at,
         g.end_at,
         p.capacity,
         public.cupos_libres(g.product_id) as cupos_libres,
         g.tutor_id,
         p.title,
         p.inscripcion_cierra_at,
         p.min_seats
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.status = 'scheduled';


-- ── 5 · create_booking_line ────────────────────────────────────────────────
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

  -- M11 · el tutor no se inscribe en su propia clase grupal: ocupaba un cupo y
  -- se pagaba a sí mismo con la comisión de por medio (`comprar_regalo` ya lo
  -- frenaba). Solo grupal: en 1:1 la ficha no tiene aún su aviso de «es tuya».
  if v_prod.pricing_model = 'group' and v_prod.tutor_id = p_student then
    raise exception 'no puedes inscribirte en tu propia clase' using errcode = 'check_violation';
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

    -- B2 · el corte es la primera fecha NO CANCELADA, se haya dado o no. Con
    -- `status = 'scheduled'` un ciclo volvía a abrirse en cuanto el cron cerraba
    -- su fecha 1, y cobraba entero por las que quedaban. Es la misma regla que
    -- `comprar_regalo` y que `products.inscripcion_cierra_at` (el catálogo).
    select count(*) into v_required
      from public.group_classes g
     where g.product_id = v_prod.id and g.status = 'scheduled';
    v_inicio := public.cierre_de_inscripcion(v_prod.id);
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
    -- B2 · un ciclo al que el tutor le canceló fechas ANTES de que llegara este
    -- alumno cobra solo las que quedan (`precio_vigente_grupal`: el mismo tramo
    -- que `cancelar_fecha_grupal` devuelve a los ya inscritos, que divide por
    -- `bookings.num_sessions`, o sea por `v_required`).
    when v_prod.pricing_model = 'group'
      then public.precio_vigente_grupal(v_prod.id)
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


-- ── 6 · get_available_slots (B5) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_slots(p_product_id uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT (CURRENT_DATE + 21))
 RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tutor_id   uuid;
  v_tz         text;
  v_duration   int;
  -- Cambio A · cada cuánto EMPIEZA un hueco. `null` en la mentoría = la
  -- duración, que es el comportamiento de siempre.
  v_step       int;
  -- Cambio B · el suelo de la ventana, ya resuelto en el calendario correcto.
  v_desde      date;
  -- N-04 · ¿esta mentoría declaró bloques? Se resuelve UNA vez y fuera de la
  -- consulta grande: es la diferencia entre «filtra por mis bloques» y «no
  -- filtres», no un dato que cambie de fila a fila.
  v_has_blocks boolean;
begin
  -- Solo producto 'active' de tutor 'approved' es reservable (RN-24).
  select p.tutor_id, p.session_duration_min, pr.timezone, p.start_time_increment_min
    into v_tutor_id, v_duration, v_tz, v_step
  from public.products p
  join public.tutor_profiles tp
    on tp.profile_id = p.tutor_id and tp.approval_status = 'approved'
  join public.profiles pr on pr.id = p.tutor_id
  where p.id = p_product_id and p.status = 'active'
    -- G · una clase grupal no tiene horarios que elegir: sus fechas son las
    -- de `group_classes`. Sin esto, la agenda 1:1 del tutor se ofrecería como
    -- si fuera de la clase.
    and p.pricing_model <> 'group';

  if v_tutor_id is null or v_duration is null or v_tz is null then
    return; -- sin producto reservable → sin slots
  end if;

  -- Sin paso declarado, el paso es la duración: exactamente la rejilla anterior
  -- a esta migración. El `greatest(…, 1)` es una red por si algún día el `check`
  -- de la columna se relaja: un paso de 0 haría que `generate_series` intentara
  -- devolver infinitas filas.
  v_step := greatest(coalesce(v_step, v_duration), 1);

  -- Cambio B. Ver la nota larga de la cabecera.
  v_desde := case
               when p_from <= current_date then (now() at time zone v_tz)::date
               else p_from
             end;

  select exists (
    select 1 from public.product_availability_rules par
    where par.product_id = p_product_id
  ) into v_has_blocks;

  return query
  with days as (
    select gd::date as day, extract(dow from gd::date)::int as weekday
    from generate_series(v_desde::timestamp, p_to::timestamp, interval '1 day') gd
  ),
  -- Slots base desde las reglas recurrentes.
  --
  -- ⚠️ EL TOPE DEL `generate_series` ES LA REGLA DE CALENDLY, y es donde el paso
  -- y la duración dejan de ser lo mismo. Se quieren todos los `n` tales que
  --
  --     start + step·n + duración  ≤  end        (el hueco cabe ENTERO)
  --   ⇔ n ≤ ((end − start) − duración) / step
  --
  -- así que el tope es `floor(((end−start) − dur) / step)`. Con una franja
  -- 9:00–12:00, duración 60 y paso 30 sale `floor((180−60)/30) = 4` → n = 0..4 →
  -- 9:00, 9:30, 10:00, 10:30 y 11:00. El 11:30 no aparece porque acabaría a las
  -- 12:30, fuera de la franja.
  --
  -- ⚠️ Y CON PASO = DURACIÓN ESTO ES EL TOPE VIEJO, no «parecido»: sustituyendo
  -- step por dur queda `floor((L−dur)/dur) = floor(L/dur − 1) = floor(L/dur) − 1`
  -- —restar un entero conmuta con `floor`— que es literalmente la expresión de
  -- `20260817200000:280`. Ahí es donde se apoya el «la columna nace nula y no
  -- cambia nada» de la cabecera.
  --
  -- Franja más corta que la clase → el numerador es negativo → el tope es < 0 →
  -- `generate_series(0, negativo)` no devuelve filas. Que es lo correcto.
  rule_slots as (
    select d.day, (r.start_time + make_interval(mins => v_step * i.n)) as wall_start
    from days d
    join public.availability_rules r
      on r.tutor_id = v_tutor_id and r.is_active and r.weekday = d.weekday
      -- N-04 · con bloques declarados, solo cuentan los suyos. Sin bloques,
      -- `not v_has_blocks` es cierto para TODAS las filas y el `or` deja pasar
      -- la regla entera: el comportamiento anterior a N-04, que es lo que
      -- sostiene el catálogo público y `create_booking`.
      and (
        not v_has_blocks
        or exists (
          select 1 from public.product_availability_rules par
          where par.product_id = p_product_id
            and par.rule_id = r.id
        )
      )
    cross join lateral generate_series(
      0,
      floor(
        (extract(epoch from (r.end_time - r.start_time)) - (v_duration * 60))
        / (v_step * 60)
      )::int
    ) as i(n)
  ),
  -- Slots extra desde excepciones 'open' con rango horario (siguen siendo del
  -- tutor, no del bloque — ver la nota de 20260817200000 §4). Mismo paso y mismo
  -- tope que arriba: una excepción es una franja como cualquier otra.
  open_slots as (
    select x.date as day, (x.start_time + make_interval(mins => v_step * i.n)) as wall_start
    from public.availability_exceptions x
    cross join lateral generate_series(
      0,
      floor(
        (extract(epoch from (x.end_time - x.start_time)) - (v_duration * 60))
        / (v_step * 60)
      )::int
    ) as i(n)
    where x.tutor_id = v_tutor_id
      and x.type = 'open'
      and x.start_time is not null and x.end_time is not null
      and x.date between v_desde and p_to
  ),
  resolved as (
    select
      s.day,
      s.wall_start,
      -- RN-01/RN-02: hora de pared del TUTOR → instante UTC, con DST correcto.
      -- La zona sigue siendo la suya, nunca la del visitante.
      (s.day + s.wall_start) at time zone v_tz as s_start,
      (s.day + s.wall_start + make_interval(mins => v_duration)) at time zone v_tz as s_end
    from (select day, wall_start from rule_slots
          union
          select day, wall_start from open_slots) s
  )
  select r.s_start, r.s_end
  from resolved r
  where r.s_start > now()  -- solo futuro
    -- excepción 'block' ese día: día completo (sin horas) o rango que solapa.
    and not exists (
      select 1 from public.availability_exceptions b
      where b.tutor_id = v_tutor_id and b.type = 'block' and b.date = r.day
        and (
          b.start_time is null
          or (r.wall_start < b.end_time
              and (r.wall_start + make_interval(mins => v_duration)) > b.start_time)
        )
    )
    -- S-41: no solapa una sesión ya agendada del tutor. OJO, esto es de TUTOR y
    -- no de bloque, y así se queda: el tutor es una persona y no puede dar dos
    -- clases a la vez aunque sean de mentorías distintas.
    --
    -- ⚠️ Desde `20260831180000` esto ya NO es la única defensa: la constraint de
    -- exclusión `sessions_sin_solape_por_tutor` lo comprueba en el INSERT. Aquí
    -- se queda porque su trabajo es otro — no ofrecer un hueco que va a fallar—,
    -- y porque con paso fino los huecos ofrecidos se pisan entre sí y hay que
    -- descontar la clase entera, no solo su inicio.
    and not exists (
      select 1 from public.sessions se
      -- EY-228 · …ni una que el tutor esté TOMANDO como alumno: es la misma
      -- persona y tampoco puede dar clase mientras recibe otra.
      -- ponytail: solo oculta el hueco; la constraint de exclusión sigue siendo
      -- por tutor_id, así que una carrera exacta (reservar a la vez como alumno
      -- y como tutor) podría colarse. Si pasa, un trigger en `sessions`.
      where (se.tutor_id = v_tutor_id or se.student_id = v_tutor_id)
        and se.status not in ('cancelled', 'no_show')
        and tstzrange(se.start_at, se.end_at) && tstzrange(r.s_start, r.s_end)
    )
    -- G · RG-05: una fecha grupal publicada quita la hora aunque no tenga un
    -- solo inscrito (sin inscritos no hay `sessions` que la tapen arriba). La
    -- defensa de verdad es `candado_agenda_entre_tablas()`; esto es no ofrecer
    -- lo que va a fallar.
    and not exists (
      select 1 from public.group_classes g
      where g.tutor_id = v_tutor_id
        and g.status = 'scheduled'
        and tstzrange(g.start_at, g.end_at) && tstzrange(r.s_start, r.s_end)
    )
  order by r.s_start;
end;
$function$;


-- ── 7 · A7: los regalos de una clase cuya inscripción ya cerró ─────────────
create or replace function public.regalos_de_grupales_cerradas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod    uuid;
  v_n       int := 0;
  v_fallos  int := 0;
  v_detalle text := '';
begin
  for v_prod in
    select distinct c.product_id
      from public.credits c
      join public.products p on p.id = c.product_id
     where c.source  = 'gift'
       and c.kind    = 'mentoria'
       and c.status  = 'active'
       and c.amount  > c.consumed_amount
       and p.pricing_model = 'group'
       -- la función y no la columna: la columna es para pintar
       and public.cierre_de_inscripcion(p.id) <= now()
  loop
    begin
      v_n := v_n + public.regalos_de_clase_a_saldo(v_prod, 'inscripcion_cerrada');
    exception when others then
      v_fallos  := v_fallos + 1;
      v_detalle := v_detalle || v_prod || ': ' || sqlerrm || '; ';
    end;
  end loop;
  -- Regla 11: un fallo tiene que verse en `cron.job_run_details`, no solo en el
  -- log. Se aborta la pasada entera A PROPÓSITO (también lo que sí se convirtió,
  -- que se repite en la siguiente): un job que sale 'succeeded' con productos
  -- fallando es justo el fallo mudo que la regla prohíbe.
  if v_fallos > 0 then
    raise exception 'regalos_de_grupales_cerradas: % producto(s) fallaron: %', v_fallos, v_detalle;
  end if;
  return v_n;
end;
$$;

comment on function public.regalos_de_grupales_cerradas() is
  'A7 · RG-17: el regalo de un cupo de una grupal cuya inscripción ya cerró pasa a saldo (NTF-38, causa inscripcion_cerrada). Lo corre el cron regalos-grupales-cerrados; si un producto falla, la pasada entera sale failed (regla 11).';

revoke execute on function public.regalos_de_grupales_cerradas() from public, anon, authenticated;

select cron.unschedule('regalos-grupales-cerrados')
 where exists (select 1 from cron.job where jobname = 'regalos-grupales-cerrados');
select cron.schedule(
  'regalos-grupales-cerrados',
  '*/15 * * * *',
  $cron$ select public.regalos_de_grupales_cerradas() $cron$
);


-- ── 8 · P32: una clase gratis no genera payout de 0 ────────────────────────
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
      and p.gross_amount > 0     -- P32 · una clase gratis no genera un payout de 0 (como RA-08)
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
     and p.gross_amount > 0                        -- P32 · como RA-08
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
     and p.gross_amount > 0                        -- RA-08
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
            and p.gross_amount > 0      -- P32 · como build_payout_for_tutor
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
            and p.gross_amount > 0      -- P32 · como build_payout_for_tutor
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


-- ── 8b · comprar_regalo: el cupo vale lo que cobra create_booking_line (B2) ─
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
    -- B2 · el cupo de una grupal vale lo mismo que cobra `create_booking_line`:
    -- si el tutor canceló fechas, solo las que quedan.
    when v_prod.pricing_model = 'group'
      then public.precio_vigente_grupal(v_prod.id)
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


-- ── 9 · P33: el motivo con que se canceló una fecha no es público ──────────
-- Ninguna pantalla lo lee (`group_classes_public` no lo trae), pero con
-- la clave anon se podía pedir `/rest/v1/group_classes?select=cancel_reason`.
-- Tampoco a `authenticated`: cualquier cuenta lo pedía por REST. Ninguna pantalla
-- lo lee de aquí (el admin lee `bookings.cancel_reason`).
revoke select (cancelled_at, cancel_reason) on public.group_classes from anon, authenticated;
