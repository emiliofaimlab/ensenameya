-- ============================================================================
-- Enséñame Ya — lote 2 del sondeo de grupales: bajas, reembolsos, mínimo y
-- edición de la clase publicada
--
-- `docs/SONDEO-GRUPALES-LOTES.md`, lote 2. Cierra la parte de BD de A8, B6,
-- B7, M1, M15 y M26 (A10, P9 y P10 son de pantalla). Reglas confirmadas por
-- Emilio el 16-oct (ver la tabla de decisiones del documento).
--
-- ── Qué versión reemplaza cada función (regla del plan §2) ─────────────────
-- · cancel_booking ............ 20261009190000:988 (reescrita sobre politica_de_baja)
-- · reagendar_clase_grupal .... 20261009150000:402 (+ M15)
-- · cancelar_grupales_sin_minimo 20261008220000:29 (+ B7)
-- · publicar_clase_grupal ..... 20261008160000     (+ B7)
-- · products_guarda_grupal .... 20261009190000:328 (+ B6) y su trigger
--                               (20261009190000:1619, ahora con más columnas)
-- · enforce_product_publish_guard 20260709120000:21 (RN-23 solo al publicar)
-- Nueva: politica_de_baja (RPC para authenticated).
--
-- ── M26 · una sola regla de «¿me puedo dar de baja y cuánto recupero?» ──────
-- La pantalla de baja calculaba su propia estimación (total × %) y el detalle
-- enseñaba el botón aunque `cancel_booking` fuera a rechazar la baja (RG-16).
-- `politica_de_baja(p_booking)` es ahora LA regla: la llama `cancel_booking`
-- para decidir, y las pantallas para enseñar lo mismo antes de pulsar.
--
-- ── A8 · el porcentaje se aplica a lo que aún no se ha devuelto ────────────
-- Antes: round(gross · %) con `greatest` contra lo ya devuelto. Con una fecha
-- del ciclo ya reembolsada, una baja al 50 % devolvía menos de lo justo (el 50 %
-- del total, no de lo que quedaba). Ahora: ya_devuelto + round((gross −
-- ya_devuelto) · %). Sin reembolso previo da exactamente lo mismo que antes.
--
-- ── M1 · sacar a un alumno a mitad de un ciclo (Emilio: las fechas que faltan)
-- Si quien cancela es el tutor (o el admin, que llega por
-- `admin_sacar_de_clase_grupal` con su identidad) y el ciclo ya empezó, se
-- devuelve el tramo de las fechas que faltan —round(gross · k / N), el mismo
-- de `cancelar_fecha_grupal`—, caen solo las sesiones futuras y la reserva NO
-- se cancela: se completa en cuanto no le queda nada por delante, para que el
-- tutor cobre lo que sí dio (`parte_del_tutor` ya prorratea). Por eso el tutor
-- puede actuar también sobre una reserva `in_progress`.
--
-- ── M15 · reagendar ────────────────────────────────────────────────────────
-- La hora nueva también con 24 h o más, el ciclo se renumera por fecha, y el
-- 100 % por reagenda (RG-11) solo vale para quien se inscribió ANTES del cambio.
--
-- ── B7 · el cupo mínimo se revisa UNA vez ──────────────────────────────────
-- El cron miraba la clase durante todo el último día: una baja a 3 h tumbaba la
-- clase para los demás con un correo que decía «faltando 24 horas». Ahora, al
-- cruzar las 24 h, o se cancela o se marca `products.minimo_evaluado_at` y no se
-- vuelve a mirar. Y no se publica con mínimo si la primera fecha está a menos
-- de 48 h. El texto de NTF-53 no cambia: con una sola revisión ya es cierto.
--
-- ── B6 · la clase publicada no cambia por debajo ───────────────────────────
-- Ver el comentario dentro de `products_guarda_grupal`.
-- ============================================================================


-- ── 0 · la marca del mínimo ────────────────────────────────────────────────
alter table public.products
  add column if not exists minimo_evaluado_at timestamptz;

