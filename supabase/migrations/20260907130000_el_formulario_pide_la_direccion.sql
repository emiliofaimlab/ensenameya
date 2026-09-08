-- ══════════════════════════════════════════════════════════════════════════════
-- EL FORMULARIO DE COBRO APRENDE A PEDIR DIRECCIÓN Y TELÉFONO
--
-- `20260907120000` añadió las cuatro columnas y las dejó nullable, así que hasta
-- ahora nadie las podía rellenar: `upsert_payout_account` es la ÚNICA vía de
-- escritura a `tutor_payout_accounts` (la tabla no tiene política de insert ni de
-- update para nadie, a propósito). Sin esta migración, `banco_wise` sería false
-- para todo el mundo para siempre y el riel de Wise estaría encendido y vacío.
--
-- 🔴 ESTO ES UN `drop function` + `create`, Y ESO PIERDE LOS GRANTS.
--
-- Hay que hacerlo así porque cambia la FIRMA: `create or replace` exige los
-- mismos tipos de argumento, y añadir cuatro `text` crearía una SEGUNDA función
-- sobrecargada en vez de sustituir a la primera. Con las dos vivas y todos los
-- argumentos nuevos con `default null`, una llamada de ocho argumentos encaja en
-- las dos y PostgREST no sabría a cuál llamar.
--
-- ⚠️ Y la trampa que eso abre está documentada y ya casi muerde una vez: los
-- `grant` de esta función NO viven en la migración que la definió por última vez
-- (`20260901170000` usa `create or replace` y no repite ninguno) sino en
-- `20260901160000:1540-1542`. Un `drop` sin volver a concederlos deja al
-- formulario del tutor sin permiso de ejecución, y el síntoma no es un error de
-- compilación ni un fallo del despliegue: es que guardar los datos de cobro deja
-- de funcionar en producción. Por eso se repiten abajo y por eso hay una
-- autocomprobación que se niega a terminar si `authenticated` no puede llamarla.
--
-- ── QUÉ CAMBIA PARA EL TUTOR ────────────────────────────────────────────────
-- Cuatro campos más, opcionales en la base de datos y pedidos siempre en la
-- pantalla. No son «los campos de Wise»: la dirección la exige también dLocal en
-- Perú, que hoy no puede pagar allí por no tenerla
-- (`dlocal-provider.ts:1203-1205`). Un tutor que los deje en blanco sigue
-- cobrando exactamente como cobraba.
-- ══════════════════════════════════════════════════════════════════════════════

drop function if exists public.upsert_payout_account(
  text, text, text, text, text, text, text, text
);

