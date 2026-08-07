-- ============================================================================
-- Enséñame Ya — NTF-07 avisa al tutor CUANDO HAY QUE ACTUAR, no después
-- (EP-12 · RN-38 · Doc 7)
--
-- El trigger encolaba "Tienes una reserva nueva por aceptar" en la transición a
-- `confirmed`. Pero `confirmed` es el estado al que se llega DESPUÉS de que el
-- tutor acepte: el aviso que le concede 24 horas para responder le llegaba una
-- vez que ya había respondido. El único caso en que servía de algo era el del
-- tutor con auto-aceptar, que es justamente el que no necesita que le avisen.
--
-- Salió al probar el envío real (US-1201): una reserva de prueba encoló el
-- recibo del alumno y ningún aviso al tutor, con la reserva esperándole en
-- `pending_acceptance`. Con el stub marcando todo como enviado, este agujero era
-- invisible — no hay forma de notar que falta un correo que nunca se manda.
--
-- Se añade la rama que faltaba y NO se quita la de `confirmed`: el tutor con
-- auto-aceptar sigue enterándose de que tiene clase. No hay riesgo de duplicado
-- porque la clave de idempotencia es la misma (`NTF-07:booking:<id>`) y
-- `enqueue_notification` hace `on conflict do nothing` (US-1202) — la reserva
-- que pasa por los dos estados encola una vez, en el primero.
--
-- RN-38: si el tutor no responde en 24 h, `expire_stale_bookings` cancela y
-- reembolsa el 100%. Ese plazo solo es justo si al tutor se le avisó al empezar.
-- ============================================================================

create or replace function public.notify_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    -- La reserva está pagada y esperando al tutor: es AHORA cuando hay que
    -- avisarle, con las 24 h por delante y no ya gastadas.
    if new.status = 'pending_acceptance' then
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);

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
$$;