comment on column public.products.minimo_evaluado_at is
  'B7 · cuándo cancelar_grupales_sin_minimo comprobó que la grupal llegaba a su cupo mínimo, 24 h antes de la primera fecha. Con valor, el mínimo ya no se vuelve a mirar (RG-04: una baja posterior no cancela la clase).';


-- ── 1 · M26: la regla de la baja ───────────────────────────────────────────
create or replace function public.politica_de_baja(p_booking uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_bk         record;
  v_is_tutor   boolean;
  v_empezada   boolean;
  v_earliest   timestamptz;
  v_pct        int;
  v_reagendada boolean := false;
  v_pay        record;
  v_prev       bigint := 0;
  v_total      bigint := 0;
  v_tramos     boolean := false;
  v_k          int;
begin
  select b.id, b.student_id, b.tutor_id, b.status, b.mandatory, b.academy_id,
         b.pricing_model, b.num_sessions, b.created_at, b.currency
    into v_bk
    from public.bookings b
   where b.id = p_booking
     and (b.student_id = v_uid or b.tutor_id = v_uid);
  if v_bk.id is null then
    return jsonb_build_object('permitida', false, 'motivo', 'reserva no cancelable o inexistente');
  end if;

  v_is_tutor := (v_uid = v_bk.tutor_id);
  -- Alguna fecha grupal no cancelada ya empezó (las que canceló el tutor no cuentan).
  v_empezada := exists (
    select 1 from public.sessions s
     where s.booking_id = p_booking and s.group_class_id is not null
       and s.status <> 'cancelled' and s.start_at <= now());

  -- M1 · el tutor puede sacar a alguien de un ciclo ya empezado (`in_progress`).
  if not (v_bk.status in ('pending_payment', 'pending_acceptance', 'confirmed')
          or (v_is_tutor and v_bk.pricing_model = 'group' and v_bk.status = 'in_progress')) then
    return jsonb_build_object('permitida', false, 'motivo', 'reserva no cancelable o inexistente');
  end if;

  -- A · RA-24: una clase asignada por la academia no la cancela el alumno.
  if not v_is_tutor and v_bk.mandatory then
    return jsonb_build_object('permitida', false, 'motivo',
      'Esta clase es obligatoria; habla con ' ||
      coalesce((select a.name from public.academies a where a.id = v_bk.academy_id), 'tu academia'));
  end if;

  -- G · RG-16: de un ciclo grupal el alumno solo se da de baja antes de la
  -- primera fecha (quien faltó a la primera sigue 'confirmed', no 'in_progress').
  if not v_is_tutor and v_empezada then
    return jsonb_build_object('permitida', false, 'motivo',
      'la clase ya empezó: ya no puedes darte de baja');
  end if;

  -- M1 · con el ciclo empezado y sin ninguna fecha suya por delante, sacarlo
  -- no devuelve ni cambia nada (dejaba el pago en «reembolso parcial» de 0).
  if v_is_tutor and v_bk.pricing_model = 'group' and v_empezada and not exists (
    select 1 from public.sessions s
     where s.booking_id = p_booking and s.status = 'scheduled' and s.start_at > now()
  ) then
    return jsonb_build_object('permitida', false, 'motivo',
      'A este alumno ya no le quedan fechas por delante.');
  end if;

  -- RN-37 sobre la sesión más próxima aún agendada.
  select min(s.start_at) into v_earliest
    from public.sessions s
   where s.booking_id = p_booking and s.status = 'scheduled';

  if v_is_tutor then
    v_pct := 100;
  elsif v_earliest is null or v_earliest - now() >= interval '24 hours' then
    v_pct := 100;
  else
    v_pct := 50;
  end if;

  -- G · RG-11: si el tutor movió una fecha DESPUÉS de que este alumno se
  -- inscribiera (M15), y la hora nueva no le sirve, se va con el 100 %.
  if not v_is_tutor and v_pct < 100 and exists (
    select 1 from public.sessions s
      join public.group_classes g on g.id = s.group_class_id
     where s.booking_id = p_booking and s.status = 'scheduled'
       and g.rescheduled_at is not null
       and g.rescheduled_at > v_bk.created_at
  ) then
    v_pct := 100;
    v_reagendada := true;
  end if;

  select p.status, p.gross_amount, coalesce(p.refunded_amount, 0) as refunded_amount
    into v_pay
    from public.payments p where p.booking_id = p_booking;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev := v_pay.refunded_amount;
    if v_is_tutor and v_bk.pricing_model = 'group' and v_empezada then
      -- M1 · tramo de las fechas que faltan: las ya canceladas más las futuras.
      v_tramos := true;
      select count(*) filter (where s.status = 'cancelled'
                                 or (s.status = 'scheduled' and s.start_at > now()))
        into v_k
        from public.sessions s
       where s.booking_id = p_booking and s.group_class_id is not null;
      v_total := greatest(round(v_pay.gross_amount * v_k::numeric / greatest(v_bk.num_sessions, 1)),
                          v_prev);
      v_pct := round(100.0 * v_k / greatest(v_bk.num_sessions, 1));
    else
      -- A8 · el porcentaje sobre lo que aún no se ha devuelto.
      v_total := v_prev + round((v_pay.gross_amount - v_prev) * v_pct / 100.0);
    end if;
  elsif v_pay.status is not null and v_pay.status <> 'pending' then
    v_prev  := v_pay.refunded_amount;
    v_total := v_prev;
  end if;

  return jsonb_build_object(
    'permitida',       true,
    'motivo',          null,
    'es_tutor',        v_is_tutor,
    'pct',             v_pct,
    'reembolso_total', v_total,           -- acumulado EN PRECIO tras la baja
    'ya_devuelto',     v_prev,
    'a_devolver',      v_total - v_prev,  -- lo que se mueve ahora
    'tramos',          v_tramos,          -- M1: solo caen las fechas que faltan
    'reagendada',      v_reagendada,      -- RG-11 aplicó el 100 %
    'proxima',         v_earliest,
    'moneda',          v_bk.currency
  );
end;
$$;

comment on function public.politica_de_baja(uuid) is
  'M26 · la regla única de la baja de una reserva para quien la mira (alumno o tutor): si se permite, el porcentaje y cuánto se devuelve (A8: sobre lo que aún no se devolvió; M1: tramo de las fechas que faltan si el tutor saca a alguien de un ciclo empezado). La usan cancel_booking y las pantallas de baja.';

revoke execute on function public.politica_de_baja(uuid) from public, anon;
grant  execute on function public.politica_de_baja(uuid) to authenticated;


-- ── 2 · cancel_booking, sobre la regla ─────────────────────────────────────
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pol      jsonb;
  v_is_tutor boolean;
  v_tramos   boolean;
  v_pay      record;
  v_refund   bigint := 0;   -- acumulado tras esta cancelación
  v_prev     bigint := 0;   -- lo que ya se había devuelto antes
  v_delta    bigint := 0;   -- lo que hay que mover DE VERDAD ahora
  v_reparto  jsonb  := jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
  v_motivo   text   := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  -- M26 · quién puede, cuándo y cuánto lo decide `politica_de_baja`: la misma
  -- respuesta que enseñan las pantallas antes de pulsar. Sus motivos son los
  -- textos de siempre («reserva no cancelable o inexistente», RA-24, RG-16).
  -- El pago se bloquea ANTES de preguntar: si no, una fecha cancelada a la vez
  -- cambia `ya_devuelto` entre la política y el movimiento, y A8 se calcula
  -- sobre una base vieja.
  perform 1 from public.payments where booking_id = p_booking_id for update;
  v_pol := public.politica_de_baja(p_booking_id);
  if not coalesce((v_pol ->> 'permitida')::boolean, false) then
    raise exception '%', v_pol ->> 'motivo' using errcode = 'check_violation';
  end if;
  v_is_tutor := (v_pol ->> 'es_tutor')::boolean;
  v_tramos   := (v_pol ->> 'tramos')::boolean;

  -- Reembolso solo si el pago fue capturado.
  select id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where booking_id = p_booking_id
  for update;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev   := coalesce(v_pay.refunded_amount, 0);
    -- El acumulado no retrocede jamás.
    v_refund := greatest((v_pol ->> 'reembolso_total')::bigint, v_prev);
    v_delta  := v_refund - v_prev;
  end if;

  if v_pay.status in ('paid', 'partially_refunded') and v_delta > 0 then
    update public.payments
      set status = (case when v_refund >= v_pay.gross_amount then 'refunded'
                         else 'partially_refunded' end)::public.payment_status,
          refunded_amount = v_refund
      where id = v_pay.id;

    -- El tramo se parte entre tarjeta y crédito (`reembolsar_con_credito`).
    -- `p_ya_devuelto` es `v_prev`, el acumulado de ANTES: el `update` de encima
    -- ya movió la fila.
    v_reparto := public.reembolsar_con_credito(
      v_pay.id,
      v_delta,
      v_prev,
      case when v_tramos
           then 'M1 · el tutor saca al alumno de un ciclo empezado (las fechas que faltan)'
           else 'RN-37 · cancela ' || (case when v_is_tutor then 'el tutor' else 'el alumno' end)
                || ' (' || (v_pol ->> 'pct') || ' %)'
      end,
      'X01:payment:' || v_pay.id || ':' || v_refund
    );

  elsif v_pay.status = 'pending' then
    -- Nunca se cobró (pending_payment): sin reembolso. Este 'failed' es además
    -- el que hace que X-02 rechace un cobro que llegue tarde por esta reserva.
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    -- Y la cuarta puerta: el crédito ya aplicado a una reserva sin pagar vuelve.
    perform public.liberar_credito_de_pago(v_pay.id);
    v_refund := 0;
  end if;

  if v_tramos then
    -- M1 · solo caen las fechas que faltan; lo ya dado sigue siendo del tutor.
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled' and start_at > now();
    update public.bookings
      set cancel_reason = coalesce(v_motivo, cancel_reason)
      where id = p_booking_id;
    -- La reserva no pasa a `cancelled`, así que `notify_booking` no avisa: el
    -- NTF-55 va aquí, con `tramos` para que el correo no prometa el 100 %. La
    -- clave es la de «se canceló tu cupo»: si luego cae la clase, no se repite.
    perform public.enqueue_notification(b.student_id, 'NTF-55', 'email', 'group_cancelled',
              jsonb_build_object('booking_id', b.id, 'product_id', b.product_id, 'para', 'alumno',
                                 'motivo', v_motivo, 'tramos', true),
              'NTF-55:product:' || b.product_id || ':' || b.student_id)
       from public.bookings b where b.id = p_booking_id;
    -- Sin nada por delante, la reserva terminó: se completa (misma condición que
    -- `cancelar_fecha_grupal`; close_expired_sessions no la vería nunca).
    if not exists (
      select 1 from public.sessions s
       where s.booking_id = p_booking_id and s.status in ('scheduled', 'in_progress')
    ) then
      update public.bookings
         set status = 'completed', completed_at = now()
       where id = p_booking_id and status in ('confirmed', 'in_progress');
    end if;
  else
    update public.bookings
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = v_motivo
      where id = p_booking_id;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  -- `refund_amount` es el ACUMULADO EN PRECIO (lo pinta cancel-form.tsx);
  -- `refund_cash`, `refund_credit` y `refund_credit_perdido`, lo que se movió.
  return jsonb_build_object(
    'refund_pct',            (v_pol ->> 'pct')::int,
    'refund_amount',         v_refund,
    'refund_cash',           coalesce((v_reparto ->> 'cash')::bigint, 0),
    'refund_credit',         coalesce((v_reparto ->> 'credit')::bigint, 0),
    'refund_credit_perdido', coalesce((v_reparto ->> 'credito_perdido')::bigint, 0),
    'tramos',                v_tramos
  );
end;
$function$;

comment on function public.cancel_booking(uuid, text) is
  'RN-37 · cancela y reparte el reembolso entre la tarjeta y el crédito que lo financió. La regla (quién, cuándo, cuánto) es politica_de_baja (M26). M1: si el tutor saca a alguien de un ciclo empezado, solo caen las fechas que faltan y la reserva se completa al quedarse sin fechas. refund_amount es el acumulado EN PRECIO.';


-- ── 3 · M15: reagendar ─────────────────────────────────────────────────────
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
  -- M15 · las 24 h valen también para la hora NUEVA (RG-11, confirmado por
  -- Emilio el 16-oct): si no, se movía una clase a dentro de 5 minutos y el
  -- aviso NTF-54 llegaba cuando ya había empezado.
  if p_nuevo_inicio < now() + interval '24 hours' then
    raise exception 'La hora nueva tiene que estar al menos a 24 horas.'
      using errcode = 'check_violation';
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
           union all
           select 'NTF-08:group_class:' || v_gc.id || ':tutor'   -- G · 20261009150000
         );

  update public.sessions
     set start_at = p_nuevo_inicio,
         end_at   = p_nuevo_inicio + (v_gc.end_at - v_gc.start_at)
   where group_class_id = v_gc.id and status = 'scheduled';

  -- M15 · el ciclo sigue numerado por fecha: mover la 1 detrás de la 2 dejaba
  -- «Fecha 2» antes que «Fecha 1» en la sala, el calendario y la ficha. En dos
  -- pasos, porque (product_id, sequence_no) es único y no diferible.
  update public.group_classes g
     set sequence_no = x.n + 1000
    from (select id, row_number() over (order by start_at, id) as n
            from public.group_classes where product_id = v_gc.product_id) x
   where g.id = x.id;
  update public.group_classes
     set sequence_no = sequence_no - 1000
   where product_id = v_gc.product_id;
  update public.sessions s
     set sequence_no = g.sequence_no
    from public.group_classes g
   where s.group_class_id = g.id
     and g.product_id = v_gc.product_id
     and s.sequence_no is distinct from g.sequence_no;
