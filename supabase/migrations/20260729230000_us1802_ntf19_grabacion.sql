-- ============================================================================
-- US-1802 · NTF-19 "grabación disponible" (EP-18, Doc 7)
--
-- El fichero vive en Daily y no se sincroniza a ninguna tabla nuestra (la
-- pantalla lo pide al proveedor al hacer clic), así que **no hay evento de "ya
-- está subida" al que engancharse**. El aviso se manda cuando la sesión se
-- completa Y los dos habían consentido: es el momento en que el usuario puede
-- esperar una grabación, que es de lo que informa la notificación.
--
-- Sin consentimiento no se encola nada — anunciar una grabación que RN-42
-- prohibió sería peor que no avisar.
-- ============================================================================

create or replace function public.notify_recording()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and public.recording_allowed(new.id)
  then
    -- A los dos: la grabación es de la clase, no de uno de ellos.
    perform public.enqueue_notification(new.student_id, 'NTF-19', 'email', 'recording_ready',
      jsonb_build_object('booking_id', new.booking_id, 'session_id', new.id),
      'NTF-19:session:' || new.id || ':student');
    perform public.enqueue_notification(new.tutor_id, 'NTF-19', 'email', 'recording_ready',
      jsonb_build_object('booking_id', new.booking_id, 'session_id', new.id),
      'NTF-19:session:' || new.id || ':tutor');
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_on_recording on public.sessions;
create trigger notifications_on_recording
  after update on public.sessions
  for each row execute function public.notify_recording();
