-- ============================================================================
-- Enséñame Ya — cancelar una clase grupal o una fecha de un ciclo (Fase C)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2:
--   · RG-10 · el tutor (o el admin) cancela la clase → 100 % a todos.
--   · RG-16 · en un ciclo, cancela UNA fecha → cada inscrito recupera esa
--     fecha (su pago entre N) y el resto del ciclo sigue.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Cancelar la clase NO reescribe dinero: llama a `cancel_booking`
--   (versión viva `20260912110000:3022`) por cada reserva, como parte tutor,
--   que ya da el 100 % y ya reparte tarjeta/crédito. Para el ADMIN se le presta
--   la identidad del tutor durante el bucle (`request.jwt.claims`), porque
--   `cancel_booking` decide quién cancela por `auth.uid()`. Se restaura al
--   salir; si algo falla, la transacción entera se deshace con ella.
--
-- · Cancelar una fecha reembolsa por TRAMOS ACUMULADOS, como `cancel_booking`:
--   objetivo = round(gross · k / N), con k = fechas canceladas de esa reserva.
--   Así la suma de los tramos es exactamente `gross` cuando caen todas, sin
--   restos de redondeo. Pasa por `reembolsar_con_credito`, que parte tarjeta y
--   crédito. Stripe y dLocal ya mandan el importe parcial
--   (`stripe-provider.ts:887`, `dlocal-provider.ts:1912`): es el mismo camino
--   que el 50 % de RN-37.
--
-- · 🔴 HUECO CONOCIDO, PENDIENTE DE LA REESCRITURA DEL PAYOUT:
--   `build_payout_for_tutor` (`20260912100000:482`) solo paga `status =
--   'paid'`. Un ciclo con una fecha cancelada queda `partially_refunded` y el
--   tutor dejaría de cobrar TODO el ciclo, no solo esa fecha. Lo correcto es
--   pagarle tutor_net · (N − k) / N. Se arregla en la reescritura única de
--   `build_payout_for_tutor` / `tutor_balance` que exige academias (§2 del
--   plan), no aquí, para no reescribir dos veces la función del dinero.
--
-- · El correo (NTF-55) llega con los avisos de G3/G4; aquí no se encola nada.
-- ============================================================================


-- ── 1 · cancelar_clase_grupal (RG-10) ───────────────────────────────────────
create or replace function public.cancelar_clase_grupal(
  p_product uuid,
  p_motivo  text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_prod   record;
  v_claims text;
  v_sub    text;
  v_bk     record;
  v_n      int := 0;
  v_motivo text := coalesce(nullif(trim(p_motivo), ''), 'El tutor canceló la clase grupal');
begin
  select p.id, p.tutor_id, p.pricing_model into v_prod
    from public.products p where p.id = p_product for update;

  if v_prod.id is null or v_prod.pricing_model <> 'group' then
    raise exception 'esta mentoría no es una clase grupal' using errcode = 'check_violation';
  end if;
  if v_uid is distinct from v_prod.tutor_id and not public.has_role('admin') then
    raise exception 'no puedes cancelar esta clase' using errcode = '42501';
  end if;
  -- Empezada, ya no se cancela entera: el 100 % a todos devolvería fechas que
  -- sí se dieron. Lo que falte se cancela fecha a fecha.
  if exists (select 1 from public.group_classes g
              where g.product_id = p_product and g.status <> 'cancelled' and g.start_at <= now()) then
    raise exception 'la clase ya empezó: cancela las fechas que faltan' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.group_classes g
                  where g.product_id = p_product and g.status = 'scheduled') then
    raise exception 'esta clase no tiene fechas pendientes' using errcode = 'check_violation';
  end if;

  -- `cancel_booking` decide el porcentaje por quién llama: como tutor, 100 %.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub    := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_prod.tutor_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_prod.tutor_id::text, true);

  for v_bk in
    select b.id from public.bookings b
     where b.product_id = p_product
       and b.status in ('pending_payment', 'pending_acceptance', 'confirmed')
     for update
  loop
    perform public.cancel_booking(v_bk.id, v_motivo);
    v_n := v_n + 1;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  update public.group_classes
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_motivo
   where product_id = p_product and status = 'scheduled';

  -- Sale del catálogo y no se puede volver a publicar (publicar_clase_grupal
  -- exige que no tenga fechas): una clase nueva es un producto nuevo.
  update public.products set status = 'archived' where id = p_product;

  return v_n;
end;
$$;

comment on function public.cancelar_clase_grupal(uuid, text) is
  'RG-10 · el tutor o el admin cancela una clase grupal que aún no empezó: cancel_booking como parte tutor (100 %) en cada reserva viva, fechas a cancelled y producto archivado. Devuelve cuántas reservas canceló.';

revoke execute on function public.cancelar_clase_grupal(uuid, text) from public, anon;
grant  execute on function public.cancelar_clase_grupal(uuid, text) to authenticated;


-- ── 2 · cancelar_fecha_grupal (RG-16) ───────────────────────────────────────
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
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.cancelar_fecha_grupal(uuid, text) is
  'RG-16 · el tutor o el admin cancela UNA fecha de un ciclo: reembolso acumulado round(gross·k/N) a cada inscrito vía reembolsar_con_credito, holds soltados enteros. Si es la última fecha viva, delega en cancelar_clase_grupal. ⚠️ El payout del tutor sobre un pago partially_refunded está pendiente de la reescritura de build_payout_for_tutor.';

revoke execute on function public.cancelar_fecha_grupal(uuid, text) from public, anon;
grant  execute on function public.cancelar_fecha_grupal(uuid, text) to authenticated;
