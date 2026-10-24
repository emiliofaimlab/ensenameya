-- ============================================================================
-- Enséñame Ya — bajas y reagendas de clases grupales (Fase C §10.2)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2:
--   · `cancel_booking`: RG-16 (de un ciclo empezado no hay baja) y RG-11 (si
--     el tutor reagendó, la baja es al 100 % aunque falten menos de 24 h).
--   · `proponer_reagenda`: rechaza las sesiones grupales con un mensaje que
--     dice por qué. Ya las rechazaba —`get_available_slots` no ofrece horas a
--     un producto grupal (`20261008160000`)— pero con «Ese horario ya no está
--     disponible», que es mentira.
--   · `reagendar_clase_grupal`: nueva. El tutor mueve una fecha para todos.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `cancel_booking` y `proponer_reagenda` REEMPLAZAN a sus versiones VIVAS
--   de dev, sacadas con `pg_get_functiondef` el 8-oct (últimas migraciones:
--   `20260912110000:3022` y `20260925120000:96`). Cambios marcados «G ·».
--   Firmas intactas. Academias (RA, `mandatory`) se añade sobre ESTAS.
-- · `responder_reagenda` NO se toca: solo responde propuestas, y una sesión
--   grupal ya no puede tener ninguna.
-- · Reagendar mueve la `group_class` y las sesiones de todos sus inscritos.
--   La ventana de la sala la recalcula `sessions_set_access_window`
--   (`20260820190000`); los recordatorios ya encolados se apartan igual que en
--   `responder_reagenda`. El correo NTF-54 llega con las plantillas de G4.
-- ============================================================================

-- ── 1 · cancel_booking ───────────────────────────────────────────────────────
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
  select id, student_id, tutor_id, status
    into v_bk
  from public.bookings
  where id = p_booking_id
    and (student_id = v_uid or tutor_id = v_uid)
    and status in ('pending_payment', 'pending_acceptance', 'confirmed');
  if v_bk.id is null then
    raise exception 'reserva no cancelable o inexistente' using errcode = 'check_violation';
  end if;

  v_is_tutor := (v_uid = v_bk.tutor_id);

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

-- ── 2 · proponer_reagenda ────────────────────────────────────────────────────
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
         se.group_class_id, b.product_id, b.status as booking_status
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

-- ── 3 · reagendar_clase_grupal (RG-11) ──────────────────────────────────────
create or replace function public.reagendar_clase_grupal(
  p_group_class  uuid,
  p_nuevo_inicio timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gc record;
begin
  select g.id, g.tutor_id, g.product_id, g.status, g.start_at, g.end_at into v_gc
    from public.group_classes g where g.id = p_group_class for update;

  if v_gc.id is null or v_gc.tutor_id is distinct from (select auth.uid()) then
    raise exception 'no puedes reagendar esta clase' using errcode = '42501';
  end if;
  if v_gc.status <> 'scheduled' then
    raise exception 'esa fecha ya no se puede reagendar' using errcode = 'check_violation';
  end if;
  -- La misma regla que la 1:1 (§14): 24 h respecto de la hora PROGRAMADA.
  if v_gc.start_at < now() + interval '24 hours' then
    raise exception 'Solo se puede reagendar con al menos 24 horas de anticipación.'
      using errcode = 'check_violation';
  end if;
  if p_nuevo_inicio <= now() then
    raise exception 'la hora nueva tiene que ser futura' using errcode = 'check_violation';
  end if;
  if p_nuevo_inicio = v_gc.start_at then
    raise exception 'Esa ya es la hora de la clase.' using errcode = 'check_violation';
  end if;

  -- Serializa contra inscripciones (create_booking_line bloquea lo mismo):
  -- quien esté pagando ve «las fechas cambiaron», no una hora vieja.
  perform 1 from public.products where id = v_gc.product_id for update;

  begin
    update public.group_classes
       set start_at = p_nuevo_inicio,
           end_at   = p_nuevo_inicio + (v_gc.end_at - v_gc.start_at),
           rescheduled_at = now()
     where id = v_gc.id;
  exception when exclusion_violation then
    raise exception 'esa hora choca con tu agenda' using errcode = 'exclusion_violation';
  end;

  -- Los recordatorios ya encolados para la hora vieja se apartan (misma
  -- maniobra que responder_reagenda): la clave queda libre para el barrido
  -- que los vuelva a encolar con la hora nueva.
  update public.notifications
     set idempotency_key = idempotency_key || ':movida:' || extract(epoch from now())::bigint,
         status = case when status = 'pending' then 'failed'::public.notification_status
                       else status end
   where idempotency_key in (
           select k
             from public.sessions s
            cross join lateral (values
              ('NTF-11:session:' || s.id || ':student'), ('NTF-11:session:' || s.id || ':tutor'),
              ('NTF-08:session:' || s.id || ':student'), ('NTF-08:session:' || s.id || ':tutor')
            ) as v(k)
            where s.group_class_id = v_gc.id
           union all
           select 'NTF-11:group_class:' || v_gc.id || ':tutor'
         );

  update public.sessions
     set start_at = p_nuevo_inicio,
         end_at   = p_nuevo_inicio + (v_gc.end_at - v_gc.start_at)
   where group_class_id = v_gc.id and status = 'scheduled';
end;
$$;

comment on function public.reagendar_clase_grupal(uuid, timestamptz) is
  'RG-11 · solo el tutor, con 24 h o más respecto de la hora programada, mueve una fecha grupal y las sesiones de todos sus inscritos. Marca rescheduled_at, que da a cada alumno la baja al 100 % (cancel_booking). El aviso NTF-54 llega en G4.';

revoke execute on function public.reagendar_clase_grupal(uuid, timestamptz) from public, anon;
grant  execute on function public.reagendar_clase_grupal(uuid, timestamptz) to authenticated;
