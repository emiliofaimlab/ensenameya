-- Enséñame Ya — B1a · el error de validación dejaba de fugar el número de cuenta.
--
-- `20260901160000` metió la validación fuerte en `payout_account_check` y dejó
-- los `check` del esquema como red de seguridad. Correcto — salvo por cómo
-- FALLA un `check` en Postgres: el mensaje de error incluye **la fila que lo
-- violó**, y en `tutor_payout_accounts` esa fila lleva el documento de
-- identidad y el número de cuenta en claro. PostgREST lo devuelve tal cual al
-- navegador y el servidor lo escribe en su log.
--
-- Es la peor forma de fallar que puede tener una tabla de PII: el mecanismo que
-- la protege, al saltar, la publica. Lo cazaron dos revisores adversariales por
-- separado y los dos lo marcaron como bloqueante; tenían razón.
--
-- No se quitan los `check`: siguen siendo el invariante que no depende de que
-- nadie llame a la función correcta. Lo que cambia es que la ÚNICA puerta de
-- escritura los envuelve y traduce su error a uno que no lleva datos dentro.
--
-- ⚠️ Y no basta con `check_violation`: `not_null_violation` y
-- `string_data_right_truncation` (un `varchar(n)` corto) construyen el mensaje
-- igual de generosamente.

create or replace function public.upsert_payout_account(
  p_first_name    text,
  p_last_name     text,
  p_document_type text,
  p_bank_code     text,
  -- ⚠️ Los DOS sensibles admiten null con el significado «deja el que ya está»,
  -- igual que un formulario de contraseña. Es la contrapartida de enmascarar la
  -- lectura: sin esto, corregir una letra del apellido obligaría a reteclear el
  -- número de cuenta, y reteclear datos bancarios es como se introducen erratas.
  p_document      text default null,
  p_account       text default null,
  p_account_type  text default null,
  p_branch        text default null
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
  v_error      text;
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  -- El país sale de `tutor_profiles`, no del cliente: es la única forma de que
  -- no se pueda declarar un país y mandar datos de otro. Y de paso es el guard
  -- de rol — un alumno no tiene fila aquí.
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

  -- ── Normalización ─────────────────────────────────────────────────────────
  -- El documento pierde puntos, guiones y espacios y sube a mayúsculas: la doc
  -- de dLocal da "450.539.758-09" y "45053975809" como el mismo CPF y guardar
  -- las dos formas sería guardar dos verdades del mismo dato.
  --
  -- La cuenta NO: en Brasil y Uruguay el guion y los ceros de delante son parte
  -- del formato del banco. Solo se le quitan los espacios.
  v_doc_type := upper(btrim(coalesce(p_document_type, '')));
  v_bank     := upper(btrim(coalesce(p_bank_code, '')));
  v_acc_type := nullif(upper(btrim(coalesce(p_account_type, ''))), '');
  v_branch   := nullif(btrim(coalesce(p_branch, '')), '');

  v_doc     := nullif(upper(regexp_replace(coalesce(p_document, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_account := nullif(regexp_replace(coalesce(p_account, ''), '\s', '', 'g'), '');

  -- ── «Deja el que ya está» ─────────────────────────────────────────────────
  -- Solo si la fila guardada es DEL MISMO PAÍS. Si el tutor cambió de país, una
  -- cuenta mexicana no es una cuenta argentina: se le pide todo otra vez en
  -- lugar de arrastrar en silencio unas coordenadas que no valen.
  if v_prev.tutor_id is not null and v_prev.country = v_country then
    v_doc     := coalesce(v_doc, v_prev.beneficiary_document);
    v_account := coalesce(v_account, v_prev.bank_account);
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

  -- ── La validación fuerte, y aquí es donde de verdad manda el servidor ─────
  v_error := public.payout_account_check(
    v_country, v_doc_type, v_doc, v_bank, v_acc_type, v_account, v_branch
  );
  if v_error is not null then
    -- `check_violation` para que el cliente lo distinga de un fallo de sesión y
    -- lo enseñe tal cual: el mensaje ya está escrito para el tutor.
    raise exception '%', v_error using errcode = 'check_violation';
  end if;

  -- ⚠️ EL `INSERT` VA DENTRO DE SU PROPIO BLOQUE, Y NO ES DECORACIÓN.
  --
  -- Lo cazaron dos de los tres revisores adversariales del 1-sep, por separado:
  -- cuando salta un `check` de tabla, Postgres construye el mensaje de error
  -- con **la fila entera que lo violó**. Y en esta tabla la fila entera son el
  -- documento de identidad y el número de cuenta EN CLARO. Ese texto sale por
  -- PostgREST hasta el navegador y además queda escrito en el log del servidor.
  --
  -- O sea que el mecanismo que existe para proteger el dato era, al fallar, el
  -- que lo publicaba. Y el camino no es teórico: la validación amable de
  -- `payout_account_check` y los `check` crudos del esquema no son idénticos a
  -- propósito —uno consulta la tabla de reglas, el otro no puede—, así que hay
  -- un hueco entre los dos por el que se llega aquí con datos que el primero
  -- dejó pasar.
  --
  -- Se traga el detalle y se levanta un mensaje sin datos. Se pierde
  -- información de diagnóstico: es exactamente lo que se quiere: un error de
  -- formato no vale un IBAN en un log.
  begin
    insert into public.tutor_payout_accounts as a (
      tutor_id, country,
      beneficiary_first_name, beneficiary_last_name,
      beneficiary_document_type, beneficiary_document,
      bank_code, bank_account, bank_account_type, bank_branch
    )
    values (
      v_uid, v_country,
      btrim(p_first_name), btrim(p_last_name),
      v_doc_type, v_doc,
      v_bank, v_account, v_acc_type, v_branch
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
           bank_branch               = excluded.bank_branch
     where a.tutor_id = v_uid;

    -- Se devuelve el resumen ENMASCARADO, no la fila: así el formulario puede
    -- repintar sin volver a consultar, y sigue sin haber un camino por el que un
    -- número de cuenta llegue al navegador.
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
        'updated_at',         a.updated_at
      )
        from public.tutor_payout_accounts a
        join public.payout_banks b
          on b.country = a.country and b.bank_code = a.bank_code
       where a.tutor_id = v_uid
    );
  exception
    when check_violation or not_null_violation or string_data_right_truncation then
      raise exception 'los datos de cobro no tienen el formato que pide %', v_country
        using errcode = 'check_violation';
  end;

end;
$$;

comment on function public.upsert_payout_account(text, text, text, text, text, text, text, text) is
  'Única puerta de escritura de tutor_payout_accounts (la tabla no tiene grant de insert/update para nadie). Valida contra payout_country_rules y, desde 2026-09-01, envuelve el insert para que un check del esquema no devuelva la fila —documento y número de cuenta en claro— al navegador ni al log. Los argumentos de documento y cuenta a null significan «conserva lo guardado», que es lo que permite editar sin reteclear un dato que la pantalla enseña enmascarado.';