end;
$$;


-- ── 4 · B7: el cupo mínimo, una sola vez ───────────────────────────────────
create or replace function public.cancelar_grupales_sin_minimo()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      record;
  v_n      int := 0;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  for v_c in
    select p.id, p.tutor_id, p.min_seats,
           (select count(*) from public.bookings b
             where b.product_id = p.id
               and b.status in ('confirmed', 'in_progress')) as pagados
      from public.products p
      join lateral (
        select min(g.start_at) as inicio
          from public.group_classes g
         where g.product_id = p.id and g.status <> 'cancelled'
      ) f on true
     where p.pricing_model = 'group'
       and p.min_seats is not null
       and p.minimo_evaluado_at is null          -- B7 · una sola vez
       and f.inicio > now()
       and f.inicio <= now() + interval '24 hours'
       and exists (select 1 from public.group_classes g
                    where g.product_id = p.id and g.status = 'scheduled')
  loop
    begin
      if v_c.pagados < v_c.min_seats then
        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_c.tutor_id, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', v_c.tutor_id::text, true);
        perform public.cancelar_clase_grupal(v_c.id, 'No se alcanzó el cupo mínimo de la clase');
        v_n := v_n + 1;
      else
        -- Llegó al mínimo a las 24 h: ya no se vuelve a mirar (una baja
        -- posterior no cancela la clase para los demás, RG-09).
        update public.products set minimo_evaluado_at = now() where id = v_c.id;
      end if;
    exception when others then
      raise warning 'cancelar_grupales_sin_minimo: la clase % no se pudo evaluar: % (%)',
        v_c.id, sqlerrm, sqlstate;
    end;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_n;
