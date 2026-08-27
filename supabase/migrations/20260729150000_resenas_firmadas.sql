-- ============================================================================
-- Reseñas firmadas con consentimiento (decisión 18 del cliente, 24-jul · EP-09)
--
-- Hoy las reseñas son anónimas de verdad: el perfil del tutor es público (lo
-- lee `anon`) y `profiles` está cerrado por RLS, así que no había forma de
-- firmarlas sin abrir la tabla a todo el mundo. El cliente pidió "nombre +
-- inicial", pero **con consentimiento**, y anónimas hasta tenerlo.
--
-- Se resuelve como DD-01: una copia PÚBLICA de lo que el alumno decide
-- publicar, escrita por la RPC que ya corre como SECURITY DEFINER. `profiles`
-- no se abre a nadie y la consulta pública deja de tocarla.
--
-- La columna es el consentimiento: si hay nombre, es que lo dio. Un booleano
-- aparte sería un segundo estado que puede contradecir al primero.
-- ============================================================================

alter table public.reviews
  add column if not exists author_display text;

comment on column public.reviews.author_display is
  'Nombre enmascarado ("Marina G.") copiado al reseñar SOLO si el alumno consintió firmar. Nulo = reseña anónima.';

-- ── La regla de enmascarado, en un sitio ────────────────────────────────────
-- Estaba escrita dentro de `home_testimonials`; ahora la comparten la home y
-- las reseñas del perfil, y se puede cambiar en un solo lugar.
create or replace function public.mask_person_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    split_part(btrim(coalesce(p_name, '')), ' ', 1) ||
    case
      when split_part(btrim(coalesce(p_name, '')), ' ', 2) <> ''
        then ' ' || left(split_part(btrim(coalesce(p_name, '')), ' ', 2), 1) || '.'
      else ''
    end,
    '');
$$;

grant execute on function public.mask_person_name(text) to anon, authenticated;

-- ── US-901 v2: la reseña puede ir firmada ───────────────────────────────────
drop function if exists public.submit_review(uuid, smallint, text);

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

  -- La reserva debe ser del alumno y estar COMPLETADA (RN-17). Los campos
  -- denormalizados salen de aquí, no del cliente.
  select b.id, b.student_id, b.tutor_id, b.product_id, b.status
    into v_booking
  from public.bookings b
  where b.id = p_booking_id and b.student_id = v_uid;
  if v_booking.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;
  if v_booking.status <> 'completed' then
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

grant execute on function public.submit_review(uuid, smallint, text, boolean) to authenticated;

-- ── Los testimonios de la home pasan por el mismo consentimiento ────────────
-- Antes firmaban con `profiles.full_name` de cualquier alumno, sin haberlo
-- preguntado. Ahora sale el nombre solo si la reseña está firmada, y de paso la
-- función deja de leer `profiles`.
create or replace function public.home_testimonials(p_limit integer default 7)
returns table (
  id      uuid,
  comment text,
  rating  smallint,
  author  text,
  context text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.comment,
         r.rating,
         coalesce(r.author_display, 'Alumno') as author,
         pr.title as context
    from public.reviews r
    join public.products pr on pr.id = r.product_id
   where r.comment is not null
     and length(btrim(r.comment)) > 0
     and r.rating >= 4                    -- testimonios, no reseñas a secas
   order by r.created_at desc
   limit greatest(1, least(p_limit, 20));
$$;

grant execute on function public.home_testimonials(integer) to anon, authenticated;
