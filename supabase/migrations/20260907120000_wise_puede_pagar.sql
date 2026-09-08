-- ══════════════════════════════════════════════════════════════════════════════
-- WISE DEJA DE SER UN RIEL DECLARADO Y PASA A SER UN RIEL EJECUTABLE
--
-- `payments.ts` declaraba 'wise' con `puedePagar: () => false` desde el
-- 3-sep-2026 y su comentario explicaba por qué: «sin cuenta no hay sandbox con
-- el que probarlos». Esa premisa murió el 4-sep (token vivo) y el 7-sep se midió
-- la API entera contra el perfil business 136151426. Esta migración es la mitad
-- de base de datos de encenderlo.
--
-- 🔴 QUÉ DESCUBRIÓ LA MEDICIÓN, Y POR QUÉ OBLIGA A TOCAR EL ESQUEMA
--
-- `payout_beneficiary` devuelve el cuerpo del POST de dLocal Go. Wise pide otra
-- cosa, y no es una cuestión de nombres: pide DATOS QUE ESTA BASE NO GUARDA.
-- Medido con GET /v1/quotes/{id}/account-requirements, corredor a corredor, el
-- 7-sep-2026: `address.firstLine`, `address.city`, `address.postCode` y
-- `address.country` salen `required: true` en TODAS las monedas probadas (COP,
-- EUR, USD, MXN, ARS, BRL, CLP, UYU, CRC) y en TODOS los tipos de cuenta. Y
-- Colombia exige además `phoneNumber`. En el esquema no había ni una columna de
-- dirección: la búsqueda de `address|city|postal|zip|phone` en
-- `information_schema.columns` devolvía UNA fila en todo el proyecto,
-- `profiles.phone` — que es el teléfono del usuario, no el del beneficiario
-- declarado, y estaba a null en 9 de los 22 tutores de dev.
--
-- ⚠️ Y ESO NO ES SOLO DE WISE. dLocal no puede pagar en PERÚ hoy por la misma
-- carencia: `dlocal-provider.ts:1203-1205` dice literalmente «PERÚ NO PUEDE
-- COBRAR NI CON ESO: exige beneficiary_address_street y _city … que
-- tutor_payout_accounts no guarda». Un bloque de dirección arregla los dos
-- rieles, y por eso las columnas se llaman por lo que SON (la dirección del
-- beneficiario) y no por quién las pidió primero.
--
-- 🔴 EL SEGUNDO DESCUBRIMIENTO: EL CÓDIGO DE BANCO NO SE PUEDE COMPARTIR
--
-- `payout_banks.bank_code` valida `^[0-9A-Za-z]{1,6}$` y para Colombia lleva
-- sembrados los 23 códigos de tres dígitos de la Superintendencia Financiera,
-- que son los de dLocal. Wise usa OTRO espacio de nombres: códigos tipo BIC de
-- ocho caracteres, y solo acepta diez bancos colombianos. Ni siquiera caben en
-- el check. Y como `tutor_payout_accounts` tiene FK compuesta contra esta tabla,
-- lo que el tutor guarda solo puede ser un código de UNA de las dos listas.
--
-- La salida es una columna de traducción, no una tabla nueva ni un catálogo por
-- proveedor: el tutor sigue eligiendo su banco de la lista de siempre (que es la
-- que pinta el formulario) y `wise_bank_code` dice con qué nombre lo conoce
-- Wise, o `null` si Wise no llega a ese banco. Un null aquí no es un hueco que
-- rellenar: es la verdad, y es lo que hace que a un tutor de Itaú Colombia no se
-- le prometa un riel que no puede pagarle.
--
-- ⚠️ BRASIL SE QUEDA FUERA A PROPÓSITO. Sus 803 códigos de Wise son de ocho
-- dígitos (raíz de CNPJ) y los nuestros son los 146 COMPE de tres. No se parecen
-- en nada y emparejarlos por nombre sería inventarse un mapeo que nadie ha
-- verificado — justo lo que la migración del ruteo avisó que no se podía hacer
-- en un riel automático (`20260903140000:243-244`). Brasil sigue cobrando por
-- dLocal, que sí le paga. Encenderlo el día que se verifique es un `update` de
-- esta columna dentro de OTRA migración (regla de oro 5).
--
-- 🔴 EL TERCER DESCUBRIMIENTO: NO TODOS LOS PAÍSES SON PAGABLES, Y NO POR
-- FALTA DE DATOS
--
-- Medido con GET /v1/account-requirements y confirmado creando el quote, que es
-- la prueba dura: USD→VES y USD→PAB devuelven 422 `error.route.not.supported`.
-- **Venezuela no es pagable por Wise ni por SWIFT ni por nada**, así que la fila
-- de VE se queda donde estaba (PayPal / Zelle / Zinli, `20260902110000`).
-- Y PEN, PYG, BOB, DOP y GTQ solo tienen el tipo `swift_code`, que pide
-- BIC del banco del tutor: un dato que no está en ningún catálogo nuestro.
--
-- Por eso `wise_account_type` nace null en todas las filas y se enciende SOLO
-- donde se ha medido que funciona con los datos que ya tenemos: CO, AR, MX, CL y
-- UY. Null no significa «pendiente»: significa que el resolvedor no ofrecerá
-- Wise ahí y la orden caerá al siguiente candidato de la lista, que es
-- exactamente lo que tiene que pasar.
--
-- ⚠️ ESTO NO TOCA `payment_routing_rules`. Las 19 filas que ya listan 'wise'
-- siguen igual. Lo que cambia es que ahora el riel puede decir que sí.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El beneficiario tiene dirección y teléfono ───────────────────────────
--
-- Nullable, y esa es la decisión importante. Ponerlas `not null` obligaría a
-- migrar las filas que ya existen inventándoles una dirección, y dejaría el
-- formulario del tutor roto para los ocho países que hoy cobran por dLocal sin
-- necesitarla. Con null, el que no las tiene simplemente no es pagable por Wise
-- —lo dice `wise_puede_pagar_a()` más abajo— y cobra por donde cobraba.
--
-- ponytail: sin tabla de direcciones ni `country` propio. El país del
-- beneficiario ES `tutor_payout_accounts.country`, que ya está congelado en la
-- fila y que `payout_beneficiary` ya obliga a que coincida con el del payout.
-- Una columna más sería una segunda verdad sobre el mismo hecho.
alter table public.tutor_payout_accounts
  add column beneficiary_address_line text
    check (beneficiary_address_line is null
           or (btrim(beneficiary_address_line) <> ''
               and length(beneficiary_address_line) <= 255)),
  add column beneficiary_city text
    check (beneficiary_city is null
           or (btrim(beneficiary_city) <> '' and length(beneficiary_city) <= 255)),
  add column beneficiary_postcode text
    check (beneficiary_postcode is null
           or (btrim(beneficiary_postcode) <> '' and length(beneficiary_postcode) <= 32)),
  -- Wise lo pide como texto libre de 7 a 20 (medido: `phoneNumber`, minLength 7,
  -- maxLength 20, example "21 5555 5555"). No se normaliza a E.164 porque su
  -- propio ejemplo no lo es y rechazar lo que el proveedor acepta sería inventar
  -- una regla más estricta que la del destinatario.
  add column beneficiary_phone text
    check (beneficiary_phone is null
           or beneficiary_phone ~ '^[0-9+][0-9 ()-]{6,19}$');

