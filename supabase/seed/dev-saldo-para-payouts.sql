-- ============================================================================
-- Enséñame Ya · SEED DE DEV — tres tutores con saldo para probar /tutor/payouts
--
-- ⚠️ SOLO DEV. Escribe en `bookings`, `payments` y `payouts`, que son las tres
-- tablas de dinero: en producción esto no se ejecuta jamás (regla de oro 2 — el
-- dinero lo escriben las RPC y los webhooks, no una persona). Aquí vale porque
-- prod tiene cero tutores y este fichero no está en `migrations/`.
--
-- ── QUÉ MONTA, Y POR QUÉ ESTOS TRES PAÍSES ─────────────────────────────────
--
-- Los tres casos que pintan la pantalla DISTINTA, que es lo que hay que probar:
--
--   Lucía Ferrer   → Venezuela  {paypal, manual}
--                    4 tarjetas de identificador, sin banco. Ya tiene un Zinli
--                    registrado, así que se ve una «Completo» y tres sin datos.
--   Mateo Herrera  → Colombia   {stripe, wise, paypal}
--                    Las TRES familias a la vez: alta de Connect, transferencia
--                    bancaria (por Wise) y PayPal. Es el país que destapó que la
--                    pantalla solo pintaba una.
--   Sofía Marín    → España     fila POR DEFECTO {stripe, paypal, wise}
--                    El «resto del mundo». Sin fila propia en
--                    `payment_routing_rules` y sin fila en
--                    `payout_country_rules`, así que salen Stripe y PayPal y NO
--                    la tarjeta de banco — que es lo correcto: sin esa fila el
--                    formulario bancario no podría guardar.
--
-- ── Y EL PAÍS NO SE ESCRIBE: SE DEDUCE ─────────────────────────────────────
--
-- No hay ni un `update tutor_profiles set payout_country` aquí abajo, y no es
-- estilo: desde `20260908130000` esa columna no tiene `grant update` para nadie
-- y la mantiene el disparador de `profiles.timezone`. Poner la zona horaria ES
-- ponerles el país. Que el seed tenga que hacerlo así es la prueba de que el
-- camino nuevo es el único que queda.
--
-- Cada tutor recibe:
--   · 2 reservas completadas hace 20 y 12 días  → SALDO DISPONIBLE (retención
--     de 7 días vencida y sin `payout_items` que las consuma)
--   · 1 reserva completada hace 2 días          → EN RETENCIÓN
--   · 1 payout ya pagado                        → YA COBRADO
--
-- Reejecutable: ids fijos y `on conflict do nothing`.
-- ============================================================================

begin;

-- Los tres tutores y el alumno con el que se les reserva.
create temporary table _tutores on commit drop as
select * from (values
  ('lucia.ferrer@ensenameya.dev', 'America/Caracas', 1, 4500::bigint),
  ('mateo.herrera@ensenameya.dev','America/Bogota',  2, 6200::bigint),
  ('sofia.marin@ensenameya.dev',  'Europe/Madrid',   3, 8100::bigint)
) as t(email, tz, n, base);

-- 1 · La zona horaria. El disparador escribe `payout_country` por su cuenta.
update public.profiles p
   set timezone = t.tz
  from _tutores t
  join auth.users u on u.email = t.email
 where p.id = u.id;

-- 2 · Las reservas. `product_id` sale del catálogo real de cada tutor: la FK lo
--     exige y además así el nombre de la mentoría que se ve en pantalla es uno
--     que existe. `tier_split_pct` se copia del tier que tenga asignado — si se
--     escribiera 75 a mano, la ficha «Tu nivel» diría un reparto y las cifras
--     saldrían de otro.
insert into public.bookings (
  id, student_id, product_id, tutor_id, status, pricing_model, num_sessions,
  session_duration_min, currency, subtotal_amount, total_amount,
  tier_split_pct, payee_country, completed_at, created_at, updated_at
)
select
  ('77777777-0000-4000-8000-0000000000' || lpad((t.n * 10 + d.i)::text, 2, '0'))::uuid,
  (select p.id from public.profiles p
     join auth.users u on u.id = p.id
    where u.email = 'julian.prado@ensenameya.dev'),
  pr.id, pr.tutor_id, 'completed'::public.booking_status, pr.pricing_model, 1,
  pr.session_duration_min, pr.currency,
  t.base + d.i * 700, t.base + d.i * 700,
  coalesce(ti.split_pct, 75.00), tp.payout_country,
  now() - make_interval(days => d.dias),
  now() - make_interval(days => d.dias + 3),
  now() - make_interval(days => d.dias)
