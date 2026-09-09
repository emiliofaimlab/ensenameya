-- ============================================================================
-- Enséñame Ya — Colombia y Chile también cobran por Stripe
--
-- Fase 5 de `docs/DICTADO-PAGOS.md`, remate.
--
-- Al escribir el adaptador se midió que **Stripe exige el tipo de cuenta** para
-- adjuntar una cuenta bancaria colombiana o chilena: sin él responde
-- «Invalid bank account type: the account type is required».
--
-- `payout_beneficiary_stripe` no lo mandaba. El dato existía —el tutor lo teclea
-- desde que existe el formulario y vive en
-- `tutor_payout_accounts.bank_account_type`— así que no faltaba ni un campo ni
-- una pantalla: faltaba pasarlo. Es el mismo tipo de agujero que tuvo Perú con
-- la dirección hasta el 10-sep.
--
-- ⚠️ POR QUÉ NO SE VEÍA. El veredicto era `sin-datos`, que deja la orden quieta
-- y contada en vez de fallar, y en los dos países Wise va DELANTE de Stripe en
-- la fila de ruteo. O sea que el tutor cobraba igual y el riel roto no daba la
-- cara. Se habría visto el día que Wise no pudiera.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payout_beneficiary_stripe(p_payout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payout public.payouts;
  v_acc    public.tutor_payout_accounts;
  v_rules  public.payout_country_rules;
begin
  select * into v_payout from public.payouts where id = p_payout_id;
  if not found then
    raise exception 'no existe el payout %', p_payout_id using errcode = 'check_violation';
  end if;

  -- La misma puerta que las otras dos: una orden ya pagada no vuelve a soltar
  -- coordenadas bancarias.
  if v_payout.status not in ('scheduled'::public.payout_status, 'processing'::public.payout_status) then
    raise exception 'el payout está en % y no se puede ejecutar', v_payout.status
      using errcode = 'check_violation';
  end if;

  select * into v_acc from public.tutor_payout_accounts where tutor_id = v_payout.tutor_id;
  if not found then
    raise exception 'el tutor no tiene cuenta bancaria registrada' using errcode = 'check_violation';
  end if;

  select * into v_rules from public.payout_country_rules where country = v_acc.country;
  if not found then
    raise exception 'no hay reglas de cobro para %', v_acc.country using errcode = 'check_violation';
  end if;

  -- 🔴 LOS DOS DATOS QUE STRIPE NO PERDONA. Se comprueban aquí y no en el
  -- adaptador para que el fallo sea uno y con nombre: sin ellos la cuenta se
  -- queda en `past_due` y la transferencia falla con un mensaje de Stripe que no
  -- dice qué le pedimos al tutor.
  if v_acc.beneficiary_dob is null then
    raise exception 'falta la fecha de nacimiento del titular' using errcode = 'check_violation';
  end if;
  if v_acc.stripe_tos_accepted_at is null or v_acc.stripe_tos_ip is null then
    raise exception 'el tutor no ha aceptado las condiciones de la cuenta de cobro'
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'country',    v_acc.country,
    'currency',   lower(v_rules.currency),
    'first_name', v_acc.beneficiary_first_name,
    'last_name',  v_acc.beneficiary_last_name,
    'dob', jsonb_build_object(
      'day',   extract(day   from v_acc.beneficiary_dob)::int,
      'month', extract(month from v_acc.beneficiary_dob)::int,
      'year',  extract(year  from v_acc.beneficiary_dob)::int
    ),
    -- `id_number`: lo piden Colombia y Chile (medido). Es el mismo documento
    -- que ya le pedimos para dLocal, sin reformatear.
    'id_number', v_acc.beneficiary_document,
    'address', jsonb_build_object(
      'country',     v_acc.country,
      'line1',       v_acc.beneficiary_address_line,
      'city',        v_acc.beneficiary_city,
      'state',       v_acc.beneficiary_state,
      'postal_code', v_acc.beneficiary_postcode
    ),
    -- La cuenta destino. `bank_account` es el IBAN donde el formato es IBAN, y
    -- el número de cuenta donde no lo es; `bank_branch` es el segundo número
    -- (sort code, ruta ACH, BSB…), que Stripe llama `routing_number`.
    -- 🔑 EL TIPO DE CUENTA, y sin él Colombia y Chile NO SE PUEDEN PAGAR por
    -- Stripe. Medido el 10-sep: su API responde «Invalid bank account type: the
    -- account type is required» al adjuntar la cuenta, y el riel se queda en
    -- `sin-datos` para siempre — con el agravante de que el dato SÍ estaba
    -- guardado en `tutor_payout_accounts.bank_account_type`; solo faltaba
    -- mandarlo. Los países que no lo usan lo reciben null y Stripe lo ignora.
    'account_type', v_acc.bank_account_type,
    'account_number', v_acc.bank_account,
    'routing_number', nullif(btrim(coalesce(v_acc.bank_branch, '')), ''),
    'account_holder_name', v_acc.beneficiary_first_name || ' ' || v_acc.beneficiary_last_name,
    -- La aceptación, en el formato que pide Stripe: segundos, no milisegundos.
    'tos_date', extract(epoch from v_acc.stripe_tos_accepted_at)::bigint,
    'tos_ip',   host(v_acc.stripe_tos_ip)
  );
end $function$;

-- ── Autocomprobación ───────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'payout_beneficiary_stripe'
       and pg_get_functiondef(p.oid) like '%account_type%'
  ) then
    raise exception 'payout_beneficiary_stripe no manda el tipo de cuenta: Colombia y Chile no podrían cobrar por Stripe';
  end if;
end $$;