comment on column public.tutor_payout_accounts.beneficiary_address_line is
  'Calle y número del beneficiario. Lo exige Wise en TODOS sus corredores (medido 7-sep-2026) y lo exige dLocal en Perú, que hoy no puede pagar por no tenerlo. Nullable: sin él, el tutor cobra por los rieles que no lo piden.';
comment on column public.tutor_payout_accounts.beneficiary_city is
  'Ciudad del beneficiario. Ver beneficiary_address_line.';
comment on column public.tutor_payout_accounts.beneficiary_postcode is
  'Código postal del beneficiario. Wise lo exige (address.postCode, 1..32) incluso en países donde no se usa a diario.';
comment on column public.tutor_payout_accounts.beneficiary_phone is
  'Teléfono del BENEFICIARIO, que no es profiles.phone: aquel es del usuario y está a null en 9 de 22 tutores de dev. Wise lo exige en Colombia (phoneNumber, 7..20).';

-- Los cuatro entran en el grant por columna de `authenticated`, que es lo que
-- permite al formulario releer lo guardado y prerrellenarlo. Siguen fuera, y
-- seguirán, `bank_account` y `beneficiary_document`: la máscara de PII de
-- `20260901160000:1174-1188` no se toca.
grant select (
  beneficiary_address_line,
  beneficiary_city,
  beneficiary_postcode,
  beneficiary_phone
) on public.tutor_payout_accounts to authenticated;

