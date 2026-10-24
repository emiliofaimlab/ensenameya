-- ============================================================================
-- Enséñame Ya — Lote 6 del sondeo de grupales: avisos y correos
-- (`docs/SONDEO-GRUPALES-LOTES.md`, «Lote 6 · Avisos y correos»)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- · A2  · la baja del PROPIO alumno de una grupal caía en la rama genérica de
--         1:1: a la tutora le llegaba «el horario volvió a quedar libre», y es
--         falso, la clase sigue. Rama propia en `notify_booking` (NTF-09 con
--         plantillas group_left_tutor / group_left_student).
-- · A3  · la campana no decía ni quién ni qué clase, y el contador se sacaba de
--         los 8 últimos avisos (el «9+» era inalcanzable). Los payloads de
--         NTF-51/52/53/54/55/56 llevan `clase` (y NTF-51 el `alumno`
--         enmascarado), y `session_bootstrap` trae `notices_unread`, un count
--         aparte con el mismo filtro que los avisos.
-- · A9  · en un ciclo, el recordatorio de la 2.ª fecha enseñaba la 1.ª y su
--         «Entrar a la sala» llevaba a una sala cerrada:
--         `pending_email_notifications` tomaba siempre la primera sesión. Ahora
--         manda la del payload (`session_id`) cuando viene.
-- · M17 · «inscritos» cambiaba según la pantalla, y «tu clase se llenó» podía
--         llegar sin estar llena (contaba los holds). `inscritos_pagados()` es
--         LA definición —confirmed | in_progress, la misma que usa
--         `cancelar_grupales_sin_minimo`—, sale en `group_classes_public` y es
--         la que decide NTF-52.
-- · M20 · una clase cancelada sola SIN alumnos pagados no le avisaba a nadie:
--         NTF-53 al tutor colgaba de `notify_booking`, o sea de que hubiera
--         reservas que cancelar. `cancelar_clase_grupal` lo encola ahora ella
--         misma, con LA MISMA clave, y avisa también al tutor cuando la cancela
--         el admin (NTF-55). La parte de NTF-19 (un «tu grabación está lista»
--         por alumno) ya la cerró `20261017140000` (clave
--         `NTF-19:group_class:<id>:tutor`): aquí no se toca `notify_recording`.
-- · M27 · cancelar la ÚLTIMA fecha que queda de un ciclo ya empezado no
--         avisaba: RG-16 exigía otra fecha `scheduled`, y las ya dadas no lo
--         son. La condición pasa a «hay otra fecha no cancelada».
-- · P14 · una inscripción le mandaba al alumno dos avisos (el recibo NTF-04 y
--         NTF-56). En una grupal suelta el recibo va DENTRO de NTF-56, que ahora
--         lleva `amount` y `currency`.
-- · P39 · el correo de cancelación de la clase entera decía «se canceló tu
--         cupo». NTF-55 al alumno lleva `alcance` = 'clase' | 'cupo'.
-- · P40 · la confirmación de inscripción solo enseñaba la primera fecha: el
--         contexto del correo trae `fechas`, todas las no canceladas.
--
-- ── QUÉ VERSIÓN REEMPLAZA CADA COSA ────────────────────────────────────────
-- (Comprobado contra el cuerpo vivo en dev el 17-oct: todas coinciden con su
-- migración, así que no hay cambios de la otra rama que combinar.)
-- · inscritos_pagados ............ NUEVA
-- · group_classes_public ......... 20261017110000:221   (+ 1 columna al final)
-- · notify_booking ............... 20261014150000:37    (cambios «Lote 6 ·»)
-- · avisar_cambio_de_fecha_grupal  20261014150000:131   (M27 + `clase`)
-- · cancelar_clase_grupal ........ 20261008180000:39    (única versión)
-- · pending_email_notifications .. 20260911170000:105   (A9 + P40 + M20)
-- · notify_payment ............... 20260912110000:3274  (P14)
-- · session_bootstrap ............ 20261013170000:226   (A3)
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Ninguna firma cambia: todo es `create or replace` (regla de oro 12 no
--   aplica). Aun así se reponen los grants de las RPC por si acaso.
-- · `ey.cancelando_clase` es una variable de transacción (set_config local)
--   que pone `cancelar_clase_grupal` mientras cancela las reservas: así
--   `notify_booking` sabe que el cupo cae porque cae la CLASE, sin tocar la
--   firma de `cancel_booking`.
-- · M14 (NTF-54 a ciclos ya empezados) NO se toca: decisión pendiente de
--   producto (regla de oro 8).
-- · No se toca ninguna tabla: no hay grants de tabla nuevos.
-- ============================================================================


