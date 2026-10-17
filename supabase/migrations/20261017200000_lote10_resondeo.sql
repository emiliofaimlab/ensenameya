-- ============================================================================
-- Lote 10 · re-sondeo (docs/SONDEO-GRUPALES-LOTES.md)
--
-- POR QUÉ
--   La batería del anexo B (11 escenarios, revertida contra dev) pasó entera,
--   pero dejó una observación: cuando caduca un apartado sin pagar de una
--   grupal, `notify_booking` caía en la rama genérica de cancelación y le
--   mandaba al tutor el NTF-09 de 1:1 («el horario volvió a quedar libre»),
--   el texto que A2 (lote 6) ya calificó de falso para grupales. Las ramas
--   grupales excluyen `old.status = 'pending_payment'` a propósito (un hold no
--   es una inscripción), y por eso el caso se colaba en la genérica.
--
-- QUÉ CAMBIA
--   notify_booking (vigente: 20261017160000, cuerpo vivo en dev idéntico):
--   una rama propia, sin avisos, para la grupal que pasa de pending_payment a
--   cancelled. El NTF-15 al alumno (pago caducado) no depende de esta función.
--   En 1:1 no cambia nada: ahí el aviso por caducidad ya existía y se queda.
-- ============================================================================

create or replace function public.notify_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Lote 6 · lo que los avisos grupales nombran (A3): solo se lee en grupales.
  v_clase  text;
  v_cupo   int;
  v_alumno text;
  v_monto  bigint;
  v_moneda text;
