-- ============================================================================
-- Enséñame Ya — SEED DEMO de reseñas (EP-09). ⚠️  SOLO DEV — NO aplicar a prod.
-- EY-118.
--
-- Por qué existe: `ep03-demo.sql` escribió `tutor_profiles.rating_avg` y
-- `rating_count` a mano (4.9/37, 4.7/21, 4.8/52) SIN insertar filas en
-- `reviews`. Resultado: la UI se contradecía sola — el perfil del tutor
-- anunciaba "★ 4.9 · 37 reseñas" y dos pantallas más abajo decía "este tutor
-- aún no tiene reseñas".
--
-- Aquí se hace al revés, como en producción: se insertan reservas COMPLETADAS
-- y sus reseñas, y **el trigger `reviews_refresh_rating` calcula el rating**.
-- Así el seed ejercita el mismo camino que el código real (RN-17: una reseña
-- por reserva, solo si la reserva está `completed`).
--
-- Depende de: supabase/seed/ep03-demo.sql (tutores y productos demo).
--
-- Aplicar SOLO al proyecto dev — desde el SQL Editor de Supabase (dev) o:
--   psql "<connection string de DEV>" -f supabase/seed/ep09-demo-reviews.sql
--
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================================

-- ── 1. Alumnos demo ─────────────────────────────────────────────────────────
-- Mismo patrón que ep03-demo: no inician sesión (encrypted_password NULL), son
-- solo el autor de las reseñas. El trigger handle_new_user crea su `profiles`.
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change)
values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alumna.demo1@ensenameya.test', null, now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Marina G."}'::jsonb, now(), now(), '', '', ''),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alumno.demo2@ensenameya.test', null, now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Julián P."}'::jsonb, now(), now(), '', '', ''),
  ('c0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alumna.demo3@ensenameya.test', null, now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Rocío V."}'::jsonb, now(), now(), '', '', '')
on conflict (id) do nothing;

-- ── 2. Reservas COMPLETADAS ─────────────────────────────────────────────────
-- Snapshots financieros a mano porque aquí no pasa por `create_booking`: es un
-- seed que corre como superusuario, no el flujo de cliente. Los valores imitan
-- los del producto correspondiente (RN-12 / S-08).
insert into public.bookings
  (id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
   session_duration_min, currency, subtotal_amount, total_amount,
   tier_split_pct, completed_at, created_at)
values
  -- Cálculo I sin sufrir (per_session, 1500 USD) — tutora 1
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'completed', 'per_session', 1, 60, 'USD', 1500, 1500, 75.00,
   now() - interval '14 days', now() - interval '21 days'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'completed', 'per_session', 1, 60, 'USD', 1500, 1500, 75.00,
   now() - interval '5 days', now() - interval '10 days'),
  -- Tu primera app web (per_package, 12000 USD, 8 sesiones) — tutor 2
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'completed', 'per_package', 8, 90, 'USD', 12000, 12000, 75.00,
   now() - interval '30 days', now() - interval '60 days'),
  -- Inglés conversacional (per_hour, 1000 USD) — tutor 3
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'completed', 'per_hour', 1, 60, 'USD', 1000, 1000, 75.00,
   now() - interval '3 days', now() - interval '9 days'),
  ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'completed', 'per_hour', 1, 60, 'USD', 1000, 1000, 75.00,
   now() - interval '20 days', now() - interval '25 days')
on conflict (id) do nothing;

-- ── 3. Reseñas ──────────────────────────────────────────────────────────────
-- `tutor_id` y `product_id` se derivan de la reserva, igual que hace el RPC
-- `submit_review`, para que el seed no pueda inventar combinaciones imposibles.
insert into public.reviews
  (id, booking_id, student_id, tutor_id, product_id, rating, comment, created_at)
select
  gen_random_uuid(), b.id, b.student_id, b.tutor_id, b.product_id,
  v.rating, v.comment, b.completed_at + interval '1 day'
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 5,
   'Aprobé mi parcial de Cálculo después de 4 clases. Explicó justo lo que no entendía.'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 5,
   'Muchísima paciencia y ejemplos claros. Por fin entendí las integrales.'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 4,
   'Publiqué mi primera app de verdad. El seguimiento semana a semana marcó la diferencia.'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 5,
   'Practicar 1 a 1 me quitó el miedo a hablar. Pasé la entrevista en inglés.'),
  ('d0000000-0000-4000-8000-000000000005'::uuid, 4,
   'Clases dinámicas y adaptadas a mi nivel. Mejoré bastante la pronunciación.')
) as v(booking_id, rating, comment)
join public.bookings b on b.id = v.booking_id
on conflict (booking_id) do nothing;

-- ── 4. Recalcular el rating desde las reseñas ───────────────────────────────
-- El trigger ya actualizó a los 3 tutores con reseña. Este update limpia a
-- CUALQUIER otro tutor que siga arrastrando valores escritos a mano: sin él,
-- las tarjetas seguirían mostrando ratings que no existen.
update public.tutor_profiles tp
   set rating_avg   = agg.avg_rating,
       rating_count = agg.n
  from (
    select tp2.profile_id,
           (select round(avg(r.rating), 2) from public.reviews r where r.tutor_id = tp2.profile_id) as avg_rating,
           (select count(*)                from public.reviews r where r.tutor_id = tp2.profile_id) as n
      from public.tutor_profiles tp2
  ) as agg
 where tp.profile_id = agg.profile_id
   and (tp.rating_avg is distinct from agg.avg_rating
        or tp.rating_count is distinct from agg.n);

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Debe devolver una fila por tutor con `coinciden = true`.
select tp.headline,
       tp.rating_avg,
       tp.rating_count,
       count(r.id)                                as resenas_reales,
       tp.rating_count = count(r.id)              as coinciden
  from public.tutor_profiles tp
  left join public.reviews r on r.tutor_id = tp.profile_id
 group by tp.profile_id, tp.headline, tp.rating_avg, tp.rating_count
 order by tp.headline;