-- ── 0 · inscritos_pagados (M17) ─────────────────────────────────────────────
create or replace function public.inscritos_pagados(p_product uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(b.id)::int
    from public.products p
    left join public.bookings b
      on b.product_id = p.id
     and b.status in ('confirmed', 'in_progress')
   where p.id = p_product and p.pricing_model = 'group'
$$;

comment on function public.inscritos_pagados(uuid) is
  'Lote 6 · M17 · LA definición de «inscritos» de una clase grupal: reservas PAGADAS (confirmed | in_progress), la misma que usa cancelar_grupales_sin_minimo. Los holds en curso no cuentan (eso es cupos_libres, que sí los descuenta). 0 si el producto no es grupal o no existe. SECURITY DEFINER como cupos_libres: cuenta reservas de otros que la RLS esconde, y solo devuelve el número.';

revoke execute on function public.inscritos_pagados(uuid) from public;
grant  execute on function public.inscritos_pagados(uuid) to anon, authenticated, service_role;


-- ── 1 · group_classes_public gana inscritos_pagados (al final) ──────────────
-- Al final de la lista, para que `create or replace view` no tenga que tirarla
-- (no se pueden reordenar ni renombrar columnas con replace).
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
         p.min_seats,
         public.inscritos_pagados(g.product_id) as inscritos_pagados
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.status = 'scheduled';

comment on view public.group_classes_public is
  'G2 · lo que el catálogo enseña de una clase grupal: sus fechas pendientes, el cupo y cuántos quedan. security_invoker: hereda la RLS de group_classes y products. Lote 6 · M17: cupos_libres DESCUENTA los holds en curso (un pago abierto ocupa su cupo); inscritos_pagados son SOLO los pagados (confirmed | in_progress). «+N pagando» = capacity − cupos_libres − inscritos_pagados.';

grant select on public.group_classes_public to anon, authenticated;


-- ── 2 · notify_booking (A2, A3, M17, P14, P39) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_booking()
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
  'Avisos por cambio de estado de una reserva. 1:1: NTF-05/07/09/14/17b. Grupales (G3/G4): NTF-51/56 al inscribirse, NTF-52 al tutor cuando los PAGADOS llegan a la capacidad (inscritos_pagados, M17), NTF-09 con group_left_tutor/group_left_student cuando el propio alumno se da de baja (A2), y NTF-53 (mínimo) o NTF-55 cuando el cupo lo cancela otro que no es el alumno. Lote 6: todos los grupales llevan `clase`; NTF-51 el alumno enmascarado; NTF-56 lo cobrado (amount, currency) porque es el recibo de la grupal (P14); NTF-55 `alcance` = clase | cupo según ey.cancelando_clase (P39).';


-- ── 3 · avisar_cambio_de_fecha_grupal (M27 + `clase`) ───────────────────────
create or replace function public.avisar_cambio_de_fecha_grupal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     record;
  v_clase text;
begin
  -- Lote 6 · A3: la campana y el correo nombran la clase.
  select pr.title into v_clase from public.products pr where pr.id = new.product_id;

  -- RG-11 · el tutor movió la hora de esta fecha.
  if new.rescheduled_at is not null and new.rescheduled_at is distinct from old.rescheduled_at then
    for v_b in
      select b.id, b.student_id from public.bookings b
       where b.product_id = new.product_id and b.status in ('confirmed', 'in_progress')
    loop
      perform public.enqueue_notification(v_b.student_id, 'NTF-54', 'email', 'group_rescheduled',
        jsonb_build_object('booking_id', v_b.id, 'product_id', new.product_id, 'group_class_id', new.id,
                           'nuevo_inicio', new.start_at, 'anterior', old.start_at, 'para', 'alumno',
                           'clase', v_clase),
        'NTF-54:group_class:' || new.id || ':' || extract(epoch from new.rescheduled_at)::bigint
          || ':' || v_b.student_id);
    end loop;
  end if;

  -- RG-16 · se canceló UNA fecha del ciclo. La clase entera cancelada la avisa
  -- notify_booking, una vez por alumno.
  -- Lote 6 · M27: la condición era «queda otra fecha `scheduled`», y cancelar
  -- la ÚLTIMA fecha de un ciclo ya empezado no avisaba (las dadas no son
  -- `scheduled`). Ahora basta con otra fecha NO cancelada, dada o pendiente.
  -- Cancelar la clase entera sigue sin mandar un correo por fecha:
  -- cancelar_clase_grupal solo deja hacerlo antes de empezar y marca todas en
  -- un único UPDATE, y los triggers AFTER ROW corren al final de la sentencia,
  -- con todas ya canceladas.
  if old.status = 'scheduled' and new.status = 'cancelled' and exists (
       select 1 from public.group_classes g
        where g.product_id = new.product_id and g.id <> new.id and g.status <> 'cancelled')
  then
    for v_b in
      select b.id, b.student_id from public.bookings b
       where b.product_id = new.product_id and b.status in ('confirmed', 'in_progress')
    loop
      perform public.enqueue_notification(v_b.student_id, 'NTF-55', 'email', 'group_cancelled',
        jsonb_build_object('booking_id', v_b.id, 'product_id', new.product_id, 'group_class_id', new.id,
                           'fecha', old.start_at, 'para', 'alumno', 'motivo', new.cancel_reason,
                           'clase', v_clase,
                           -- M27 · si era la última pendiente, el correo no puede
                           -- decir «el resto del ciclo sigue igual».
                           'quedan_fechas', exists (
                             select 1 from public.group_classes g
                              where g.product_id = new.product_id and g.id <> new.id
                                and g.status = 'scheduled')),
        'NTF-55:group_class:' || new.id || ':' || v_b.student_id);
    end loop;
  end if;
  return new;
end;
$$;

comment on function public.avisar_cambio_de_fecha_grupal() is
  'G4 · NTF-54 a cada inscrito cuando el tutor reagenda una fecha (RG-11) y NTF-55 cuando cancela UNA fecha de un ciclo (RG-16) mientras quede otra fecha no cancelada, dada o pendiente (Lote 6 · M27: antes exigía otra `scheduled` y la última fecha de un ciclo empezado no avisaba). La clase entera cancelada no pasa por aquí: notify_booking avisa una vez por alumno. Los payloads llevan `clase`.';

revoke execute on function public.avisar_cambio_de_fecha_grupal() from public, anon, authenticated;
-- El trigger `group_classes_avisos` se deja como está: misma función, mismo nombre.


-- ── 4 · cancelar_clase_grupal (M20 + P39) ───────────────────────────────────
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
  select p.id, p.tutor_id, p.pricing_model, p.title into v_prod
    from public.products p where p.id = p_product for update;
  -- Sin motivo escrito, el de por defecto no puede culpar al tutor si la
  -- canceló el equipo: lo leen los alumnos en el correo y en su reserva.
  if v_uid is distinct from v_prod.tutor_id and nullif(trim(p_motivo), '') is null then
    v_motivo := 'El equipo de Enséñame Ya canceló la clase grupal';
  end if;

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
  -- Lote 6 · P39: notify_booking lee esto para decirle al alumno que cayó la
  -- CLASE (alcance = 'clase') y no solo su cupo.
  perform set_config('ey.cancelando_clase', p_product::text, true);

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
  perform set_config('ey.cancelando_clase', '', true);

  update public.group_classes
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_motivo
   where product_id = p_product and status = 'scheduled';

  -- Lote 6 · M20: el aviso al TUTOR sale de aquí y no de notify_booking, que
  -- solo corre si había reservas que cancelar: sin alumnos pagados la clase se
  -- cancelaba sola y nadie se enteraba.
  if v_motivo = 'No se alcanzó el cupo mínimo de la clase' then
    -- MISMA clave que encola notify_booking: con alumnos pagados no se duplica
    -- y sin ellos, al menos llega.
    perform public.enqueue_notification(v_prod.tutor_id, 'NTF-53', 'email', 'group_min_cancelled',
      jsonb_build_object('product_id', p_product, 'para', 'tutor', 'clase', v_prod.title),
      'NTF-53:product:' || p_product || ':' || v_prod.tutor_id);
  elsif v_uid is distinct from v_prod.tutor_id then
    -- La canceló el admin. Si fue el propio tutor, no se le avisa: lo hizo él.
    perform public.enqueue_notification(v_prod.tutor_id, 'NTF-55', 'email', 'group_cancelled',
      jsonb_build_object('product_id', p_product, 'para', 'tutor', 'alcance', 'clase',
                         -- Solo el motivo ESCRITO: el de por defecto repetiría
                         -- el título del correo.
                         'clase', v_prod.title, 'motivo', nullif(trim(p_motivo), '')),
      'NTF-55:product:' || p_product || ':tutor');
  end if;

  -- Sale del catálogo y no se puede volver a publicar (publicar_clase_grupal
  -- exige que no tenga fechas): una clase nueva es un producto nuevo.
  update public.products set status = 'archived' where id = p_product;

  return v_n;
end;
$$;

comment on function public.cancelar_clase_grupal(uuid, text) is
  'RG-10 · el tutor o el admin cancela una clase grupal que aún no empezó: cancel_booking como parte tutor (100 %) en cada reserva viva, fechas a cancelled y producto archivado. Devuelve cuántas reservas canceló. Lote 6: marca ey.cancelando_clase durante el bucle (NTF-55 al alumno con alcance = clase, P39) y avisa al TUTOR ella misma (M20): NTF-53 si fue por el mínimo (misma clave que notify_booking, llega aunque no hubiera pagados) o NTF-55 si la canceló el admin; si la canceló él, nada.';

revoke execute on function public.cancelar_clase_grupal(uuid, text) from public, anon;
grant  execute on function public.cancelar_clase_grupal(uuid, text) to authenticated;


-- ── 5 · pending_email_notifications (A9 + P40 + M20) ────────────────────────
-- Misma firma y mismo `returns table`: solo cambia el contenido del jsonb
-- `contexto`, así que basta con el replace.
create or replace function public.pending_email_notifications(p_limit int default 50)
returns table (
  id       uuid,
  type     text,
  template text,
  payload  jsonb,
  email    text,
  nombre   text,
  timezone text,
  contexto jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  -- El lote se acota ANTES de resolver nada: los laterales de abajo se ejecutan
  -- sobre 50 filas, no sobre la cola entera.
  with lote as (
    select n.id, n.type, n.template, n.payload, n.recipient_id, n.created_at
      from public.notifications n
     where n.status  = 'pending'
       and n.channel = 'email'
     order by n.created_at        -- lo más viejo primero: nadie se queda atrás
     limit greatest(1, least(p_limit, 200))
  )
  select
    l.id,
    l.type,
    l.template,
    l.payload,

    -- ⚠️ EL CORREO DEL PAYLOAD MANDA SOBRE EL DE `auth.users`, y el join a auth
    -- pasa a LEFT por lo mismo. El aviso de baja de cuenta se encola DESPUÉS de
    -- que `anonymize_account` haya reescrito `auth.users.email` a
    -- `cuenta-eliminada+<uuid>@ensenameya.invalid`: leyendo auth mandaríamos el
    -- «tu cuenta está borrada» a una dirección que no existe, que es justo el
    -- único correo que esa persona todavía tiene que recibir. Quien encola una
    -- baja pone la dirección real en el payload; los demás no ponen nada y
    -- siguen saliendo de auth.
    coalesce(nullif(l.payload->>'email', ''), u.email::text),

    coalesce(pf.full_name, ''),

    -- RN-35: la hora se pinta en el huso del DESTINATARIO. Un recordatorio en la
    -- hora del servidor es un no-show.
    coalesce(nullif(pf.timezone, ''), 'UTC'),

    -- ── el contexto ───────────────────────────────────────────────────────
    -- `jsonb_strip_nulls` es el contrato: una clave que no se pudo resolver
    -- DESAPARECE. Nunca null, nunca cadena vacía — las plantillas se apoyan en
    -- eso para caerse bloque a bloque en vez de pintar «Cuándo: undefined».
    jsonb_strip_nulls(jsonb_build_object(
      -- Lote 6 · M20: un aviso SIN reserva (el NTF-53/55 al tutor que encola
      -- cancelar_clase_grupal) resuelve la clase por su `product_id`.
      'clase',        coalesce(bk.clase, gp.clase),
      'tutor',        bk.tutor,
      'alumno',       bk.alumno,
      'inicio',       coalesce(bk.inicio, gp.inicio),
      'duracion_min', bk.duracion_min,
      'importe',      bk.importe,
      'moneda',       coalesce(bk.moneda, po.moneda, od.moneda),
      'neto_tutor',   bk.neto_tutor,
      'limite',       bk.limite,
      'sesion_id',    bk.sesion_id,
      -- Lote 6 · P40: todas las fechas vivas de la reserva, en orden.
      'fechas',       bk.fechas,
      'tutor_id',     coalesce(bk.tutor_id, rv.tutor_id, gp.tutor_id),
      'product_id',   coalesce(bk.product_id, gp.product_id),
      'reembolso',    bk.reembolso,

      -- Los cuatro últimos de la cuenta de cobro del tutor. Solo tiene sentido
      -- si el destinatario ES el tutor, y lo es en los dos únicos correos que lo
      -- pintan (liquidación pagada y cambio de datos de cobro).
      -- ⚠️ Se calla cuando el payout salió por PayPal: ahí el dinero no fue a
      -- esa cuenta bancaria, y decirle «a tu cuenta ···· 4242» sería mentirle
      -- sobre dónde buscarlo.
      'cuenta',       case when po.provider = 'paypal' then null
                           else cta.bank_account_last4 end,

      -- El motivo del rechazo de KYC. Lo escribe el admin en la cola de
      -- aprobación; vacío = no hubo motivo y la plantilla pinta el cuerpo neutro.
      'motivo',       nullif(tpd.approval_notes, ''),

      'payout', case when po.id is null then null else jsonb_build_object(
        -- `payouts` no tiene referencia legible (sí la tiene `bookings`, y se
        -- llama `booking_ref`). Inventar aquí un «PO-1234» sería inventar algo
        -- que el tutor no puede buscar en ningún sitio, así que la clave no va y
        -- la plantilla se cae sola.
        'bruto',    po.bruto,
        'comision', po.comision,
        'neto',     po.neto,
        'moneda',   po.moneda,
        'sesiones', po.sesiones,
        'desde',    po.desde,
        'hasta',    po.hasta
      ) end,

      'pedido', case when od.total is null then null else jsonb_build_object(
        -- Ídem: `orders` no tiene `order_ref`. Sin clave, el recibo no pinta la
        -- línea «Pedido …» y sigue siendo un recibo correcto.
        'total',      od.total,
        'moneda',     od.moneda,
        'pendientes', od.pendientes,
        'lineas',     od.lineas
      ) end,

      'resena', case when rv.rating is null then null else jsonb_build_object(
        'rating',  rv.rating,
        'comment', nullif(rv.comment, ''),
        -- ⚠️ NULL = reseña anónima, y ahí se OMITE la clave: la plantilla pinta
        -- «Un alumno». Poner el nombre real sería publicar lo que el alumno
        -- decidió no firmar (decisión 18). La firma es un consentimiento.
        'autor',   nullif(rv.author_display, ''),
        'media',   rv.media,
        'total',   rv.total
      ) end

      -- `metodo` («Visa ···· 4242») NO SALE: hoy nadie guarda con qué tarjeta se
      -- cobró. `payments.provider_metadata` solo lleva el rastro del cobrador
      -- (quién cobró y cuándo se anotó), y `payment_methods` —que sí tiene marca
      -- y last4— es la lista de tarjetas guardadas de una persona, sin ningún
      -- vínculo con el pago concreto: elegir «la suya» sería adivinar cuál usó.
      --
      -- `cancelado_por` tampoco: `bookings.cancel_reason` es el texto libre que
      -- escribió quien canceló («motivo — detalle»), no un quién, y en las
      -- cancelaciones por vencimiento o desde admin es null. El dato existe
      -- dentro de `cancel_booking` (sabe si quien cancela es el tutor) pero no
      -- se persiste en ninguna columna.
    ))

  from lote l
  left join auth.users      u  on u.id  = l.recipient_id
  left join public.profiles pf on pf.id = l.recipient_id

  -- Los datos de cobro del destinatario: PK por tutor, una fila como mucho.
  left join public.tutor_payout_accounts cta on cta.tutor_id = l.recipient_id
  -- Y su ficha de tutor, de donde sale el motivo del rechazo de KYC.
  left join public.tutor_profiles        tpd on tpd.profile_id = l.recipient_id

  -- Los ids del payload, casteados UNA vez por notificación.
  cross join lateral (
    select public.uuid_o_nulo(l.payload->>'booking_id') as booking_id,
           public.uuid_o_nulo(l.payload->>'payout_id')  as payout_id,
           public.uuid_o_nulo(l.payload->>'order_id')   as order_id,
           public.uuid_o_nulo(l.payload->>'review_id')  as review_id,
           -- Lote 6 · A9: la fecha concreta de la que habla el aviso.
           public.uuid_o_nulo(l.payload->>'session_id') as session_id,
           -- Lote 6 · M20: la clase, para los avisos que no traen reserva.
           public.uuid_o_nulo(l.payload->>'product_id') as product_id,
           -- ⚠️ EL HUSO, COMPROBADO CONTRA EL CATÁLOGO. El desglose del pedido
           -- es el único sitio donde la BD tiene que formatear una fecha ella
           -- misma, y `at time zone <columna>` LEVANTA EXCEPCIÓN con un huso
           -- desconocido. `profiles.timezone` es texto libre que llega del
           -- navegador al registrarse: una sola fila con basura tumbaría la
           -- consulta que saca TODO el lote, o sea el correo entero de la
           -- pasada. Se mira solo cuando hay pedido, que es cuando hace falta.
           case
             when nullif(l.payload->>'order_id', '') is null then 'UTC'
             else coalesce((select tn.name
                              from pg_catalog.pg_timezone_names tn
                             where tn.name = pf.timezone),
                           'UTC')
           end as huso
  ) ids

  -- ── la reserva y todo lo que cuelga de ella ─────────────────────────────
  -- Un lateral y no una subconsulta por columna: así la reserva, la clase, las
  -- dos personas, la primera sesión y el pago se resuelven en UNA pasada por
  -- notificación en vez de en ocho.
  left join lateral (
    select pr.title                                as clase,
           pr.id                                   as product_id,
           -- El tutor se presenta como se presenta en su ficha; su nombre legal
           -- solo si no puso otro.
           coalesce(tp.display_name, tu.full_name) as tutor,
           b.tutor_id                              as tutor_id,
           al.full_name                            as alumno,
           b.session_duration_min                  as duracion_min,
           b.total_amount                          as importe,
           b.currency                              as moneda,
           -- Lo que se lleva el tutor por esta reserva. Va aparte de `importe`
           -- porque en sus correos enseñar lo que pagó el alumno sería enseñarle
           -- la comisión al revés.
           pmt.tutor_net_amount                     as neto_tutor,
           ses.id                                  as sesion_id,
           public.iso_utc(ses.start_at)            as inicio,
           -- RN-38: las 24 h de aceptación se cuentan desde que el dinero entró.
           -- Sin `paid_at` no hay plazo que contar y la clave desaparece.
           public.iso_utc(pmt.paid_at + interval '24 hours') as limite,
           -- El 0 se va con el `strip_nulls`: «te devolvimos 0» no es un aviso.
           nullif(pmt.refunded_amount, 0)           as reembolso,
           -- Lote 6 · P40: un ciclo tiene N fechas y la confirmación las enseña
           -- todas (y el .ics las lleva). Las canceladas no: ya no se dan.
           (select jsonb_agg(jsonb_build_object('sesion_id', s.id,
                                                'inicio',    public.iso_utc(s.start_at))
                             order by s.start_at)
              from public.sessions s
             where s.booking_id = b.id and s.status <> 'cancelled') as fechas
      from public.bookings b
      left join public.products       pr on pr.id = b.product_id
      left join public.profiles       tu on tu.id = b.tutor_id
      left join public.tutor_profiles tp on tp.profile_id = b.tutor_id
      left join public.profiles       al on al.id = b.student_id
      -- Un pago por reserva (`payments.booking_id` es único).
      left join public.payments       pmt on pmt.booking_id = b.id
      -- La sesión de la que habla el correo y la que enlaza el .ics.
      -- Lote 6 · A9: si el payload trae `session_id`, ESA (el recordatorio de
      -- la 2.ª fecha y su «Entrar a la sala» apuntaban a la 1.ª, ya cerrada);
      -- si no, la PRIMERA, como hasta hoy.
      left join lateral (
        select s.id, s.start_at
          from public.sessions s
         where s.booking_id = b.id
         order by (s.id = ids.session_id) desc nulls last, s.start_at
         limit 1
      ) ses on true
     where b.id = ids.booking_id
  ) bk on true

  -- ── la clase sin reserva (Lote 6 · M20) ─────────────────────────────────
  -- El aviso al tutor de una clase cancelada no cuelga de ninguna reserva (puede
  -- no haber ninguna). `inicio` es su primera fecha, canceladas incluidas: es la
  -- clase de la que se habla.
  left join lateral (
    select pr.title                         as clase,
           pr.id                            as product_id,
           pr.tutor_id                      as tutor_id,
           public.iso_utc(min(g.start_at))  as inicio
      from public.products pr
      left join public.group_classes g on g.product_id = pr.id
     where pr.id = ids.product_id
       and ids.booking_id is null
     group by pr.id
  ) gp on true

  -- ── la liquidación ──────────────────────────────────────────────────────
  left join lateral (
    select py.id,
           py.provider,
           py.currency     as moneda,
           -- `payouts.amount` ES el neto: se construye sumando
           -- `payments.tutor_net_amount` (ver `build_payout_for_tutor`).
           py.amount       as neto,
           it.bruto,
           it.comision,
           it.sesiones,
           it.desde,
           it.hasta
      from public.payouts py
      left join lateral (
        -- El desglose sale de los pagos que componen el lote, no de una cuenta
        -- aparte: `gross = platform_fee + tutor_net` por construcción, así que
        -- bruto − comisión cuadra con el neto y el correo no se contradice.
        select count(*)::int                   as sesiones,
               sum(pm.gross_amount)::bigint    as bruto,
               sum(pm.platform_fee_amount)::bigint as comision,
               -- El periodo es el de las clases IMPARTIDAS, no el de los cobros:
               -- el alumno pudo pagar meses antes.
               public.iso_utc(min(bo.completed_at)) as desde,
               public.iso_utc(max(bo.completed_at)) as hasta
          from public.payout_items pi
          join public.payments pm on pm.id = pi.payment_id
          join public.bookings bo on bo.id = pm.booking_id
         where pi.payout_id = py.id
      ) it on true
     where py.id = ids.payout_id
  ) po on true

  -- ── el pedido multi-línea ───────────────────────────────────────────────
  -- No hay tabla de líneas: las líneas SON las reservas con ese `order_id`.
  left join lateral (
    select o.currency                     as moneda,
           sum(b2.total_amount)::bigint   as total,
           (count(*) filter (where b2.status = 'pending_acceptance'))::int as pendientes,
           jsonb_agg(
             jsonb_build_object(
               'titulo',  pr2.title,
               -- «Ana Pérez · 15/09 18:00», ya montado. La fecha va NUMÉRICA a
               -- propósito: `to_char` con mes en letra depende del `lc_time` del
               -- servidor y escribiría «September» en un correo en español.
               'sub',     nullif(concat_ws(' · ',
                            coalesce(tp2.display_name, tu2.full_name),
                            to_char(ses2.start_at at time zone ids.huso, 'DD/MM HH24:MI')
                          ), ''),
               'importe', b2.total_amount,
               'moneda',  b2.currency
             )
             order by ses2.start_at nulls last, b2.created_at
           ) as lineas
      from public.orders o
      join public.bookings b2 on b2.order_id = o.id
      left join public.products       pr2 on pr2.id = b2.product_id
      left join public.profiles       tu2 on tu2.id = b2.tutor_id
      left join public.tutor_profiles tp2 on tp2.profile_id = b2.tutor_id
      left join lateral (
        select s2.start_at
          from public.sessions s2
         where s2.booking_id = b2.id
         order by s2.start_at
         limit 1
      ) ses2 on true
     where o.id = ids.order_id
     group by o.id, o.currency
  ) od on true

  -- ── la reseña ───────────────────────────────────────────────────────────
  left join lateral (
    select r.rating,
           r.comment,
           r.author_display,
           r.tutor_id,
           tpr.rating_avg   as media,
           tpr.rating_count as total
      from public.reviews r
      left join public.tutor_profiles tpr on tpr.profile_id = r.tutor_id
     where r.id = ids.review_id
  ) rv on true

  order by l.created_at;
$$;

comment on function public.pending_email_notifications(int) is
  'Doc 33: el lote de correo pendiente con TODO resuelto —dirección, huso del destinatario (RN-35) y el contexto que pintan las plantillas (clase, tutor, alumno, hora, importe, plazo de RN-38, liquidación, pedido y reseña)—. El contexto se resuelve aquí y no en los triggers por tres motivos: una consulta por lote en vez de un N+1, las filas ya encoladas salen completas sin backfill, y lo que se manda es lo que es verdad al ENVIAR y no al encolar. Las claves que no se pueden resolver desaparecen (jsonb_strip_nulls): la plantilla se cae bloque a bloque en vez de pintar un dato falso. El correo sale del payload antes que de auth.users porque la baja de cuenta se encola con auth.users.email ya anonimizado. Lote 6: `inicio`/`sesion_id` son los de payload.session_id cuando viene (A9; si no, la primera sesión); `fechas` trae todas las sesiones no canceladas de la reserva en orden (P40); un payload sin booking_id pero con product_id resuelve clase, primera fecha, product_id y tutor_id (M20).';

revoke execute on function public.pending_email_notifications(int) from public;
revoke execute on function public.pending_email_notifications(int) from anon;
revoke execute on function public.pending_email_notifications(int) from authenticated;
grant  execute on function public.pending_email_notifications(int) to service_role;


-- ── 6 · notify_payment (P14) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student  uuid;
  v_pedido   uuid;
  v_modelo   text;            -- Lote 6 · P14: una grupal no lleva NTF-04 aparte
  v_credito  bigint := coalesce(new.credit_amount, 0);
  v_efectivo bigint;          -- lo que de verdad pasó por la pasarela
  v_dev_cash bigint;          -- del acumulado devuelto, lo que vuelve a la tarjeta
begin
  if new.status is distinct from old.status
     or new.refunded_amount is distinct from old.refunded_amount then
    -- Alias explícito: la tabla trae ahora dos columnas del mismo `select` y
    -- sin él `student_id` a secas es ambiguo de leer, no de compilar.
    select b.student_id, b.order_id, b.pricing_model into v_student, v_pedido, v_modelo
      from public.bookings b where b.id = new.booking_id;

    v_efectivo := new.gross_amount - v_credito;

    -- Lote 6 · P14: en una grupal el recibo va DENTRO de NTF-56
    -- (group_enrolled_student, que lleva amount y currency): dos avisos por una
    -- inscripción («tu pago se registró» + «tu inscripción quedó confirmada»)
    -- era uno de más. Reembolsos y fallos no cambian.
    if new.status = 'paid' and old.status <> 'paid' and v_pedido is null
       and v_modelo is distinct from 'group' then
      -- Compra suelta: este ES el recibo. Si la reserva va en un pedido, el
      -- recibo lo manda confirm_order_payment con el total (NTF-04b).
      --
      -- `amount` = LO QUE SE COBRÓ. `gross_amount` y `credit_amount` van al lado
      -- para que el recibo pueda decir «1200, de los que 1200 los puso tu
      -- regalo» en vez de callárselo.
      perform public.enqueue_notification(v_student, 'NTF-04', 'email', 'payment_receipt',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'amount', v_efectivo, 'currency', new.currency,
                           'gross_amount', new.gross_amount,
                           'credit_amount', v_credito),
        'NTF-04:payment:' || new.id);
    elsif new.status in ('refunded', 'partially_refunded') then
      -- El tramo en efectivo del acumulado, con LA MISMA fórmula acumulada que
      -- usa `reembolsar_con_credito` (y por eso cuadra con lo que se encoló):
      -- `round(devuelto * efectivo / gross)`. Sin crédito da `refunded_amount`
      -- exacto, que es lo que este aviso decía hasta hoy.
      if v_credito = 0 or new.gross_amount = 0 then
        v_dev_cash := new.refunded_amount;
      else
        v_dev_cash := round(new.refunded_amount::numeric * v_efectivo / new.gross_amount);
      end if;

      -- Clave incluye el acumulado reembolsado → parcial y total avisan una vez
      -- cada uno. `refunded` es lo que vuelve A LA TARJETA; `refunded_credit` lo
      -- que vuelve al saldo y `refunded_total` el precio acordado.
      perform public.enqueue_notification(v_student, 'NTF-10', 'email', 'refund_processed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'refunded', v_dev_cash, 'currency', new.currency,
                           'refunded_credit', new.refunded_amount - v_dev_cash,
                           'refunded_total', new.refunded_amount),
        'NTF-10:payment:' || new.id || ':' || new.refunded_amount);
    elsif new.status = 'failed' then
      perform public.enqueue_notification(v_student, 'NTF-15', 'email', 'payment_failed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id),
        'NTF-15:payment:' || new.id);
    end if;
  end if;
  return new;