from _tutores t
join auth.users u on u.email = t.email
join public.tutor_profiles tp on tp.profile_id = u.id
left join public.tutor_tiers ti on ti.id = tp.tier_id
join lateral (
  select pr.* from public.products pr where pr.tutor_id = tp.profile_id
   order by pr.created_at limit 1
) pr on true
-- 20 y 12 días = pasada la retención de 7 → disponible. 2 días = en retención.
cross join (values (1, 20), (2, 12), (3, 2)) as d(i, dias)
on conflict (id) do nothing;

-- 3 · El cobro de cada una. `provider = 'simulated'` porque en dev nadie cobró
--     de verdad, y es lo mismo que usa `dev-poblar.sql`.
insert into public.payments (
  booking_id, status, currency, gross_amount, platform_fee_amount,
  tutor_net_amount, tier_split_pct, payee_country, provider, paid_at, created_at
)
select
  b.id, 'paid'::public.payment_status, b.currency, b.total_amount,
  b.total_amount - round(b.total_amount * b.tier_split_pct / 100)::bigint,
  round(b.total_amount * b.tier_split_pct / 100)::bigint,
  b.tier_split_pct, b.payee_country, 'simulated',
  b.created_at, b.created_at
from public.bookings b
where b.id::text like '77777777-0000-4000-8000-%'
on conflict (booking_id) do nothing;

-- 4 · Un payout ya pagado, para que «Ya cobrado» no salga vacío. No lleva
--     `payout_items`: no consume ninguno de los pagos de arriba, así que el
--     saldo disponible se queda como está.
insert into public.payouts (
  id, tutor_id, status, currency, amount, provider, funding_provider,
  payee_country, paid_at, created_at, updated_at
)
select
  ('77777777-1111-4000-8000-0000000000' || lpad(t.n::text, 2, '0'))::uuid,
  u.id, 'paid'::public.payout_status, 'USD', t.base * 3, 'simulated', 'simulated',
  tp.payout_country,
  now() - make_interval(days => 30),
  now() - make_interval(days => 32),
  now() - make_interval(days => 30)
from _tutores t
join auth.users u on u.email = t.email
join public.tutor_profiles tp on tp.profile_id = u.id
on conflict (id) do nothing;

-- 5 · Y la contraseña, para poder entrar a mirarlo.
update auth.users
   set encrypted_password = extensions.crypt('Ensename2026!', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now())
 where email in (select email from _tutores);

commit;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- El país que dedujo el disparador y el saldo que verá cada uno. No se llama a
-- `tutor_balance()` porque es SECURITY DEFINER y lee `auth.uid()`, que aquí es
-- null: se repite su misma cuenta a mano.
select
  u.email,
  p.timezone,
  tp.payout_country                                    as pais_deducido,
  sum(pay.tutor_net_amount) filter (
    where b.completed_at <= now() - interval '7 days')  as disponible,
  sum(pay.tutor_net_amount) filter (
    where b.completed_at >  now() - interval '7 days')  as en_retencion
-- Los correos van escritos aquí y no desde `_tutores`: esa tabla temporal es
-- `on commit drop` y esta comprobación corre DESPUÉS del commit, que es donde
-- tiene que correr para leer lo que quedó guardado de verdad.
from auth.users u
join public.profiles p on p.id = u.id
join public.tutor_profiles tp on tp.profile_id = u.id
join public.bookings b on b.tutor_id = u.id and b.id::text like '77777777-%'
join public.payments pay on pay.booking_id = b.id
where u.email in ('lucia.ferrer@ensenameya.dev','mateo.herrera@ensenameya.dev','sofia.marin@ensenameya.dev')
group by 1, 2, 3
order by 1;