begin
  if new.status is distinct from old.status then
    if new.pricing_model = 'group' then
      select pr.title, pr.capacity into v_clase, v_cupo
        from public.products pr where pr.id = new.product_id;
      select public.mask_person_name(al.full_name) into v_alumno
        from public.profiles al where al.id = new.student_id;
    end if;

    -- La reserva está pagada y esperando al tutor: es AHORA cuando hay que
    -- avisarle, con las 24 h por delante y no ya gastadas.
    if new.status = 'pending_acceptance' then
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);
      -- NTF-17b: y al alumno, que hasta hoy pagaba y no recibía nada hasta que
      -- el tutor contestara. El plazo de 24 h y el reembolso del 100 % de
      -- RN-38 solo son justos si se le cuentan al empezar, no al vencer.
      perform public.enqueue_notification(new.student_id, 'NTF-17b', 'email', 'booking_pending_student',
        jsonb_build_object('booking_id', new.id), 'NTF-17b:booking:' || new.id);

    elsif new.status = 'confirmed' and new.pricing_model = 'group' then
      -- G · RG-06/07: en una grupal nadie acepta. NTF-56 al alumno en lugar de
      -- NTF-05 («el tutor aceptó tu reserva») y NTF-51 al tutor en lugar de
      -- NTF-07 («tienes 24 h para aceptar»).
      -- Lote 6 · P14: NTF-56 ES el recibo de una grupal (notify_payment ya no
      -- manda NTF-04 para ellas), así que lleva lo cobrado: gross − crédito.
      select pm.gross_amount - coalesce(pm.credit_amount, 0), pm.currency
        into v_monto, v_moneda
        from public.payments pm where pm.booking_id = new.id;
      perform public.enqueue_notification(new.student_id, 'NTF-56', 'email', 'group_enrolled_student',
        jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'alumno',
                           'clase', v_clase, 'amount', v_monto, 'currency', v_moneda),
        'NTF-56:booking:' || new.id);
      -- Lote 6 · A3: quién y en qué clase, con el nombre enmascarado («Elena G.»).
      perform public.enqueue_notification(new.tutor_id, 'NTF-51', 'email', 'group_enrolled_tutor',
        jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'tutor',
                           'clase', v_clase, 'alumno', v_alumno),
        'NTF-51:booking:' || new.id);
      -- G4 · NTF-52: el cupo que acaba de confirmarse era el último.
      -- Lote 6 · M17: cuenta solo los PAGADOS. Con cupos_libres un hold abierto
      -- contaba como lleno y «tu clase se llenó» llegaba sin estarlo.
      -- Dos últimos cupos confirmados a la vez: en READ COMMITTED ninguno ve
      -- el otro y nadie avisaba. Se serializa por producto con un candado
      -- propio (un `for update` del producto invertiría el orden de
      -- cancelar_clase_grupal y daría deadlock); la sentencia siguiente toma
      -- un snapshot nuevo y ya ve la confirmación de la otra.
      perform pg_advisory_xact_lock(hashtext('ntf52:' || new.product_id::text));
      if public.inscritos_pagados(new.product_id) >= v_cupo then
        perform public.enqueue_notification(new.tutor_id, 'NTF-52', 'email', 'group_full_tutor',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'tutor',
                             'clase', v_clase),
          'NTF-52:product:' || new.product_id);
      end if;

    elsif new.status = 'confirmed' then
      perform public.enqueue_notification(new.student_id, 'NTF-05', 'email', 'booking_confirmed_student',
        jsonb_build_object('booking_id', new.id), 'NTF-05:booking:' || new.id);
      -- Se mantiene para el tutor con auto-aceptar, que nunca pasa por
      -- `pending_acceptance`. Si ya pasó, la clave repetida lo descarta.
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);

    elsif new.status = 'cancelled' and new.pricing_model = 'group'
          and old.status <> 'pending_payment'
          and (select auth.uid()) = new.student_id then
      -- Lote 6 · A2: el alumno se dio de baja él mismo. La clase SIGUE: el
      -- genérico de 1:1 («el horario volvió a quedar libre») era falso. Al tutor,
      -- quién se fue y cuántos quedan; al alumno, su propia plantilla. Mismas
      -- claves que la rama genérica: nunca sale doble.
      perform public.enqueue_notification(new.tutor_id, 'NTF-09', 'email', 'group_left_tutor',
        jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'tutor',
                           'clase', v_clase, 'alumno', v_alumno,
                           'inscritos', public.inscritos_pagados(new.product_id), 'cupo', v_cupo),
        'NTF-09:booking:' || new.id || ':tutor');
      perform public.enqueue_notification(new.student_id, 'NTF-09', 'email', 'group_left_student',
        jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'alumno',
                           'clase', v_clase),
        'NTF-09:booking:' || new.id || ':student');

    elsif new.status = 'cancelled' and new.pricing_model = 'group'
          and old.status <> 'pending_payment'
          and (select auth.uid()) is distinct from new.student_id then
      -- G4 · el cupo lo canceló otro: el tutor (o el admin) al cancelar la
      -- clase o al sacarlo, o el cron del mínimo. Un aviso propio en vez de
      -- NTF-09, y al tutor nada por cupo: él lo hizo, o recibe NTF-53 una vez.
      if new.cancel_reason = 'No se alcanzó el cupo mínimo de la clase' then
        perform public.enqueue_notification(new.student_id, 'NTF-53', 'email', 'group_min_cancelled',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'alumno',
                             'clase', v_clase),
          'NTF-53:product:' || new.product_id || ':' || new.student_id);
        -- Misma clave que encola cancelar_clase_grupal (M20): uno solo.
        perform public.enqueue_notification(new.tutor_id, 'NTF-53', 'email', 'group_min_cancelled',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'tutor',
                             'clase', v_clase),
          'NTF-53:product:' || new.product_id || ':' || new.tutor_id);
      else
        -- Lote 6 · P39: `alcance` dice si cayó la CLASE entera (lo marca
        -- cancelar_clase_grupal con `ey.cancelando_clase`) o solo este cupo.
        perform public.enqueue_notification(new.student_id, 'NTF-55', 'email', 'group_cancelled',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'alumno',
                             'motivo', new.cancel_reason, 'clase', v_clase,
                             'alcance', case when current_setting('ey.cancelando_clase', true)
                                                  = new.product_id::text
                                             then 'clase' else 'cupo' end),
          'NTF-55:product:' || new.product_id || ':' || new.student_id);
      end if;

    elsif new.status = 'cancelled' and new.pricing_model = 'group'
          and old.status = 'pending_payment' then
      -- Lote 10 · un checkout ABANDONADO de una grupal (el apartado caduca o
      -- se suelta): no hubo inscripción, así que no hay baja que avisar. Al
      -- alumno ya le llega NTF-15 (pago caducado); al tutor, el genérico de
      -- 1:1 le decía «el horario volvió a quedar libre» por alguien que nunca
      -- estuvo en su clase.
      null;

    elsif new.status = 'cancelled' then
      -- EY-218: misma plantilla para los dos; `para` dice a quién se le habla
      -- (al tutor no se le promete un reembolso ni se le manda a SCR-AL03).
      perform public.enqueue_notification(new.student_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id, 'para', 'alumno'),
        'NTF-09:booking:' || new.id || ':student');
      perform public.enqueue_notification(new.tutor_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id, 'para', 'tutor'),
        'NTF-09:booking:' || new.id || ':tutor');

    elsif new.status = 'completed' then
      -- NTF-14: al completar, invita a reseñar (RN-28).
      -- EY-220: si ya reseñó en el pop-up al colgar (antes del cierre), no se
      -- le vuelve a pedir. `reviews.booking_id` es unique (RN-17).
      if not exists (select 1 from public.reviews r where r.booking_id = new.id) then
        perform public.enqueue_notification(new.student_id, 'NTF-14', 'email', 'review_request',
          jsonb_build_object('booking_id', new.id), 'NTF-14:booking:' || new.id);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

comment on function public.notify_booking() is
  'Avisos por cambio de estado de una reserva. 1:1: NTF-05/07/09/14/17b. Grupales (G3/G4): NTF-51/56 al inscribirse, NTF-52 al tutor cuando los PAGADOS llegan a la capacidad (inscritos_pagados, M17), NTF-09 con group_left_tutor/group_left_student cuando el propio alumno se da de baja (A2), y NTF-53 (mínimo) o NTF-55 cuando el cupo lo cancela otro que no es el alumno. Lote 6: todos los grupales llevan `clase`; NTF-51 el alumno enmascarado; NTF-56 lo cobrado (amount, currency) porque es el recibo de la grupal (P14); NTF-55 `alcance` = clase | cupo según ey.cancelando_clase (P39). Lote 10: un apartado sin pagar que caduca no avisa a nadie (el alumno ya recibe NTF-15).';