end;
$function$;

comment on function public.notify_payment() is
  'Trigger de avisos de payments (NTF-04 recibo, NTF-10 reembolso, NTF-15 fallo). Desde los créditos los dos primeros dicen la verdad sobre el dinero: `amount` es lo que cobró la pasarela (gross - credit_amount), no el precio, y `refunded` es lo que vuelve a la tarjeta, no el acumulado. Un canje 100 % crédito mandaba un recibo por dinero que el alumno no pagó. Las claves viejas conservan su nombre con el valor corregido; gross_amount, credit_amount, refunded_credit y refunded_total son aditivas. Lote 6 · P14: una reserva GRUPAL suelta no lleva NTF-04: su recibo va dentro de NTF-56 (group_enrolled_student, con amount y currency), que encola notify_booking.';


-- ── 7 · session_bootstrap (A3) ──────────────────────────────────────────────
create or replace function public.session_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'roles', coalesce(
      (select jsonb_agg(ur.role) from public.user_roles ur
        where ur.user_id = (select auth.uid())),
      '[]'::jsonb),
    'profile', (
      select to_jsonb(p) from (
        select onboarding_complete, full_name, avatar_path, timezone
          from public.profiles where id = (select auth.uid())
      ) p),
    'notices', coalesce(
      (select jsonb_agg(n order by n.created_at desc) from (
        select id, type, template, payload, created_at, read_at
          from public.notifications
          where recipient_id = (select auth.uid())
            -- EY-224: lo CADUCADO por `caducar_notificaciones()` no se enseña
            -- en ninguna de las tres puertas de la campana. Solo eso: un
            -- `failed` porque el proveedor rechazó el correo sigue saliendo,
            -- que el in-app es justo el canal que no falló. Misma lista de
            -- plantillas que esa función (`PLANTILLAS_CADUCABLES` en TS).
            and not (status = 'failed'::public.notification_status
                     and template in ('session_starting', 'booking_reminder_24h'))
          order by created_at desc
          limit 8
      ) n),
      '[]'::jsonb),
    -- Lote 6 · A3: el contador de la campana, con un count aparte. Sacado de
    -- los 8 avisos de arriba nunca pasaba de 8 y el «9+» era inalcanzable.
    -- Mismo filtro que `notices` (FILTRO_AVISOS_VISIBLES en TS).
    'notices_unread', (
      select count(*)::int
        from public.notifications
       where recipient_id = (select auth.uid())
         and read_at is null
         and not (status = 'failed'::public.notification_status
                  and template in ('session_starting', 'booking_reminder_24h')))
  );
$$;

comment on function public.session_bootstrap() is
  'Roles + perfil + avisos del usuario en sesión, en una sola llamada. '
  'security invoker: la RLS de las tres tablas sigue mandando. '
  'EY-224: los avisos excluyen lo caducado por caducar_notificaciones() (failed en session_starting / booking_reminder_24h), igual que listNotices() y la campana; un failed por rechazo del correo sí se enseña. '
  'Lote 6 · A3: notices_unread cuenta TODOS los no leídos visibles (mismo filtro), no solo los 8 de notices.';

grant execute on function public.session_bootstrap() to authenticated;
