-- ============================================================================
-- Enséñame Ya — EP-09: reseñas. US-901 (dejar) + US-902 (ver).
-- RN-17: una reseña POR RESERVA, una sola vez, y solo cuando el servicio está
-- COMPLETO (booking = completed). El alumno puntúa 1–5 y comenta.
--
-- La escritura va por RPC `submit_review` (patrón del proyecto): así los campos
-- denormalizados (tutor_id, product_id) se DERIVAN de la reserva y el alumno no
-- puede falsear a quién reseña ni a qué producto — un `insert` directo con
-- column-grants dejaría ese hueco. RLS solo abre la LECTURA (pública: las
-- reseñas se ven en el perfil del tutor) y bloquea la escritura de cliente.
--
-- `tutor_profiles.rating_avg/rating_count` (creados vacíos en EP-03) los
-- mantiene un trigger; están fuera de los column-grants del tutor (US-1403).
-- ============================================================================

create table public.reviews (
  id         uuid        primary key default gen_random_uuid(),
  booking_id uuid        not null unique references public.bookings (id) on delete cascade,  -- RN-17: 1 por compra
  student_id uuid        not null references public.profiles (id) on delete cascade,
  tutor_id   uuid        not null references public.profiles (id) on delete cascade,          -- denormalizado
  product_id uuid        not null references public.products (id) on delete cascade,
  rating     smallint    not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_tutor_id_idx   on public.reviews (tutor_id);
create index reviews_product_id_idx on public.reviews (product_id);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ── Rating del tutor = agregado de sus reseñas (trigger) ────────────────────
create or replace function public.refresh_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor uuid := case when tg_op = 'DELETE' then old.tutor_id else new.tutor_id end;
begin
  update public.tutor_profiles tp
     set rating_avg   = (select round(avg(r.rating), 2) from public.reviews r where r.tutor_id = v_tutor),
         rating_count = (select count(*)                from public.reviews r where r.tutor_id = v_tutor)
   where tp.profile_id = v_tutor;
  return coalesce(new, old);
end;
$$;

create trigger reviews_refresh_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_tutor_rating();

-- ── RLS: lectura pública; escritura solo por RPC ────────────────────────────
alter table public.reviews enable row level security;

-- Las reseñas son públicas (se muestran en el perfil del tutor, US-902).
create policy "reviews_select_public"
  on public.reviews for select
  using ( true );

-- Sin políticas de insert/update/delete: default-deny. La escritura la hace
-- `submit_review` (SECURITY DEFINER). Lectura pública → anon también.
grant select on public.reviews to anon, authenticated;

-- ── US-901: dejar / editar reseña ───────────────────────────────────────────
create or replace function public.submit_review(
  p_booking_id uuid,
  p_rating     smallint,
  p_comment    text default null
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

  -- Upsert por reserva (RN-17: una sola). Re-enviar edita la existente.
  insert into public.reviews (booking_id, student_id, tutor_id, product_id, rating, comment)
  values (p_booking_id, v_uid, v_booking.tutor_id, v_booking.product_id, p_rating, nullif(btrim(p_comment), ''))
  on conflict (booking_id) do update
     set rating = excluded.rating, comment = excluded.comment
  returning id into v_review;

  return v_review;
end;
$$;

grant execute on function public.submit_review(uuid, smallint, text) to authenticated;