end;
$$;

comment on function public.cancelar_grupales_sin_minimo() is
  'RG-04/B7 · al entrar la primera fecha en las últimas 24 h, una grupal con min_seats se cancela con el 100 % si no llega al mínimo de cupos PAGADOS, o se marca minimo_evaluado_at y no se vuelve a mirar. Corre por pg_cron (cancelar-grupales-sin-minimo, cada 15 min). Un fallo por clase sale como WARNING y no para el resto.';


-- ── 5 · B7: publicar con mínimo exige 48 h ─────────────────────────────────
create or replace function public.publicar_clase_grupal(
  p_product uuid,
  p_fechas  timestamptz[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prod     record;
  v_fechas   timestamptz[];
  v_choques  text;
  v_i        int := 0;
  v_f        timestamptz;
begin
  select p.id, p.tutor_id, p.pricing_model, p.session_duration_min, p.status, p.min_seats
    into v_prod
    from public.products p
   where p.id = p_product
   for update;

  if v_prod.id is null or v_prod.tutor_id is distinct from (select auth.uid()) then
    raise exception 'no puedes publicar esta clase' using errcode = '42501';
  end if;
  if v_prod.pricing_model <> 'group' then
    raise exception 'esta mentoría no es una clase grupal' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.tutor_profiles tp
     where tp.profile_id = v_prod.tutor_id and tp.group_classes_enabled
  ) then
    raise exception 'las clases grupales no están habilitadas para este tutor'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.group_classes g where g.product_id = p_product) then
    raise exception 'esta clase ya está publicada' using errcode = 'check_violation';
  end if;
  if v_prod.session_duration_min is null then
    raise exception 'la clase necesita una duración' using errcode = 'check_violation';
  end if;

  select array_agg(distinct f order by f) into v_fechas from unnest(p_fechas) f;
  -- ponytail: tope de 20 fechas por ciclo, sin dato del cliente detrás; súbelo si lo pide.
  if v_fechas is null or array_length(v_fechas, 1) > 20 then
    raise exception 'una clase lleva entre 1 y 20 fechas' using errcode = 'check_violation';
  end if;
  if v_fechas[1] <= now() then
    raise exception 'las fechas tienen que ser futuras' using errcode = 'check_violation';
  end if;
  -- B7 · con cupo mínimo, la primera fecha a más de 48 h (Emilio, 16-oct): el
  -- mínimo se revisa una vez a las 24 h, y una clase publicada para mañana se
  -- cancelaba sola en el primer pase del cron, sin tiempo de llenarse.
  if v_prod.min_seats is not null and v_fechas[1] < now() + interval '48 hours' then
    raise exception 'Con cupo mínimo, la primera fecha tiene que estar a más de 48 horas.'
      using errcode = 'check_violation';
  end if;

  -- Las fechas en conflicto, TODAS y por su nombre (G1: el tutor tiene que
  -- saber cuáles mover). Es la comprobación amable; la de verdad es el
  -- candado, que salta abajo si alguien reserva entre medias.
  select string_agg(to_char(f at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), ', ' order by f)
    into v_choques
    from unnest(v_fechas) f
   where exists (
           select 1 from public.sessions s
            where s.tutor_id = v_prod.tutor_id
              and s.status not in ('cancelled', 'no_show')
              and tstzrange(s.start_at, s.end_at)
                  && tstzrange(f, f + make_interval(mins => v_prod.session_duration_min)))
      or exists (
           select 1 from public.group_classes g
            where g.tutor_id = v_prod.tutor_id and g.status = 'scheduled'
              and tstzrange(g.start_at, g.end_at)
                  && tstzrange(f, f + make_interval(mins => v_prod.session_duration_min)))
      -- Dos fechas del propio ciclo que se pisan entre sí.
      or exists (
           select 1 from unnest(v_fechas) o
            where o <> f
              and tstzrange(o, o + make_interval(mins => v_prod.session_duration_min))
                  && tstzrange(f, f + make_interval(mins => v_prod.session_duration_min)));
  if v_choques is not null then
    raise exception 'estas fechas chocan con tu agenda: %', v_choques
      using errcode = 'exclusion_violation', detail = v_choques;
  end if;

  foreach v_f in array v_fechas loop
    v_i := v_i + 1;
    insert into public.group_classes (product_id, tutor_id, sequence_no, start_at, end_at)
    values (p_product, v_prod.tutor_id, v_i, v_f,
            v_f + make_interval(mins => v_prod.session_duration_min));
  end loop;

  -- RG-16: en grupales, package_num_sessions = número de fechas.
  update public.products
     set package_num_sessions = v_i, status = 'active'
   where id = p_product;
