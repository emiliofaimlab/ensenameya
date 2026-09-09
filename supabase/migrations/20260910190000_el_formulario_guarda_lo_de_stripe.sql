-- ============================================================================
-- Enséñame Ya — el formulario de cobro guarda lo que Stripe necesita
--
-- Fase 5 de `docs/DICTADO-PAGOS.md`, la mitad de escritura.
--
-- `20260910180000` añadió las tres columnas y la RPC que las LEE. Esta añade
-- los dos parámetros que las ESCRIBEN, que es lo que faltaba para que el tutor
-- pueda dárnoslas desde su pantalla.
--
-- ⚠️ LOS DOS PARÁMETROS VAN AL FINAL Y CON DEFAULT, y no es estilo: esta RPC la
-- llama el navegador por posición. Meterlos en medio rompería todas las llamadas
-- que ya existen, y sin default rompería a cualquier cliente que no se haya
-- desplegado todavía. Es la misma disciplina con la que entró `p_state`.
--
-- 🔑 LA ACEPTACIÓN SE SELLA EN EL SERVIDOR. El navegador manda la IP; la HORA la
-- pone `now()`. Stripe exige que `tos_acceptance.date` sea el instante real y
-- que no esté en el futuro, y una marca de tiempo que viaja desde el navegador
-- es una marca que el navegador puede elegir. Sin IP no se sella nada: las dos
-- columnas quedan a null y el riel de Stripe se cae con `sin-datos`, que es el
-- fallo correcto — mejor no pagar que crear una cuenta sin consentimiento.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_payout_account(p_first_name text, p_last_name text, p_document_type text, p_bank_code text, p_document text DEFAULT NULL::text, p_account text DEFAULT NULL::text, p_account_type text DEFAULT NULL::text, p_branch text DEFAULT NULL::text, p_address_line text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_postcode text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_tos_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid        uuid := (select auth.uid());
  v_country    char(2);
  v_prev       public.tutor_payout_accounts%rowtype;
  v_doc        text;
  v_account    text;
  v_doc_type   text;
  v_acc_type   text;
  v_branch     text;
  v_bank       text;
  v_addr       text;
  v_city       text;
  v_post       text;
  v_phone      text;
  v_state      text;
  v_error      text;
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  select tp.payout_country into v_country
    from public.tutor_profiles tp
   where tp.profile_id = v_uid;

  if not found then
    raise exception 'solo un tutor puede registrar datos de cobro'
      using errcode = 'insufficient_privilege';
  end if;

  if v_country is null then
    raise exception 'declara primero en qué país cobras'
      using errcode = 'check_violation';
  end if;

  select * into v_prev
    from public.tutor_payout_accounts a
   where a.tutor_id = v_uid;

  -- ── Normalización ───────────────────────────────────────────────────────
  v_doc_type := upper(btrim(coalesce(p_document_type, '')));
  v_bank     := upper(btrim(coalesce(p_bank_code, '')));
  v_acc_type := nullif(upper(btrim(coalesce(p_account_type, ''))), '');
  v_branch   := nullif(btrim(coalesce(p_branch, '')), '');

  v_doc     := nullif(upper(regexp_replace(coalesce(p_document, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_account := nullif(regexp_replace(coalesce(p_account, ''), '\s', '', 'g'), '');

  v_addr  := nullif(btrim(coalesce(p_address_line, '')), '');
  v_city  := nullif(btrim(coalesce(p_city, '')), '');
  v_post  := nullif(btrim(coalesce(p_postcode, '')), '');
  v_phone := nullif(btrim(regexp_replace(coalesce(p_phone, ''), '[.]', '', 'g')), '');
  -- El estado SÍ va a mayúsculas: Wise lo sirve como lista cerrada de códigos
  -- («FL», «NSW») y «fl» no está en ella. Es el mismo criterio que el documento.
  v_state := nullif(upper(btrim(coalesce(p_state, ''))), '');

  -- ── «Deja el que ya está» ───────────────────────────────────────────────
  if v_prev.tutor_id is not null and v_prev.country = v_country then
    v_doc     := coalesce(v_doc, v_prev.beneficiary_document);
    v_account := coalesce(v_account, v_prev.bank_account);
    v_addr    := coalesce(v_addr,  v_prev.beneficiary_address_line);
    v_city    := coalesce(v_city,  v_prev.beneficiary_city);
    v_post    := coalesce(v_post,  v_prev.beneficiary_postcode);
    v_phone   := coalesce(v_phone, v_prev.beneficiary_phone);
    -- Y el estado igual, y aquí importa el doble: la pantalla no lo puede
    -- releer de la fila en la primera carga (la consulta de `page.tsx` no trae
    -- la columna), así que llega vacío casi siempre. Sin este coalesce, cada
    -- guardado borraría el estado y dejaría al tutor de EE. UU. fuera del riel.
    v_state   := coalesce(v_state, v_prev.beneficiary_state);
  end if;

  if v_doc is null then
    raise exception 'falta el número de documento' using errcode = 'check_violation';
  end if;
  if v_account is null then
    raise exception 'falta el número de cuenta' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'el nombre y los apellidos son obligatorios: tienen que ser los del titular de la cuenta'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ NI LA DIRECCIÓN NI EL ESTADO SON OBLIGATORIOS AQUÍ, y es deliberado, por
  -- lo mismo que escribió `20260907130000`: exigirlos rompería el guardado a los
  -- nueve países que ya cobran sin ellos. Quien no los ponga no entra en el riel
  -- de Wise, y eso lo dice `wise_puede_pagar_a` — un filtro de ruteo, no un
  -- error de formulario.

  v_error := public.payout_account_check(
    v_country, v_doc_type, v_doc, v_bank, v_acc_type, v_account, v_branch
  );
  if v_error is not null then
    raise exception '%', v_error using errcode = 'check_violation';
  end if;

  begin
    insert into public.tutor_payout_accounts as a (
      tutor_id, country,
      beneficiary_first_name, beneficiary_last_name,
      beneficiary_document_type, beneficiary_document,
      bank_code, bank_account, bank_account_type, bank_branch,
      beneficiary_address_line, beneficiary_city, beneficiary_postcode,
      beneficiary_phone, beneficiary_state,
      beneficiary_dob, stripe_tos_accepted_at, stripe_tos_ip
    )
    values (
      v_uid, v_country,
      btrim(p_first_name), btrim(p_last_name),
      v_doc_type, v_doc,
      v_bank, v_account, v_acc_type, v_branch,
      v_addr, v_city, v_post, v_phone, v_state,
      -- 🔑 La aceptación se sella AQUÍ, en el servidor, y solo si llega la IP:
      -- es un dato legal y `now()` del servidor es la única marca que no puede
      -- falsear el navegador. Sin IP no hay aceptación y las dos quedan a null,
      -- que es lo que hace que el riel de Stripe se caiga con `sin-datos` en vez
      -- de crear una cuenta sin consentimiento probado.
      p_dob,
      case when p_tos_ip is not null then now() end,
      nullif(btrim(coalesce(p_tos_ip, '')), '')::inet
    )
    on conflict (tutor_id) do update
       set country                   = excluded.country,
           beneficiary_first_name    = excluded.beneficiary_first_name,
           beneficiary_last_name     = excluded.beneficiary_last_name,
           beneficiary_document_type = excluded.beneficiary_document_type,
           beneficiary_document      = excluded.beneficiary_document,
           bank_code                 = excluded.bank_code,
           bank_account              = excluded.bank_account,
           bank_account_type         = excluded.bank_account_type,
           bank_branch               = excluded.bank_branch,
           beneficiary_address_line  = excluded.beneficiary_address_line,
           beneficiary_city          = excluded.beneficiary_city,
           beneficiary_postcode      = excluded.beneficiary_postcode,
           beneficiary_phone         = excluded.beneficiary_phone,
           beneficiary_state         = excluded.beneficiary_state,
           -- ⚠️ `coalesce(excluded, a)`: el navegador puede mandar estos dos a
           -- null porque el tutor edite su cuenta sin volver a marcar la casilla
           -- ni reteclear la fecha. Pisarlos con null le borraría una aceptación
           -- legal que ya dio y le dejaría el riel de Stripe muerto sin que él
           -- toque nada. Es el mismo criterio con el que el documento y el
           -- número de cuenta a null significan «conserva lo guardado».
           beneficiary_dob           = coalesce(excluded.beneficiary_dob, a.beneficiary_dob),
           stripe_tos_accepted_at    = coalesce(excluded.stripe_tos_accepted_at, a.stripe_tos_accepted_at),
           stripe_tos_ip             = coalesce(excluded.stripe_tos_ip, a.stripe_tos_ip)
     where a.tutor_id = v_uid;

    return (
      select jsonb_build_object(
        'country',            a.country,
        'bank_code',          a.bank_code,
        'bank_name',          b.name,
        'bank_account_type',  a.bank_account_type,
        'bank_branch',        a.bank_branch,
        'last4',              a.bank_account_last4,
        'document_type',      a.beneficiary_document_type,
        'holder',             a.beneficiary_first_name || ' ' || a.beneficiary_last_name,
        'address_line',       a.beneficiary_address_line,
        'city',               a.beneficiary_city,
        'postcode',           a.beneficiary_postcode,
        'phone',              a.beneficiary_phone,
        'state',              a.beneficiary_state,
        'wise_listo',         public.wise_puede_pagar_a(v_uid),
        'updated_at',         a.updated_at
      )
        from public.tutor_payout_accounts a
        join public.payout_banks b
          on b.country = a.country and b.bank_code = a.bank_code
       where a.tutor_id = v_uid
    );
  exception
    -- ⚠️ NO SE TOCA. Ver `20260901170000`: los `check` de esta tabla, al saltar,
    -- publicarían la fila entera —documento y cuenta en claro— por PostgREST y
    -- en el log. El estado también tiene check y también pasa por aquí.
    when check_violation or not_null_violation or string_data_right_truncation then
      raise exception 'los datos de cobro no tienen el formato que pide %', v_country
        using errcode = 'check_violation';
  end;

end;
$function$;

comment on function public.upsert_payout_account(text,text,text,text,text,text,text,text,text,text,text,text,text,date,text) is
  'Única puerta de escritura de tutor_payout_accounts (la tabla no tiene grant de insert/update para nadie). Valida contra payout_country_rules y envuelve el insert para que un check del esquema no devuelva la fila —documento y número de cuenta en claro— al navegador ni al log. Los argumentos de documento y cuenta a null significan «conserva lo guardado», y desde el 10-sep-2026 también p_dob y p_tos_ip: editar la cuenta sin volver a aceptar no borra una aceptación ya dada. La hora de la aceptación la pone el SERVIDOR con now(), nunca el navegador.';

-- ── Autocomprobación ───────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_payout_account'
       and pg_get_function_identity_arguments(p.oid) like '%p_dob date%'
  ) then
    raise exception 'upsert_payout_account no acepta la fecha de nacimiento: el tutor no podría cobrar por Stripe';
  end if;
end $$;
