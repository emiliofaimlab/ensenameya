-- EY-220 · Pedir la reseña al ALUMNO en un pop-up al colgar la llamada.
--
-- ── El problema ─────────────────────────────────────────────────────────────
-- `submit_review` (20260729150000) exige `bookings.status = 'completed'`. Pero
-- al colgar la reserva casi nunca lo está todavía: la pasa a `completed`
-- `close_expired_sessions()` (pg_cron cada 5 min, y solo cuando
-- `now() > upper(session_live_window())` = fin + 10 min), o el tutor con
-- «Marcar completada». O sea que el pop-up que sale al colgar en los últimos
-- 10 minutos —o justo al acabar— fallaría con «solo puedes reseñar una reserva
-- completada» durante 10-25 minutos.
--
-- ── El cambio, mínimo ───────────────────────────────────────────────────────
-- Se acepta también una reserva `in_progress` cuya ÚLTIMA clase ya está en su
-- tramo final, con la misma regla que decide el pop-up (decidida con el
-- cliente): ninguna sesión queda `scheduled`, ninguna `in_progress` le faltan
-- más de 10 min para acabar, y al menos una se llegó a dar (`in_progress` /
-- `completed`, o sea que alguien entró: `join_session` es quien la mueve).
--
-- Lo que NO cambia: solo el ALUMNO de esa reserva (`student_id = auth.uid()`),
-- una por reserva (`on conflict (booking_id)`), nota de 1 a 5, firma enmascarada
-- en servidor. En un paquete, la sesión 2 sigue `scheduled` mientras se da la 1,
-- así que el paquete solo se reseña tras la ÚLTIMA. Y una reserva `in_progress`
-- con la clase en marcha sigue rechazada antes de los últimos 10 min.
--
-- Por qué no cae en un hueco: `in_progress` solo se alcanza por `join_session`
-- dentro de `session_live_window()`, y una sesión `in_progress` la cierra el
-- cron SIEMPRE como `completed` (nunca `no_show`), así que la reserva acabará
-- `completed` igual. La reseña se adelanta unos minutos al cron, nada más.
--
-- Firma idéntica → `create or replace` es correcto (la regla de oro 12 es para
-- cambiar ARGUMENTOS) y el `grant execute` de 20260729150000 se conserva.
-- Mismo criterio en TS: `src/lib/resena.ts` (`reservaResenable`). Si se toca
-- uno, se toca el otro.

create or replace function public.submit_review(
  p_booking_id uuid,
  p_rating     smallint,
  p_comment    text default null,
  p_sign       boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_booking record;
  v_review  uuid;
  v_author  text;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'la puntuación debe ir de 1 a 5' using errcode = 'check_violation';
  end if;

  -- La reserva debe ser del alumno. Los campos denormalizados salen de aquí,
  -- no del cliente.
  select b.id, b.student_id, b.tutor_id, b.product_id, b.status
    into v_booking
  from public.bookings b
  where b.id = p_booking_id and b.student_id = v_uid;
  if v_booking.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- RN-17 + EY-220: completada, o con su última clase ya en el tramo final.
  if not (
    v_booking.status = 'completed'
    or (
      v_booking.status = 'in_progress'
      and not exists (
        select 1 from public.sessions s
         where s.booking_id = p_booking_id
           and (
             s.status = 'scheduled'
             or (s.status = 'in_progress' and now() < s.end_at - interval '10 minutes')
           )
      )
      and exists (
        select 1 from public.sessions s
         where s.booking_id = p_booking_id
           and s.status in ('in_progress', 'completed')
      )
    )
  ) then
    raise exception 'solo puedes reseñar una reserva completada' using errcode = 'check_violation';
  end if;

  -- El nombre se enmascara AQUÍ, no en el cliente: así lo que se publica no
  -- depende de lo que mande el navegador. Sin consentimiento, nulo.
  if p_sign then
    select public.mask_person_name(p.full_name) into v_author
    from public.profiles p where p.id = v_uid;
  end if;

  -- Upsert por reserva (RN-17: una sola). Re-enviar edita la existente, y
  -- retirar el consentimiento borra la firma.
  insert into public.reviews (booking_id, student_id, tutor_id, product_id, rating, comment, author_display)
  values (p_booking_id, v_uid, v_booking.tutor_id, v_booking.product_id, p_rating,
          nullif(btrim(p_comment), ''), v_author)
  on conflict (booking_id) do update
     set rating = excluded.rating,
         comment = excluded.comment,
         author_display = excluded.author_display
  returning id into v_review;

  return v_review;
end;
$$;

comment on function public.submit_review(uuid, smallint, text, boolean) is
  'US-901/RN-17 · el alumno reseña SU reserva, una vez (upsert por booking_id). EY-220: además de completed, acepta in_progress cuando no queda ninguna sesión scheduled, ninguna in_progress a más de 10 min de su fin y al menos una se dio — el pop-up al colgar llega antes que close_expired_sessions(). Espejo en TS: src/lib/resena.ts.';

-- Se repite el grant por si acaso: `create or replace` lo conserva, pero esta
-- línea deja la migración autosuficiente.
grant execute on function public.submit_review(uuid, smallint, text, boolean) to authenticated;
