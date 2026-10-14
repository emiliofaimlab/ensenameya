-- ============================================================================
-- Enséñame Ya — los avisos que faltaban de las clases grupales (G4, §12)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- NTF-51 y NTF-56 (inscripción) ya existían. Faltaban:
--   NTF-52 · al tutor, la clase se llenó.
--   NTF-53 · a todos, se canceló sola por no llegar al mínimo (RG-04).
--   NTF-54 · a los alumnos, el tutor cambió la hora de una fecha (RG-11).
--   NTF-55 · a los alumnos, se canceló la clase, una fecha del ciclo, o su
--            cupo lo canceló otro (tutor o admin), con el reembolso.
-- Sin esto, cancelar una clase de 8 inscritos le mandaba al tutor OCHO
-- «se canceló una reserva» (NTF-09) y a cada alumno el texto de una 1:1.
--
-- ── CÓMO ───────────────────────────────────────────────────────────────────
-- · Sin reescribir las RPC de cancelar y reagendar: NTF-52/53/55-de-cupo
--   salen de `notify_booking` (el trigger de bookings) y NTF-54/55-de-fecha
--   de un trigger nuevo en `group_classes`. Menos copias de cuerpos largos,
--   menos riesgo de pisar otra rama (§2 del plan).
-- · ¿Quién canceló el cupo? `auth.uid()` en el trigger: `cancelar_clase_grupal`
--   llama a `cancel_booking` con los claims del TUTOR, y el admin y el cron
--   también pasan por ahí. Si no es el propio alumno, es NTF-53 (motivo del
--   mínimo, el texto que pone `cancelar_grupales_sin_minimo`) o NTF-55. Un
--   hold que caduca (`pending_payment` → cancelled) sigue con NTF-09.
-- · «Otra fecha sigue programada» distingue cancelar UNA fecha de cancelar la
--   clase entera: `cancelar_clase_grupal` marca todas en un solo UPDATE y los
--   triggers AFTER ROW se disparan al final de la sentencia, con todas ya
--   cambiadas. Así cancelar la clase no manda un correo por fecha.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `notify_booking` REEMPLAZA a la viva de `20261013170000:137`; cambios
--   marcados «G4 ·».
-- · Plantillas: group_full_tutor, group_min_cancelled, group_rescheduled,
--   group_cancelled (en `src/lib/email-templates.ts`; `check:email` lo vigila).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
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
      perform public.enqueue_notification(new.student_id, 'NTF-56', 'email', 'group_enrolled_student',
        jsonb_build_object('booking_id', new.id), 'NTF-56:booking:' || new.id);
      perform public.enqueue_notification(new.tutor_id, 'NTF-51', 'email', 'group_enrolled_tutor',
        jsonb_build_object('booking_id', new.id, 'product_id', new.product_id), 'NTF-51:booking:' || new.id);
      -- G4 · NTF-52: el cupo que acaba de confirmarse era el último. Cuenta
      -- los holds en curso igual que el catálogo: «llena» es lo que ve el alumno.
      if public.cupos_libres(new.product_id) = 0 then
        perform public.enqueue_notification(new.tutor_id, 'NTF-52', 'email', 'group_full_tutor',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'tutor'),
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
          and (select auth.uid()) is distinct from new.student_id then
      -- G4 · el cupo lo canceló otro: el tutor (o el admin) al cancelar la
      -- clase o al sacarlo, o el cron del mínimo. Un aviso propio en vez de
      -- NTF-09, y al tutor nada por cupo: él lo hizo, o recibe NTF-53 una vez.
      if new.cancel_reason = 'No se alcanzó el cupo mínimo de la clase' then
        perform public.enqueue_notification(new.student_id, 'NTF-53', 'email', 'group_min_cancelled',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'alumno'),
          'NTF-53:product:' || new.product_id || ':' || new.student_id);
        perform public.enqueue_notification(new.tutor_id, 'NTF-53', 'email', 'group_min_cancelled',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'tutor'),
          'NTF-53:product:' || new.product_id || ':' || new.tutor_id);
      else
        perform public.enqueue_notification(new.student_id, 'NTF-55', 'email', 'group_cancelled',
          jsonb_build_object('booking_id', new.id, 'product_id', new.product_id, 'para', 'alumno',
                             'motivo', new.cancel_reason),
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
  'Avisos por cambio de estado de una reserva. 1:1: NTF-05/07/09/14/17b. Grupales (G3/G4): NTF-51/56 al inscribirse, NTF-52 al tutor si era el último cupo, y NTF-53 (mínimo) o NTF-55 cuando el cupo lo cancela otro que no es el alumno.';


-- ── NTF-54 / NTF-55 de fecha: el trigger de group_classes ──────────────────
create or replace function public.avisar_cambio_de_fecha_grupal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b record;
begin
  -- RG-11 · el tutor movió la hora de esta fecha.
  if new.rescheduled_at is not null and new.rescheduled_at is distinct from old.rescheduled_at then
    for v_b in
      select b.id, b.student_id from public.bookings b
       where b.product_id = new.product_id and b.status in ('confirmed', 'in_progress')
    loop
      perform public.enqueue_notification(v_b.student_id, 'NTF-54', 'email', 'group_rescheduled',
        jsonb_build_object('booking_id', v_b.id, 'product_id', new.product_id, 'group_class_id', new.id,
                           'nuevo_inicio', new.start_at, 'anterior', old.start_at, 'para', 'alumno'),
        'NTF-54:group_class:' || new.id || ':' || extract(epoch from new.rescheduled_at)::bigint
          || ':' || v_b.student_id);
    end loop;
  end if;

  -- RG-16 · se canceló UNA fecha del ciclo (quedan otras). La clase entera
  -- cancelada la avisa notify_booking, una vez por alumno.
  if old.status = 'scheduled' and new.status = 'cancelled' and exists (
       select 1 from public.group_classes g
        where g.product_id = new.product_id and g.status = 'scheduled')
  then
    for v_b in
      select b.id, b.student_id from public.bookings b
       where b.product_id = new.product_id and b.status in ('confirmed', 'in_progress')
    loop
      perform public.enqueue_notification(v_b.student_id, 'NTF-55', 'email', 'group_cancelled',
        jsonb_build_object('booking_id', v_b.id, 'product_id', new.product_id, 'group_class_id', new.id,
                           'fecha', old.start_at, 'para', 'alumno', 'motivo', new.cancel_reason),
        'NTF-55:group_class:' || new.id || ':' || v_b.student_id);
    end loop;
  end if;
  return new;
end;
$$;

comment on function public.avisar_cambio_de_fecha_grupal() is
  'G4 · NTF-54 a cada inscrito cuando el tutor reagenda una fecha (RG-11) y NTF-55 cuando cancela UNA fecha de un ciclo (RG-16). La clase entera cancelada no pasa por aquí: notify_booking avisa una vez por alumno.';

revoke execute on function public.avisar_cambio_de_fecha_grupal() from public, anon, authenticated;

drop trigger if exists group_classes_avisos on public.group_classes;
create trigger group_classes_avisos
  after update of start_at, status, rescheduled_at on public.group_classes
  for each row execute function public.avisar_cambio_de_fecha_grupal();