end;
$$;


-- ── 6 · B6: la clase publicada no cambia por debajo ────────────────────────
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

  -- B6 · con la clase publicada (ya tiene fechas), lo que el alumno compró no
  -- cambia por debajo (RG-02; Emilio, 16-oct): mínimo, precio y duración
  -- quedan fijos —se cancela y se publica otra— y el cupo puede subir, pero
  -- nunca por debajo de las reservas vivas (Daily admite cupo + 1: un cupo
  -- más bajo dejaba fuera de la sala a alumnos que habían pagado).
  if tg_op = 'UPDATE' and new.pricing_model = 'group'
     and exists (select 1 from public.group_classes g where g.product_id = old.id)
  then
    if new.min_seats is distinct from old.min_seats then
      raise exception 'Con la clase publicada, el cupo mínimo ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.price_amount is distinct from old.price_amount then
      raise exception 'Con la clase publicada, el precio ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.session_duration_min is distinct from old.session_duration_min then
      raise exception 'Con la clase publicada, la duración ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    -- `package_num_sessions` es la N del prorrateo (precio_vigente_grupal):
    -- moverla es cambiar el precio. Solo vale el valor que escribe
    -- publicar_clase_grupal, que es el número de fechas.
    if new.package_num_sessions is distinct from old.package_num_sessions
       and new.package_num_sessions is distinct from
           (select count(*)::int from public.group_classes g where g.product_id = old.id)
    then
      raise exception 'Con la clase publicada, el número de fechas ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.currency is distinct from old.currency then
      raise exception 'Con la clase publicada, la moneda ya no se cambia: cancélala y publica otra.'
        using errcode = 'check_violation';
    end if;
    if new.capacity is distinct from old.capacity and new.min_seats is not null
       and new.capacity < new.min_seats
    then
      raise exception 'El cupo no puede quedar por debajo del cupo mínimo de la clase.'
        using errcode = 'check_violation';
    end if;
    if new.capacity is distinct from old.capacity and new.capacity < (
         select count(*) from public.bookings b
          where b.product_id = old.id
            and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress'))
    then
      raise exception 'El cupo no puede quedar por debajo de los alumnos ya inscritos o pagando.'
        using errcode = 'check_violation';
    end if;
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

-- La guarda salta también con las columnas que B6 congela.
drop trigger if exists products_guarda_grupal on public.products;
create trigger products_guarda_grupal
  before insert or update of pricing_model, status, academy_id,
                             capacity, min_seats, price_amount, session_duration_min,
                             package_num_sessions, currency
  on public.products
  for each row execute function public.products_guarda_grupal();


-- ── 8 · el comentario de admin_sacar_de_clase_grupal ya no es verdad ───────
comment on function public.admin_sacar_de_clase_grupal(uuid, text) is
  'G4 · el admin cancela el cupo de UN alumno en una clase grupal (cancel_booking como el tutor de la reserva): 100 % antes de empezar; con el ciclo empezado, M1, la parte de las fechas que faltan. El alumno recibe NTF-55 con el motivo.';


-- ── 9 · RN-23 solo en la publicación ───────────────────────────────────────
-- La guarda saltaba con CUALQUIER escritura sobre una fila 'active' de un tutor
-- no aprobado (suspender solo le quita el rol: sus productos siguen 'active').
-- Así fallaban en silencio la marca de B7 —y el cron volvía a evaluar el
-- mínimo, que es justo lo que B7 cierra— y el cierre de inscripción del lote 1.
-- RN-23 habla de PUBLICAR: se comprueba en el alta y en la transición a 'active'.
create or replace function public.enforce_product_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not exists (
       select 1
       from public.tutor_profiles tp
       where tp.profile_id = new.tutor_id
         and tp.approval_status = 'approved'
     )
  then
    raise exception 'RN-23: solo un tutor aprobado puede publicar productos'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

