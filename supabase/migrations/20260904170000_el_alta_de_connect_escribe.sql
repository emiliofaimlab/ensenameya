-- ============================================================================
-- Enséñame Ya — quién puede escribir la cuenta conectada
--
-- `20260904160000` creó la columna y le dio lectura al tutor. Falta la otra
-- mitad: el Route Handler que crea la cuenta en Stripe tiene que ANOTAR el
-- `acct_…`, y corre con `service_role`, que no tiene ni un grant sobre
-- `tutor_profiles` (regla de oro 9: se salta la RLS, no los grants — y el fallo
-- sería en tiempo de ejecución, no en el build ni en el typecheck).
--
-- Se concede por COLUMNA y solo esa. `authenticated` sigue sin poder tocarla:
-- quien pudiera escribirla podría apuntar su payout a la cuenta de otro.
-- ============================================================================

grant select (profile_id, payout_country, stripe_connect_account_id)
  on public.tutor_profiles to service_role;

grant update (stripe_connect_account_id)
  on public.tutor_profiles to service_role;
