-- ============================================================================
-- Enséñame Ya — cancelar la última fecha viva de un ciclo completa la reserva
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Bug de `cancelar_fecha_grupal` (`20261008180000`), encontrado al probar
-- `20261008230000`: ciclo de 2 fechas, la 1 ya se dio y el tutor cancela la 2.
-- Cada alumno recupera su mitad, pero la reserva se queda 'confirmed' PARA
-- SIEMPRE: no le queda ninguna sesión viva, y `close_expired_sessions` solo
-- completa las reservas de las sesiones que acaba de cerrar él. Sin
-- 'completed' no hay payout (`build_payout_for_tutor` filtra por ahí).
--
-- Copia íntegra de la función con un `elsif` nuevo marcado «ARREGLO».
-- ============================================================================

create or replace function public.cancelar_fecha_grupal(
  p_group_class uuid,
  p_motivo      text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_gc      record;
  v_bk      record;
  v_pay     record;
  v_k       int;
  v_target  bigint;
  v_delta   bigint;
  v_n       int := 0;
  v_claims  text;
  v_sub     text;
  v_motivo  text := coalesce(nullif(trim(p_motivo), ''), 'El tutor canceló una fecha de la clase grupal');
begin
  select g.id, g.product_id, g.tutor_id, g.status, g.start_at into v_gc
    from public.group_classes g where g.id = p_group_class;

  if v_gc.id is null then
    raise exception 'esa fecha no existe' using errcode = 'check_violation';
  end if;
  if v_uid is distinct from v_gc.tutor_id and not public.has_role('admin') then
    raise exception 'no puedes cancelar esta fecha' using errcode = '42501';
  end if;
  if v_gc.status <> 'scheduled' or v_gc.start_at <= now() then
    raise exception 'esa fecha ya no se puede cancelar' using errcode = 'check_violation';
  end if;

  -- Serializa contra inscripciones nuevas (create_booking_line bloquea lo mismo).
  perform 1 from public.products where id = v_gc.product_id for update;

  -- Si es la única fecha y nada ha empezado, es cancelar la clase entera.
  if not exists (select 1 from public.group_classes g
                  where g.product_id = v_gc.product_id and g.id <> v_gc.id
                    and g.status <> 'cancelled') then
    return public.cancelar_clase_grupal(v_gc.product_id, v_motivo);
  end if;

  update public.group_classes
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_motivo
   where id = v_gc.id;

  -- Los holds (sin pagar) se sueltan enteros: sus fechas ya no son las que
  -- vieron, y create_booking_line no los dejaría pagar otras.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub    := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_gc.tutor_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_gc.tutor_id::text, true);
  for v_bk in
    select b.id from public.bookings b
     where b.product_id = v_gc.product_id and b.status = 'pending_payment'
     for update
  loop
    perform public.cancel_booking(v_bk.id, v_motivo);
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  for v_bk in
    select b.id, b.num_sessions from public.bookings b
     where b.product_id = v_gc.product_id
       and b.status in ('pending_acceptance', 'confirmed', 'in_progress')
     for update
  loop
    update public.sessions set status = 'cancelled', cancelled_at = now()
     where booking_id = v_bk.id and group_class_id = v_gc.id and status = 'scheduled';

    select count(*) into v_k from public.sessions s
     where s.booking_id = v_bk.id and s.group_class_id is not null and s.status = 'cancelled';

    select p.id, p.status, p.gross_amount, coalesce(p.refunded_amount, 0) as refunded_amount
      into v_pay
      from public.payments p where p.booking_id = v_bk.id for update;

    if v_pay.status in ('paid', 'partially_refunded') then
      -- Tramo acumulado: la suma de los tramos es gross exacto cuando caen todas.
      v_target := greatest(round(v_pay.gross_amount * v_k::numeric / greatest(v_bk.num_sessions, 1)),
                           v_pay.refunded_amount);
      v_delta  := v_target - v_pay.refunded_amount;

      if v_delta > 0 then
        update public.payments
           set refunded_amount = v_target,
               status = (case when v_target >= v_pay.gross_amount then 'refunded'
                              else 'partially_refunded' end)::public.payment_status
         where id = v_pay.id;

        perform public.reembolsar_con_credito(
          v_pay.id, v_delta, v_pay.refunded_amount,
          'RG-16 · el tutor canceló una fecha del ciclo',
          'G55:group_class:' || v_gc.id || ':payment:' || v_pay.id
        );
      end if;
    end if;

    -- Sin ninguna fecha viva, la reserva ya no tiene nada que dar.
    if v_k >= v_bk.num_sessions then
      update public.bookings
         set status = 'cancelled', cancelled_at = now(), cancel_reason = v_motivo
       where id = v_bk.id;
    -- 🔴 ARREGLO · si lo que queda vivo era SOLO esta fecha y alguna ya se dio,
    -- la reserva está terminada: se completa aquí, con la misma condición que
    -- close_expired_sessions. Ese job no la vería nunca, porque solo revisa
    -- las reservas de las sesiones que él mismo cierra.
    elsif not exists (
      select 1 from public.sessions s
       where s.booking_id = v_bk.id and s.status in ('scheduled', 'in_progress')
    ) then
      update public.bookings
         set status = 'completed', completed_at = now()
       where id = v_bk.id and status in ('confirmed', 'in_progress');
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;