create or replace function public.upsert_payout_account(
  p_first_name    text,
  p_last_name     text,
  p_document_type text,
  p_bank_code     text,
  p_document      text default null,
  p_account       text default null,
  p_account_type  text default null,
  p_branch        text default null,
  -- Los cuatro nuevos van AL FINAL y con default: así una llamada vieja de ocho
  -- argumentos sigue siendo válida y no rompe nada que ya estuviera desplegado.
  p_address_line  text default null,
  p_city          text default null,
  p_postcode      text default null,
  p_phone         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_error      text;
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  -- El país sale de `tutor_profiles`, no del cliente.
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

  -- La dirección NO se normaliza como el documento: sus mayúsculas, sus puntos y
  -- sus guiones son parte del dato. Solo se recortan los bordes.
  v_addr  := nullif(btrim(coalesce(p_address_line, '')), '');
  v_city  := nullif(btrim(coalesce(p_city, '')), '');
  v_post  := nullif(btrim(coalesce(p_postcode, '')), '');
  -- Del teléfono sí se quitan los puntos, que el check no admite y que la gente
  -- escribe sin pensar. El más y los paréntesis se quedan: Wise los acepta.
  v_phone := nullif(btrim(regexp_replace(coalesce(p_phone, ''), '[.]', '', 'g')), '');

  -- ── «Deja el que ya está» ───────────────────────────────────────────────
  if v_prev.tutor_id is not null and v_prev.country = v_country then
    v_doc     := coalesce(v_doc, v_prev.beneficiary_document);
    v_account := coalesce(v_account, v_prev.bank_account);
    -- Los cuatro nuevos siguen la misma regla, y aquí importa más todavía: el
    -- formulario los manda siempre, pero una llamada vieja de ocho argumentos
    -- los manda como null, y sin esto BORRARÍA la dirección de quien ya la
    -- tuviese — dejando de golpe a ese tutor fuera del riel de Wise.
    v_addr    := coalesce(v_addr,  v_prev.beneficiary_address_line);
    v_city    := coalesce(v_city,  v_prev.beneficiary_city);
    v_post    := coalesce(v_post,  v_prev.beneficiary_postcode);
    v_phone   := coalesce(v_phone, v_prev.beneficiary_phone);
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

  -- ⚠️ LA DIRECCIÓN NO ES OBLIGATORIA AQUÍ, Y ESO ES DELIBERADO. Exigirla
  -- rompería el guardado a los ocho países que hoy cobran por dLocal sin
  -- necesitarla, y a los tutores que ya tienen su fila guardada. Quien no la
  -- ponga simplemente no entra en el riel de Wise: lo dice `wise_puede_pagar_a`,
  -- que es un filtro de ruteo y no un error de formulario.

  -- ── La validación fuerte ────────────────────────────────────────────────
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
      beneficiary_phone
    )
    values (
      v_uid, v_country,
      btrim(p_first_name), btrim(p_last_name),
      v_doc_type, v_doc,
      v_bank, v_account, v_acc_type, v_branch,
      v_addr, v_city, v_post, v_phone
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
           beneficiary_phone         = excluded.beneficiary_phone
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
        -- El formulario repinta con esto y sin volver a consultar. Que la
        -- dirección vuelva es lo que le permite decir «ya la tienes» sin
        -- recargar, igual que hace con el banco.
        'address_line',       a.beneficiary_address_line,
        'city',               a.beneficiary_city,
        'postcode',           a.beneficiary_postcode,
        'phone',              a.beneficiary_phone,
        -- Y lo que de verdad quiere saber quien acaba de rellenarlo: si con esto
        -- ya se le puede pagar por el riel más barato.
        'wise_listo',         public.wise_puede_pagar_a(v_uid),
        'updated_at',         a.updated_at
      )
        from public.tutor_payout_accounts a
        join public.payout_banks b
          on b.country = a.country and b.bank_code = a.bank_code
       where a.tutor_id = v_uid
    );
  exception
    -- ⚠️ NO SE TOCA. Los `check` de esta tabla, al saltar, publican la fila
    -- entera —documento y cuenta en claro— por PostgREST y en el log. Este
    -- bloque es lo que convierte eso en un mensaje sin datos dentro, y es la
    -- razón de ser de `20260901170000`. Los cuatro campos nuevos también tienen
    -- check, así que también pasan por aquí.
    when check_violation or not_null_violation or string_data_right_truncation then
      raise exception 'los datos de cobro no tienen el formato que pide %', v_country
        using errcode = 'check_violation';
  end;

end;
$$;

comment on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) is
  'La ÚNICA vía de escritura a tutor_payout_accounts: la tabla no tiene política de insert ni de update para nadie. El país sale de tutor_profiles y no del cliente. Documento, cuenta, dirección y teléfono en blanco significan «deja el que ya está», que es la contrapartida de que la lectura vaya enmascarada. Los cuatro últimos argumentos (dirección y teléfono del beneficiario) se añadieron el 7-sep-2026: los exige Wise en todos sus corredores y dLocal en Perú.';

-- 🔴 LOS GRANTS, QUE EL `drop` SE LLEVÓ POR DELANTE. Sin estas tres líneas el
-- formulario del tutor deja de guardar y no lo dice nadie.
revoke execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) from public;
revoke execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) from anon;
grant execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated',
       'public.upsert_payout_account(text,text,text,text,text,text,text,text,text,text,text,text)',
       'execute') then
    raise exception 'authenticated no puede ejecutar upsert_payout_account: el formulario del tutor está roto';
  end if;
  if has_function_privilege('anon',
       'public.upsert_payout_account(text,text,text,text,text,text,text,text,text,text,text,text)',
       'execute') then
    raise exception 'anon puede ejecutar upsert_payout_account';
  end if;
  -- Y que no haya quedado la vieja viva al lado, que es la ambigüedad que este
  -- `drop` existe para evitar.
  if (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'upsert_payout_account') <> 1 then
    raise exception 'hay más de una upsert_payout_account: PostgREST no sabrá a cuál llamar';
  end if;
end $$;
