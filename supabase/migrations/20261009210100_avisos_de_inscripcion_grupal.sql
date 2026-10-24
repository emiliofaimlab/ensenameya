-- ============================================================================
-- Enséñame Ya — avisos de inscripción de las clases grupales (NTF-51 / NTF-56)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2 y §12. Al confirmarse un cupo, la
-- reserva grupal mandaba los correos de la 1:1: al alumno «el tutor aceptó tu
-- reserva» (NTF-05) y al tutor «tienes 24 horas para aceptar» (NTF-07). En una
-- grupal no acepta nadie (RG-07). Ahora: NTF-56 al alumno y NTF-51 al tutor.
--
-- ⚠️ El plan dice que NTF-56 sustituye a «NTF-09»; en el código NTF-09 es la
-- CANCELACIÓN. Lo que se sustituye es la CONFIRMACIÓN (NTF-05), que es lo que
-- el plan describe.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · REEMPLAZA a la versión VIVA de dev (`pg_get_functiondef`, 9-oct; última
--   migración `20260911180000:249`). Una rama nueva marcada «G ·»; el resto,
--   igual.
-- · Plantillas `group_enrolled_student` y `group_enrolled_tutor` en
--   `src/lib/email-templates.ts`. Sin ellas el job de correo marcaría estos
--   avisos como fallo PERMANENTE; `npm run check:email` lo vigila leyendo esta
--   migración.
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
        jsonb_build_object('booking_id', new.id), 'NTF-51:booking:' || new.id);

    elsif new.status = 'confirmed' then
      perform public.enqueue_notification(new.student_id, 'NTF-05', 'email', 'booking_confirmed_student',
        jsonb_build_object('booking_id', new.id), 'NTF-05:booking:' || new.id);
      -- Se mantiene para el tutor con auto-aceptar, que nunca pasa por
      -- `pending_acceptance`. Si ya pasó, la clave repetida lo descarta.
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);

    elsif new.status = 'cancelled' then
      perform public.enqueue_notification(new.student_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id), 'NTF-09:booking:' || new.id || ':student');
      perform public.enqueue_notification(new.tutor_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id), 'NTF-09:booking:' || new.id || ':tutor');

    elsif new.status = 'completed' then
      -- NTF-14: al completar, invita a reseñar (RN-28).
      perform public.enqueue_notification(new.student_id, 'NTF-14', 'email', 'review_request',
        jsonb_build_object('booking_id', new.id), 'NTF-14:booking:' || new.id);
    end if;
  end if;
  return new;
end;
$function$;
