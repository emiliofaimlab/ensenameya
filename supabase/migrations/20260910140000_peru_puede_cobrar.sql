-- ============================================================================
-- Enséñame Ya — Perú puede cobrar por dLocal
--
-- Fase 2 de `docs/DICTADO-PAGOS.md`, remate.
--
-- Perú es país de payout de dLocal y llevaba desde el 1-sep sin poder cobrar
-- por ahí: su API pide la calle y la ciudad del beneficiario y devolvía
-- `400 Missing required field: beneficiary.address.street`. El comentario de
-- `lib/dlocalgo.ts` lo daba por imposible —«`tutor_payout_accounts` no guarda
-- dirección»— y eso dejó de ser verdad el 7-sep, cuando Wise obligó a pedirla:
-- `beneficiary_address_line` y `beneficiary_city` existen y están rellenas.
--
-- O sea que no falta ni un dato ni un formulario: faltaba mandarlos.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payout_beneficiary(p_payout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payout public.payouts%rowtype;
  v_acc    public.tutor_payout_accounts%rowtype;
  v_rules  public.payout_country_rules%rowtype;
  v_error  text;
begin
  select * into v_payout from public.payouts p where p.id = p_payout_id;
  if not found then
    raise exception 'no existe ese payout' using errcode = 'no_data_found';
  end if;

  -- Solo se construye un beneficiario para una orden que se está ejecutando. Un
  -- `select` plano no puede hacer esta comprobación, y es la mitad del motivo
  -- por el que esto es una función y no un `grant select` a `service_role`.
  if v_payout.status not in ('scheduled'::public.payout_status,
                             'processing'::public.payout_status) then
    raise exception 'el payout está en % y no se puede ejecutar', v_payout.status
      using errcode = 'check_violation';
  end if;

  -- ⚠️ Hoy, en dev, TODOS los payouts tienen `payee_country` null: el backfill de
  -- `20260901130000` lo copió de `payments.payee_country`, que está a null en las
  -- 115 filas. Que esto levante excepción es lo correcto — una orden de pago sin
  -- país de destino no se puede mandar a ningún sitio— y es el primer sitio
  -- donde ese null se va a notar.
  if v_payout.payee_country is null then
    raise exception 'el payout no tiene país de destino: no se puede pagar'
      using errcode = 'check_violation';
  end if;

  select * into v_acc
    from public.tutor_payout_accounts a
   where a.tutor_id = v_payout.tutor_id;
  if not found then
    raise exception 'el tutor no ha registrado sus datos de cobro'
      using errcode = 'no_data_found';
  end if;

  -- El país de los datos contra el país congelado en la orden. Si el tutor se
  -- mudó después de que se creara el payout, sus coordenadas nuevas no sirven
  -- para pagar esta orden vieja: eso es una decisión de operaciones, no algo que
  -- se resuelva mandando el dinero al país equivocado.
  if v_acc.country <> v_payout.payee_country then
    raise exception 'los datos de cobro del tutor son de % y el payout es a %',
      v_acc.country, v_payout.payee_country using errcode = 'check_violation';
  end if;

  select * into v_rules
    from public.payout_country_rules r
   where r.country = v_acc.country;

  -- Se revalida al ejecutar, no solo al guardar: entre lo uno y lo otro pueden
  -- pasar semanas, y las reglas y la lista de bancos son datos que se editan.
  v_error := public.payout_account_check(
    v_acc.country, v_acc.beneficiary_document_type, v_acc.beneficiary_document,
    v_acc.bank_code, v_acc.bank_account_type, v_acc.bank_account, v_acc.bank_branch
  );
  if v_error is not null then
    raise exception 'los datos de cobro del tutor ya no son válidos: %', v_error
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'transfer_country',           v_acc.country,
    'currency_to_pay',            v_rules.currency,
    -- Constantes de la plataforma, no datos del tutor. `B2C` es empresa →
    -- persona, que es lo que somos; `OTHER_SERVICES` es «purchase sale of
    -- services» y es el purpose que encaja con pagar a un mentor (`TUITION_COSTS`
    -- va en la dirección contraria: alumno pagando matrícula). Un purpose
    -- inválido se retiene por compliance.
    'flow_type',                  'B2C',
    'purpose',                    'OTHER_SERVICES',
    'beneficiary_first_name',     v_acc.beneficiary_first_name,
    'beneficiary_last_name',      v_acc.beneficiary_last_name,
    'beneficiary_document',       v_acc.beneficiary_document,
    'beneficiary_document_type',  v_acc.beneficiary_document_type,
    'bank_code',                  v_acc.bank_code,
    'bank_account',               v_acc.bank_account,
    'bank_account_type',          v_acc.bank_account_type,
    'bank_branch',                v_acc.bank_branch,
    -- 🔑 PERÚ LOS EXIGE, y por eso el país no podía cobrar por dLocal: la API
    -- devolvía `400 Missing required field: beneficiary.address.street`. Los dos
    -- datos ya se guardan desde que los pidió Wise (20260907120000), así que lo
    -- único que faltaba era mandarlos.
    --
    -- Se mandan SIEMPRE, no solo en Perú: son campos opcionales para el resto de
    -- países y un `if` por país aquí sería una segunda lista de países que
    -- mantener sincronizada con la de dLocal. `''` cuando el tutor no los tiene,
    -- que es el mismo criterio que `bank_branch`.
    'beneficiary_address_street', coalesce(v_acc.beneficiary_address_line, ''),
    'beneficiary_address_city',   coalesce(v_acc.beneficiary_city, '')
  );
end;
$function$;

comment on function public.payout_beneficiary(uuid) is
  'El beneficiario de un payout, en la forma exacta que espera POST /v1/payouts de dLocal Go. Revalida que la orden sea ejecutable antes de soltar el número de cuenta, que es lo que justifica que sea SECURITY DEFINER. Desde el 10-sep-2026 incluye beneficiary_address_street y _city, obligatorios en Perú y opcionales en el resto: salen de las columnas que pidió Wise, y sin ellos PE no podía cobrar por dLocal.';

-- ── Autocomprobación ───────────────────────────────────────────────────────
-- Se afirma la FORMA de la respuesta, no el contenido de ninguna fila: es
-- verdad en dev y en producción por igual.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'payout_beneficiary'
       and pg_get_functiondef(p.oid) like '%beneficiary_address_street%'
  ) then
    raise exception 'payout_beneficiary no manda la dirección: Perú seguiría sin poder cobrar';
  end if;
end $$;