-- ── 2 · El banco, con el nombre que le da Wise ───────────────────────────────
alter table public.payout_banks
  add column wise_bank_code text
    check (wise_bank_code is null or wise_bank_code ~ '^[0-9A-Za-z]{1,11}$');

comment on column public.payout_banks.wise_bank_code is
  'El MISMO banco, con el código que usa Wise. Existe porque los dos espacios de nombres no coinciden: en Colombia el nuestro son los 3 dígitos de la Superintendencia (dLocal) y el de Wise es un BIC de 8. Null = Wise no llega a este banco, y entonces no se le ofrece a ese tutor. Medido contra GET /v1/quotes/{id}/account-requirements el 7-sep-2026.';

-- Colombia: los 10 bancos que acepta Wise, emparejados por nombre uno a uno.
-- El décimo de Wise es NU Colombia (NUCOCOBB) y NO tiene fila en nuestro
-- catálogo, así que se quedan nueve. Los otros 14 códigos colombianos —Itaú,
-- Scotiabank Colpatria, Falabella, Pichincha, Bancoomeva, Mundo Mujer, Banco W,
-- Bancamía, Finandina, Santander, Coopcentral, GNB Sudameris, y Nequi y
-- Daviplata, que en Wise viven en otro tipo de cuenta— se quedan en null.
update public.payout_banks b set wise_bank_code = v.wise
  from (values
    ('001', 'BBOGCOBB'),  -- Banco de Bogotá
    ('002', 'BPOPCOBB'),  -- Banco Popular
    ('007', 'COLOCOBM'),  -- Bancolombia
    ('013', 'GEROCOBB'),  -- BBVA Colombia
    ('023', 'OCCICOBC'),  -- Banco de Occidente
    ('032', 'CASOCOBB'),  -- Banco Caja Social
    ('040', 'CCAICOBB'),  -- Banco Agrario de Colombia
    ('051', 'CAFECOBB'),  -- Davivienda
    ('052', 'BAVICOBB')   -- Banco AV Villas
  ) as v(code, wise)
 where b.country = 'CO' and b.bank_code = v.code;

-- Chile y Uruguay: aquí NO hace falta emparejar por nombre, y comprobarlo es lo
-- que ahorra el trabajo. Wise usa los mismos códigos numéricos que nosotros; lo
-- único que cambia es que los suyos van rellenos a tres dígitos ('016') y los
-- nuestros no ('16'). Se traduce con `lpad`, y el `where` contra la lista
-- medida de Wise es lo que impide encender un banco que Wise no cubre.
update public.payout_banks b set wise_bank_code = lpad(b.bank_code, 3, '0')
 where b.country = 'CL'
   and lpad(b.bank_code, 3, '0') in
       ('001','009','012','014','016','028','031','037','039','041','049','051',
        '053','055','730','732','738','743','875');

-- Uruguay guarda '61' sin relleno y Wise también lo llama '61'; el resto son de
-- tres en las dos listas. Por eso aquí NO se hace `lpad`: rellenaría un código
-- que ya es correcto y lo traduciría a uno que Wise no conoce.
update public.payout_banks b set wise_bank_code = b.bank_code
 where b.country = 'UY'
   and b.bank_code in ('001','61','113','128','137','153','157','162','205','246');

