-- ============================================================================
-- Enséñame Ya — la cuenta conectada de Stripe: dónde se guarda y quién la lee
--
-- Es lo que le faltaba al adaptador de payout de Stripe para existir. Un
-- `transfers.create` necesita UN dato que hoy no está en ninguna tabla: el
-- identificador de la cuenta conectada del tutor (`acct_…`). Los datos
-- bancarios de `tutor_payout_accounts` no sirven para esto y no es un detalle:
-- con Connect el número de cuenta lo custodia Stripe, se lo da el tutor a ELLOS
-- durante el alta, y nosotros no lo vemos nunca.
--
-- ⚠️ POR QUÉ HACE FALTA ESTE RIEL SI YA ESTÁ PAYPAL. Por Colombia, y está
-- medido: `POST /v1/payouts` de dLocal responde `7000 Payout is not enabled for
-- country CO and currency COP` (4-sep-2026). dLocal COBRA en Colombia y no
-- PAGA ahí — son dos listas distintas, ver `docs/PAGOS-Y-PAYOUTS.md` §9.1.
--
-- ── LA COLUMNA NO ES DEL TUTOR AUNQUE VIVA EN SU FILA ───────────────────────
--
-- La escribe Stripe (a través de nuestro Route Handler), no el formulario. Por
-- eso NO lleva `grant update` para `authenticated`: si el tutor pudiera
-- cambiarla, podría apuntar su payout a la cuenta conectada de otro. Leerla sí
-- —necesita saber si ya se dio de alta— y para eso vale su política de siempre.
--
-- ⚠️ Y `service_role` NO tiene grants sobre `tutor_profiles` (regla de oro 9),
-- ni se los damos aquí: el job lee por `destino_connect()`, que es SECURITY
-- DEFINER y comprueba la orden antes de soltar el dato, exactamente como
-- `payout_beneficiary` hace con el número de cuenta de dLocal. Un `grant
-- select` a secas sería una puerta más ancha para un dato menos protegido.
-- ============================================================================

alter table public.tutor_profiles
  add column if not exists stripe_connect_account_id text;

-- Una cuenta conectada es de UN tutor. Sin esto, un error de copiar y pegar en
-- un `update` manual mandaría el dinero de dos tutores al mismo sitio.
create unique index if not exists tutor_profiles_stripe_connect_account_id_key
  on public.tutor_profiles (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

comment on column public.tutor_profiles.stripe_connect_account_id is
  'Identificador de la cuenta conectada de Stripe del tutor (acct_…), o null si no se ha dado de alta. Lo escribe /api/tutor/stripe-connect al crearla, NUNCA el navegador: no hay grant update para authenticated, porque quien pudiera cambiarlo podría desviar su propio payout a otra cuenta. Es el destino de transfers.create y el único dato que el riel de Stripe necesita del tutor: con Connect el número de cuenta lo custodia Stripe y nosotros no lo vemos. Lo lee destino_connect(payout_id), no un select directo.';

-- El tutor ve la suya (su política de fila propia ya existe); el grant de
-- columna es lo que hace que PostgREST se la devuelva.
grant select (stripe_connect_account_id) on public.tutor_profiles to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- destino_connect(payout_id) — el equivalente de `payout_beneficiary` para el
-- riel de Stripe, y mucho más corto porque el beneficiario no viaja: viaja su
-- identificador.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Comprueba lo mismo que la otra: que la orden es ejecutable y que tiene país.
-- Lo que NO comprueba es que el país case con nada — con Connect el país lo
-- congeló Stripe al crear la cuenta y no lo decidimos nosotros.

create or replace function public.destino_connect(p_payout_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payout public.payouts;
  v_acct   text;
begin
  select * into v_payout from public.payouts p where p.id = p_payout_id;
  if not found then
    raise exception 'payout % no existe', p_payout_id using errcode = 'no_data_found';
  end if;
  if v_payout.status not in ('scheduled', 'processing') then
    raise exception 'payout % no es ejecutable (status=%)', p_payout_id, v_payout.status
      using errcode = 'check_violation';
  end if;
  if v_payout.payee_country is null then
    raise exception 'payout % no tiene país de destino', p_payout_id
      using errcode = 'check_violation';
  end if;

  select tp.stripe_connect_account_id into v_acct
    from public.tutor_profiles tp
   where tp.profile_id = v_payout.tutor_id;

  return v_acct;   -- null = el tutor no ha completado el alta en Stripe
end $$;

comment on function public.destino_connect(uuid) is
  'Devuelve la cuenta conectada de Stripe a la que va UN payout, o null si el tutor no se ha dado de alta. Es a Connect lo que payout_beneficiary es a dLocal: existe para que service_role no necesite grant sobre tutor_profiles y para que la orden se revalide al EJECUTAR y no solo al planificar. Levanta excepción si el payout no existe, no es ejecutable o no tiene país.';

revoke execute on function public.destino_connect(uuid) from public;
grant  execute on function public.destino_connect(uuid) to service_role;