-- ── 3 · El país, y con qué tipo de cuenta le paga Wise ───────────────────────
alter table public.payout_country_rules
  add column wise_account_type text
    check (wise_account_type is null or wise_account_type in
           ('colombia', 'argentina', 'mexican', 'chile', 'uruguay',
            'brazil', 'iban', 'aba', 'swift_code'));

comment on column public.payout_country_rules.wise_account_type is
  'El `type` de recipient que pide Wise para este país, o null si Wise no le paga o si no tenemos los datos que ese tipo exige. Null NO es «pendiente»: es lo que hace que el resolvedor descarte el riel y la orden caiga al siguiente candidato. Venezuela y Panamá no cotizan siquiera (422 error.route.not.supported); PE, PY, BO, DO y GT solo tienen swift_code, que pide un BIC que no está en ningún catálogo nuestro; Brasil usa códigos de banco de 8 dígitos incompatibles con nuestros 146 COMPE.';

update public.payout_country_rules set wise_account_type = 'colombia'  where country = 'CO';
update public.payout_country_rules set wise_account_type = 'argentina' where country = 'AR';
update public.payout_country_rules set wise_account_type = 'mexican'   where country = 'MX';
update public.payout_country_rules set wise_account_type = 'chile'     where country = 'CL';
update public.payout_country_rules set wise_account_type = 'uruguay'   where country = 'UY';
-- BR, EC, PE, PY se quedan en null. Ver la cabecera.

-- ── 4 · ¿Puede Wise pagarle a ESTE tutor? ────────────────────────────────────
--
-- Una sola definición, dos llamadores: `datos_de_cobro_del_tutor` (que es quien
-- decide el riel, antes de tocar nada) y `payout_beneficiary_wise` (que revalida
-- al ejecutar). Escribirla dos veces es escribir el bug: la condición se cambia
-- en un sitio, se olvida en el otro, y el resolvedor elige un riel que el
-- adaptador no puede ejecutar. Eso ya pasó una vez con Venezuela y Zinli, y es
-- justo lo que `rielSirveParaEsteTutor` existe para no repetir.
create or replace function public.wise_puede_pagar_a(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tutor_payout_accounts a
      join public.payout_country_rules  r on r.country = a.country
      left join public.payout_banks     b on b.country = a.country
                                         and b.bank_code = a.bank_code
     where a.tutor_id = p_tutor
       -- El país tiene riel de Wise medido.
       and r.wise_account_type is not null
       -- Los cuatro campos que Wise exige en todos sus corredores.
       and a.beneficiary_address_line is not null
       and a.beneficiary_city         is not null
       and a.beneficiary_postcode     is not null
       -- Y el teléfono, que solo pide Colombia hoy. Se exige igualmente para
       -- todos: pedirlo por país sería una regla que caduca la próxima vez que
       -- Wise cambie un corredor, y el formulario ya lo pregunta.
       and a.beneficiary_phone        is not null
       -- Los tipos que identifican el banco por código necesitan la traducción.
       -- Los otros (argentina = CBU, mexican = CLABE) no miran `payout_banks`.
       and (r.wise_account_type not in ('colombia', 'brazil', 'chile', 'uruguay')
            or b.wise_bank_code is not null)
       -- Argentina: Wise quiere un CBU de 22 dígitos. Un tutor que registró su
       -- ALIAS tiene un dato válido para dLocal e inservible para Wise.
       and (r.wise_account_type <> 'argentina' or a.bank_account_type = 'CBU')
       -- Uruguay: su `idDocumentType` solo admite cédula o RUT. Un pasaporte o
       -- un documento extranjero no tienen equivalente.
       and (r.wise_account_type <> 'uruguay'
            or a.beneficiary_document_type in ('CI', 'RUT'))
  );
$$;

comment on function public.wise_puede_pagar_a(uuid) is
  'La única definición de «Wise puede pagarle a este tutor con lo que tiene registrado». La consultan el resolvedor (vía datos_de_cobro_del_tutor.banco_wise) y el adaptador (vía payout_beneficiary_wise). Que un riel PUEDA pagar y que pueda pagarle A ESTE TUTOR son dos preguntas distintas: confundirlas dejó a un tutor venezolano con Zinli sin cobrar nunca, y en silencio.';

revoke execute on function public.wise_puede_pagar_a(uuid) from public;
revoke execute on function public.wise_puede_pagar_a(uuid) from anon;
revoke execute on function public.wise_puede_pagar_a(uuid) from authenticated;
grant  execute on function public.wise_puede_pagar_a(uuid) to service_role;

-- ── 5 · El ruteo aprende a preguntar por Wise ────────────────────────────────
--
-- Se añade UNA clave. `banco` no se toca y sigue significando lo que significa
-- —hay coordenadas bancarias, que es lo que mira dLocal—, porque un tutor puede
-- tener banco y no ser pagable por Wise, que es el caso normal hoy.
create or replace function public.datos_de_cobro_del_tutor(p_tutor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- Cuenta conectada de Stripe: el riel 'stripe' no puede pagar sin ella.
    'conectada', exists (
      select 1 from public.tutor_profiles tp
       where tp.profile_id = p_tutor and tp.stripe_connect_account_id is not null
    ),
    -- Coordenadas bancarias: las piden dLocal y Wise.
    'banco', exists (
      select 1 from public.tutor_payout_accounts a where a.tutor_id = p_tutor
    ),
    -- ⚠️ Y Wise pide MÁS que coordenadas: dirección, teléfono, un país que
    -- cubra y un banco que conozca. Sin esta clave aparte, el resolvedor elegiría
    -- Wise para cualquiera que tuviese banco y el adaptador devolvería
    -- 'sin-datos' para siempre — la orden ni pagaría ni fallaría.
    'banco_wise', public.wise_puede_pagar_a(p_tutor),
    -- Los canales de identificador que tenga registrados. 'paypal' es uno más
    -- de esta lista.
    'canales', coalesce(
      (select array_agg(d.channel order by d.channel)
         from public.tutor_manual_payout_destinations d
        where d.tutor_id = p_tutor),
      array[]::text[]
    )
  );
$$;

comment on function public.datos_de_cobro_del_tutor(uuid) is
  'Qué datos de cobro tiene un tutor, en la forma mínima que el ruteo necesita: tres booleanos y la lista de canales. La usa payoutProviderFor para no elegir un riel que ese tutor no puede usar. ''banco'' es «tiene coordenadas» (dLocal); ''banco_wise'' es «esas coordenadas le sirven a Wise», que es más estrecho y por eso va aparte.';

revoke execute on function public.datos_de_cobro_del_tutor(uuid) from public;
revoke execute on function public.datos_de_cobro_del_tutor(uuid) from anon;
revoke execute on function public.datos_de_cobro_del_tutor(uuid) from authenticated;
grant  execute on function public.datos_de_cobro_del_tutor(uuid) to service_role;

-- ── 6 · El beneficiario, con forma de Wise ───────────────────────────────────
--
-- Función hermana de `payout_beneficiary`, no un parámetro suyo. Es el patrón
-- que ya siguieron los otros dos rieles remotos: Connect trajo
-- `destino_connect(uuid)` y PayPal `payout_identifier_beneficiary(uuid, text)`.
-- Cada riel se trae su puerta, y la de dLocal se queda intacta.
--
-- 🔴 POR QUÉ EXISTE Y NO SE PUEDE RODEAR: `service_role` NO tiene select sobre
-- `tutor_payout_accounts` (medido: solo REFERENCES), y las columnas
-- `bank_account` y `beneficiary_document` no están ni en el grant de
-- `authenticated`. Un adaptador que intente `.from('tutor_payout_accounts')`
-- muere con 42501 en tiempo de ejecución, no en el typecheck (regla de oro 9).
-- Esta función `security definer` es la ÚNICA vía legítima al número de cuenta.
--
-- ⚠️ NO devuelve el importe, igual que su hermana y por lo mismo: el importe
-- sale de `payouts.gross_amount`/`amount` server-side y jamás de aquí.
create or replace function public.payout_beneficiary_wise(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.payouts%rowtype;
  v_acc    public.tutor_payout_accounts%rowtype;
  v_rules  public.payout_country_rules%rowtype;
  v_bank   public.payout_banks%rowtype;
  v_error  text;
begin
  select * into v_payout from public.payouts p where p.id = p_payout_id;
  if not found then
    raise exception 'no existe ese payout' using errcode = 'no_data_found';
  end if;
  if v_payout.status not in ('scheduled'::public.payout_status,
                             'processing'::public.payout_status) then
    raise exception 'el payout está en % y no se puede ejecutar', v_payout.status
      using errcode = 'check_violation';
  end if;
  if v_payout.payee_country is null then
    raise exception 'el payout no tiene país de destino: no se puede pagar'
      using errcode = 'check_violation';
  end if;

  select * into v_acc from public.tutor_payout_accounts a where a.tutor_id = v_payout.tutor_id;
  if not found then
    raise exception 'el tutor no ha registrado sus datos de cobro'
      using errcode = 'no_data_found';
  end if;
  if v_acc.country <> v_payout.payee_country then
    raise exception 'los datos de cobro del tutor son de % y el payout es a %',
      v_acc.country, v_payout.payee_country using errcode = 'check_violation';
  end if;

  -- La misma revalidación que hace la hermana. Los datos son los mismos datos:
  -- que Wise los lea distinto no los hace válidos de otra manera.
  v_error := public.payout_account_check(
    v_acc.country, v_acc.beneficiary_document_type, v_acc.beneficiary_document,
    v_acc.bank_code, v_acc.bank_account_type, v_acc.bank_account, v_acc.bank_branch
  );
  if v_error is not null then
    raise exception 'los datos de cobro del tutor ya no son válidos: %', v_error
      using errcode = 'check_violation';
  end if;

  -- Y la pregunta que solo se hace este riel. Va DESPUÉS de las comunes para que
  -- el mensaje que llegue al log sea el más específico de los que apliquen.
  if not public.wise_puede_pagar_a(v_payout.tutor_id) then
    raise exception 'los datos de cobro del tutor no le sirven a wise'
      using errcode = 'check_violation';
  end if;

  select * into v_rules from public.payout_country_rules r where r.country = v_acc.country;
  select * into v_bank  from public.payout_banks b
   where b.country = v_acc.country and b.bank_code = v_acc.bank_code;

  return jsonb_build_object(
    -- Lo que Wise llama `type` en POST /v1/accounts. Manda sobre la forma de
    -- `details`, y por eso viaja: el adaptador no deduce el tipo del país.
    'wise_account_type',   v_rules.wise_account_type,
    'transfer_country',    v_acc.country,
    'currency_to_pay',     v_rules.currency,
    -- Wise exige nombre Y apellido en un solo campo (medido: "Zzz" solo devuelve
    -- 422 «Please enter the recipients first and last name»). Se compone aquí
    -- para que el adaptador no tenga que saberlo.
    'account_holder_name', v_acc.beneficiary_first_name || ' ' || v_acc.beneficiary_last_name,
    -- ponytail: constante, no columna. Los tutores son personas físicas, y el
    -- corredor colombiano ni siquiera admite otra cosa (legalType valuesAllowed
    -- = [PRIVATE], medido). El día que haya tutores empresa, sale de aquí.
    'legal_type',          'PRIVATE',
    'wise_bank_code',      v_bank.wise_bank_code,
    'bank_account',        v_acc.bank_account,
    'bank_account_type',   v_acc.bank_account_type,
    'document_type',       v_acc.beneficiary_document_type,
    'document',            v_acc.beneficiary_document,
    'phone',               v_acc.beneficiary_phone,
    'address', jsonb_build_object(
      'country',   v_acc.country,
      'city',      v_acc.beneficiary_city,
      'firstLine', v_acc.beneficiary_address_line,
      'postCode',  v_acc.beneficiary_postcode
    )
  );
end;
$$;

comment on function public.payout_beneficiary_wise(uuid) is
  'El beneficiario de un payout con la forma que pide Wise, que no es la de dLocal. Hermana de payout_beneficiary y por el mismo motivo que destino_connect y payout_identifier_beneficiary: cada riel remoto se trae su puerta. Revalida al ejecutar (no solo al guardar) y NO devuelve el importe. Sus excepciones son el vocabulario que el adaptador traduce a ''sin-datos''.';

revoke execute on function public.payout_beneficiary_wise(uuid) from public;
revoke execute on function public.payout_beneficiary_wise(uuid) from anon;
revoke execute on function public.payout_beneficiary_wise(uuid) from authenticated;
grant  execute on function public.payout_beneficiary_wise(uuid) to service_role;

-- ── 7 · Autocomprobaciones ───────────────────────────────────────────────────
--
-- El patrón de `20260903210000`: una migración que toca dinero se comprueba a sí
-- misma. Un `create or replace` valida la sintaxis, no el sentido, y un grant
-- olvidado no falla hasta que el job corre en producción (regla de oro 9).
do $$
begin
  if has_function_privilege('authenticated',
       'public.payout_beneficiary_wise(uuid)', 'execute') then
    raise exception 'payout_beneficiary_wise es ejecutable por authenticated (fuga de PII)';
  end if;
  if not has_function_privilege('service_role',
       'public.payout_beneficiary_wise(uuid)', 'execute') then
    raise exception 'service_role no puede ejecutar payout_beneficiary_wise (regla de oro 9)';
  end if;
  if not has_function_privilege('service_role',
       'public.wise_puede_pagar_a(uuid)', 'execute') then
    raise exception 'service_role no puede ejecutar wise_puede_pagar_a (regla de oro 9)';
  end if;
  if not has_function_privilege('service_role',
       'public.datos_de_cobro_del_tutor(uuid)', 'execute') then
    raise exception 'service_role perdió el execute de datos_de_cobro_del_tutor';
  end if;

  -- El ruteo tiene que devolver la clave nueva, o `payoutProviderFor` leería
  -- `undefined` y descartaría Wise para todo el mundo sin decir nada.
  if not (public.datos_de_cobro_del_tutor('00000000-0000-0000-0000-000000000000'::uuid)
          ? 'banco_wise') then
    raise exception 'datos_de_cobro_del_tutor no devuelve banco_wise';
  end if;

  -- Y los mapeos tienen que haber entrado. Si un `update` no encuentra su fila
  -- no falla: deja la columna a null y Wise deja de ofrecerse en ese país en
  -- silencio, que es el fallo que más cuesta ver.
  if (select count(*) from public.payout_banks
       where country = 'CO' and wise_bank_code is not null) <> 9 then
    raise exception 'Colombia no quedó con 9 bancos mapeados a Wise';
  end if;
  if (select count(*) from public.payout_banks
       where country = 'CL' and wise_bank_code is not null) = 0 then
    raise exception 'Chile no mapeó ningún banco a Wise';
  end if;
  if (select count(*) from public.payout_banks
       where country = 'UY' and wise_bank_code is not null) = 0 then
    raise exception 'Uruguay no mapeó ningún banco a Wise';
  end if;
  if (select count(*) from public.payout_country_rules
       where wise_account_type is not null) <> 5 then
    raise exception 'no quedaron exactamente 5 países con riel de Wise';
  end if;
  -- Brasil NO se enciende, y que siga apagado es parte del contrato: sus códigos
  -- son de otro espacio de nombres y encenderlo sin verificarlos pagaría al
  -- banco equivocado.
  if (select wise_account_type from public.payout_country_rules where country = 'BR')
     is not null then
    raise exception 'Brasil quedó con riel de Wise sin haber verificado sus códigos';
  end if;
end $$;
