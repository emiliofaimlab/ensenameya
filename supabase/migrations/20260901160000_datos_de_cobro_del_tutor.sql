-- ============================================================================
-- Enséñame Ya — B1 · los datos con los que se le paga al tutor.
--
-- dLocal Go **no guarda beneficiarios**. `POST /v1/payouts` no acepta un token
-- ni un id de beneficiario: el nombre, el documento fiscal y las coordenadas
-- bancarias viajan ENTEROS en cada llamada. Eso no es un detalle de integración,
-- es lo que decide dónde vive esta PII — y como no la guarda el proveedor, la
-- tiene que guardar esta base de datos.
--
-- ── LO PRIMERO, PORQUE ES LO QUE MÁS FÁCIL SE ROMPE ─────────────────────────
--
-- ESTOS DATOS NO PUEDEN IR EN `tutor_profiles`. Comprobado hoy contra dev, con
-- la ANON key y sin sesión:
--
--   GET /rest/v1/tutor_profiles?select=*&limit=1  → 200, y devuelve las 19
--   columnas de un tutor aprobado, `payout_country` incluida.
--
-- Son dos piezas que se suman y ninguna de las dos filtra columnas:
--   · `20260706120000:171` → `grant select on public.tutor_profiles to anon`,
--     que es de TABLA: cubre lo de hoy y lo que se añada mañana.
--   · `20260706120000:119` → `tutor_profiles_select_public` filtra FILAS
--     (`approval_status = 'approved'`), no columnas: la fila sale entera.
--
-- Una columna `bank_account` ahí sería un número de cuenta publicado en la ficha
-- pública el mismo segundo, sin que nadie tocara una política. La nota de A0
-- (`20260901140000:153-161`) ya lo dejó escrito como la frontera que B1 no puede
-- cruzar. Aquí se cumple: tabla propia, default-deny, sin `anon` en los grants.
--
-- ── LAS TRES TABLAS Y POR QUÉ SON TRES ──────────────────────────────────────
--
--   1. `payout_country_rules` — qué exige dLocal Go en cada uno de los 8 países.
--      Pública para quien tenga sesión: es documentación, no PII.
--   2. `payout_banks`         — los 612 `bank_code` válidos, por país. Idem.
--   3. `tutor_payout_accounts`— la PII. Sin grants de escritura para NADIE, con
--      lectura por columnas y enmascarada, y sin `service_role`.
--
-- La separación no es estética: 1 y 2 son la VALIDACIÓN, y tienen que poder
-- leerse desde el formulario del tutor para que el formulario se dibuje solo.
-- Si vivieran dentro de la tabla de PII, enseñar la lista de bancos obligaría a
-- abrir la tabla de los IBANes.
--
-- ── POR QUÉ COLUMNAS Y NO jsonb ─────────────────────────────────────────────
--
-- Porque el conjunto de campos NO varía por país: los 8 mandan exactamente
-- `beneficiary_first_name`, `beneficiary_last_name`, `beneficiary_document` +
-- `_document_type`, `bank_code`, `bank_account`, `bank_branch` y
-- `bank_account_type`. Lo que varía es el FORMATO de cada uno, y eso vive en la
-- tabla de reglas, que es donde se puede cambiar sin migración.
--
-- Un jsonb daría lo contrario de lo que hace falta: perdería los `check`, los
-- column-grants (que es justo el mecanismo que aquí enmascara la lectura), la
-- columna generada del `····1234` y la FK contra el catálogo de bancos — y
-- seguiría necesitando un validador, solo que sin red debajo.
--
-- ¿Y el país que no usa un campo? La columna es NULLABLE y quien decide si hace
-- falta es la fila de reglas (`requires_branch`, `account_types = '{}'`), no el
-- esquema. Argentina no manda sucursal porque el CBU ya la lleva dentro; México
-- tampoco, porque la CLABE también. Ponerlas `not null` sería congelar en el
-- esquema una duda que la propia documentación de dLocal no resuelve (ver
-- `requires_branch`, abajo).
--
-- ── LO QUE NO SE GUARDA, Y POR QUÉ ──────────────────────────────────────────
--
--   · `purpose` → constante `OTHER_SERVICES` ("Purchase sale of services").
--     No es un dato del tutor: es lo que SIEMPRE somos nosotros pagando una
--     mentoría. Ojo, `TUITION_COSTS` es la dirección contraria (alumno paga
--     matrícula), y un purpose inválido se retiene por compliance.
--   · `flow_type` → siempre `B2C` (empresa → persona). Tampoco es del tutor.
--   · `transfer_amount` / `transfer_country` → salen del payout.
--   · `beneficiary_email` → opcional en dLocal; no lo pedimos. El correo vive en
--     `auth.users` y copiarlo aquí sería duplicar PII para un campo opcional.
--   · `beneficiary_address_street` / `_city` → la doc dice «required only for
--     some country/flow combinations» y NUNCA dice cuáles. Pedir una dirección
--     por si acaso es pedir PII que quizá nunca se manda.
--   · `currency_to_pay` → sale de la fila de reglas, no del tutor: no es una
--     elección suya. ⚠️ Y NO es `payouts.currency`: el saldo del tutor está en
--     USD y `currency_to_pay` es la moneda del PAÍS (ARS, BRL, …). Solo coinciden
--     en Ecuador. Quién hace la conversión es problema abierto de A2, y por eso
--     `payout_beneficiary` NO devuelve importe: devuelve beneficiario.
--
-- ── FUENTE ──────────────────────────────────────────────────────────────────
-- docs.dlocalgo.com/integration-api/…/payouts-integration y sus 8 páginas de
-- país, verificadas el 1-sep-2026 contra el export oficial `llms-full.txt`.
-- Lo que la documentación NO dice está marcado país por país en `notas`, que es
-- la lista de lo que hay que probar en el sandbox antes de mandar dinero.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `payout_country_rules` — qué exige dLocal Go en cada país
-- ════════════════════════════════════════════════════════════════════════════
--
-- REGLAS COMO DATO, no como código. Mismo criterio que `payment_routing_rules`:
-- abrir un país nuevo, o corregir un formato que dLocal cambie, tiene que ser un
-- `insert`/`update` y no un despliegue. Y hay una razón concreta y cercana: el
-- campo `bank_branch` figura como obligatorio en la tabla global de parámetros
-- pero solo BR y UY documentan qué poner. El día que el sandbox diga que AR
-- también lo exige, el arreglo es `update … set requires_branch = true` y el
-- formulario del tutor pide un campo más solo. Si eso fuera un `check` o un
-- `case` de plpgsql, sería una migración y un despliegue.
--
-- Los dos jsonb tienen la MISMA forma: `{"tipo": "regex"}`. En
-- `document_patterns` la clave es el `beneficiary_document_type`; en
-- `account_patterns` es el `bank_account_type`, o `"*"` cuando el país tiene un
-- único formato de cuenta y no distingue tipos (CLABE, SIPAP, CCI). Las claves
-- son ADEMÁS la lista de valores admitidos: un tipo que no está en el objeto es
-- un tipo que no se acepta.
create table public.payout_country_rules (
  country           char(2)     primary key
                    check (country ~ '^[A-Z]{2}$'),
  -- `currency_to_pay`. Uno por país; el multimoneda (PY, PE y UY documentan
  -- soporte USD por banco) NO se modela: la doc no dice qué literal acepta
  -- `currency_to_pay` en ese caso, y adivinarlo es un payout retenido.
  currency          char(3)     not null check (currency ~ '^[A-Z]{3}$'),

  -- Etiqueta y ayuda del campo de cuenta EN EL FORMULARIO. Viven aquí y no en el
  -- TSX por lo mismo que la lista de países de A0 vive en la tabla de ruteo: si
  -- el texto que lee el tutor y la regla que valida su cuenta están en ficheros
  -- distintos, se desincronizan y el que se entera es él, tres semanas después.
  account_label     text        not null,
  account_help      text        not null,

  -- Subconjunto del enum global `bank_account_type` (CHECKING, SAVINGS, SALARY,
  -- VISTA, MASTER, MAESTRA, ALIAS, CBU) que este país admite. `'{}'` = la doc no
  -- lo desglosa → no se le pregunta al tutor y no se manda.
  account_types     text[]      not null default '{}',

  -- `{"<account_type>": "<regex>"}`, o `{"*": "<regex>"}` si el país tiene un
  -- formato único. `'{}'` = formato NO documentado (CL, EC, y BR/UY donde
  -- depende del banco) → solo se aplica el `check` genérico de la tabla.
  account_patterns  jsonb       not null default '{}'::jsonb
                    check (jsonb_typeof(account_patterns) = 'object'),

  -- `{"<document_type>": "<regex>"}`. Nunca vacío: sin tipo de documento no hay
  -- payout posible, así que un país sin esto no debería estar en la tabla.
  document_patterns jsonb       not null
                    check (jsonb_typeof(document_patterns) = 'object'
                           and document_patterns <> '{}'::jsonb),

  requires_branch   boolean     not null default false,
  branch_pattern    text,

  -- Qué dice la documentación y qué queda por probar en el sandbox. Se lee desde
  -- SQL, no desde un comentario, para que quien abra la cuenta de dLocal Go
  -- tenga la lista delante sin abrir el repositorio.
  notas             text        not null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger payout_country_rules_set_updated_at
  before update on public.payout_country_rules
  for each row execute function public.set_updated_at();

comment on table public.payout_country_rules is
  'Qué exige dLocal Go (POST /v1/payouts, flow B2C) en cada uno de los 8 países que sirve: AR, BR, CL, EC, MX, PE, PY, UY. NO cubre VE ni CO. Es la fuente de verdad de la validación (la usa payout_account_check) Y del formulario de /tutor/payouts, a propósito: si el texto que lee el tutor y la regla que le valida la cuenta viven en ficheros distintos, se desincronizan. No es PII: es documentación de dLocal transcrita, y por eso authenticated puede leerla.';

comment on column public.payout_country_rules.currency is
  'currency_to_pay del POST. ⚠️ NO es payouts.currency: el saldo del tutor está en USD y esto es la moneda del país de destino (ARS, BRL, CLP, MXN, PEN, PYG, UYU; solo EC coincide, que es USD nativo). La conversión es problema abierto de A2. El soporte multimoneda que PY/PE/UY documentan por banco no se modela: la doc no dice qué literal acepta currency_to_pay en ese caso.';

comment on column public.payout_country_rules.account_patterns is
  'Mapa {tipo_de_cuenta: regex} para bank_account. La clave es un bank_account_type, o "*" cuando el país tiene formato único (CLABE en MX, SIPAP en PY, CCI en PE). Objeto vacío = dLocal NO documenta el formato (CL y EC no tienen sección de validación de cuenta; BR y UY lo documentan por banco, uno a uno, y eso no cabe en una regex por país) → solo aplica el check genérico de tutor_payout_accounts. NO se validan dígitos verificadores: la doc dice "apply verification algorithm" sin publicar el algoritmo (CLABE, RUC de EC y de PY), y un algoritmo inventado rechaza cuentas buenas. Ese chequeo lo hace dLocal en el POST y vuelve como REJECTED.';

comment on column public.payout_country_rules.document_patterns is
  'Mapa {tipo_de_documento: regex} para beneficiary_document, y a la vez la lista cerrada de tipos admitidos. ⚠️ Donde las dos tablas oficiales del mismo país se contradicen (PY: "CI entre 5 y 20 dígitos" en Country reference contra "CI = 7 numérico" en Document validations; EC igual con CI), se toma LA PERMISIVA a propósito: un rechazo falso nuestro es un tutor que no puede cobrar y no tiene a quién reclamar, mientras que un dato que dLocal rechace vuelve como REJECTED, con motivo y con el beneficiario intacto para corregirlo.';

comment on column public.payout_country_rules.requires_branch is
  '⚠️ EL HUECO MÁS PELIGROSO DE ESTA TABLA. La tabla global de parámetros de dLocal marca bank_branch como Required: Yes SIN excepción, pero solo BR y UY documentan qué poner: AR (CBU de 22), MX (CLABE de 18) y PE (CCI de 20) usan cuentas que ya llevan banco y sucursal codificados dentro, y no hay sucursal que mandar. Aquí está a false para esos cinco países porque pedir un dato que no existe es peor que no pedirlo, PERO no está probado: hay que verificarlo en el sandbox país por país antes de mandar el primer payout. Si resulta que sí lo exige, el arreglo es un UPDATE de esta columna — no una migración.';

comment on column public.payout_country_rules.notas is
  'Lo que la documentación de dLocal Go dice y lo que NO dice, por país. Es la lista de lo que hay que probar en el sandbox (api-sbx.dlocalgo.com) antes de que se mueva dinero de verdad.';

-- ── RLS + grants ────────────────────────────────────────────────────────────
-- Default-deny (regla de oro 1) y luego se abre lo justo. Esto es documentación
-- pública de dLocal, no PII, así que `authenticated` la lee entera: la necesita
-- para dibujar el formulario. `anon` NO, no porque el dato sea secreto sino
-- porque nadie sin sesión tiene nada que hacer aquí, y en este proyecto una
-- superficie anónima de más es la que se olvida (regla de oro 1).
-- `service_role` tampoco: quien la lee del lado servidor es
-- `payout_account_check`, que corre como SECURITY DEFINER.
alter table public.payout_country_rules enable row level security;

create policy "payout_country_rules_select_auth"
  on public.payout_country_rules for select
  to authenticated
  using ( true );

grant select on public.payout_country_rules to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · `payout_banks` — los `bank_code` que dLocal Go acepta, por país
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ NO HAY ENDPOINT PARA ESTO. La sección de payouts de dLocal Go no tiene
-- `GET /v1/banks` ni forma de validar una cuenta antes de mandar el dinero: las
-- listas son TABLAS ESTÁTICAS en la documentación, y mantenerlas es nuestro. La
-- única validación real ocurre en el `POST`, y el fallo llega como `REJECTED`
-- por webhook — es decir, semanas después y con el tutor sin cobrar.
--
-- Por eso se siembran las 612 filas y por eso el formulario es un desplegable y
-- no un campo de texto: un `bank_code` tecleado a mano es la causa número uno de
-- un payout rechazado, y es un error que nadie descubre hasta que ya pasó.
--
-- Las filas NO se borran nunca, se desactivan (`is_active = false`): hay tutores
-- apuntando a ellas por FK, y borrar el banco de alguien es dejarle sin cobrar
-- por un cambio de configuración que él no hizo.
create table public.payout_banks (
  country     char(2)     not null references public.payout_country_rules (country),
  -- Texto, NUNCA entero. Los códigos llevan ceros a la izquierda que son parte
  -- del valor: '001' en Perú, '018' en Brasil, '094' en Argentina. Guardarlos
  -- como número los convierte en 1, 18 y 94, y dLocal no los reconoce.
  bank_code   text        not null check (bank_code ~ '^[0-9A-Za-z]{1,6}$'),
  name        text        not null check (btrim(name) <> ''),

  -- ⚠️ Brasil, y es fácil de pasar por alto: ocho códigos rechazan el payout si
  -- el `beneficiary_document` es un CPF (solo aceptan CNPJ). Para un mentor
  -- persona física esos ocho bancos están vetados, y el rechazo llega DESPUÉS.
  --
  -- Y hay una trampa dentro de la trampa: la doc escribe esa lista SIN ceros
  -- —«18, 66, 78, 139, 241, 477, 739, 745»— mientras que la tabla de códigos de
  -- Brasil los da con tres dígitos ('018', '066', '078'). Quien cruce las dos
  -- listas literalmente deja TRES de los ocho sin marcar, y no se entera.
  rejects_cpf boolean     not null default false,

  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (country, bank_code)
);

-- Sin índice extra, y conviene decir por qué para que no se añada por reflejo:
-- la PK es `(country, bank_code)` y su índice ya tiene `country` de primera
-- columna, así que el `where country = 'MX'` del desplegable ya sale por ahí.
-- Un índice por `country` sería el mismo índice otra vez. (Mismo criterio que
-- `20260901140000` con `payout_country`.)

create trigger payout_banks_set_updated_at
  before update on public.payout_banks
  for each row execute function public.set_updated_at();

comment on table public.payout_banks is
  'Valores válidos de bank_code por país, transcritos de la documentación de dLocal Go (1-sep-2026). NO hay endpoint que los sirva ni que valide una cuenta: se mantienen a mano y la única validación real ocurre en el POST /v1/payouts, cuyo fallo vuelve como REJECTED por webhook. Los códigos son TEXTO porque los ceros a la izquierda son parte del valor. Las filas no se borran (hay FK desde tutor_payout_accounts): se ponen is_active = false.';

comment on column public.payout_banks.rejects_cpf is
  'Brasil: ocho códigos (018, 066, 078, 139, 241, 477, 739, 745) rechazan el payout si beneficiary_document es un CPF; solo aceptan CNPJ. Un mentor persona física no puede usarlos. ⚠️ La documentación escribe esa lista sin ceros a la izquierda mientras que su propia tabla de códigos los lleva: cruzarlas literalmente deja 018, 066 y 078 sin marcar.';

comment on column public.payout_banks.name is
  'Nombre del banco tal y como lo publica dLocal, para el desplegable. Si dos códigos iguales traen nombres distintos en la misma tabla oficial —pasa en Perú con el 043, "Crediscotia Financiera" y "Tarjetas Peruanas Prepago"— se fusionan con " / ": el bank_code que viaja a dLocal es el mismo, y el tutor tiene que poder encontrar el suyo buscando cualquiera de los dos nombres.';

-- ── RLS + grants: igual que las reglas. Catálogo público-con-sesión. ────────
alter table public.payout_banks enable row level security;

create policy "payout_banks_select_auth"
  on public.payout_banks for select
  to authenticated
  using ( is_active );

grant select on public.payout_banks to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Siembra de las reglas — 8 países
-- ════════════════════════════════════════════════════════════════════════════
--
-- Los 8 coinciden exactamente con las filas de `payment_routing_rules` que A0
-- sembró con `payout_provider = 'dlocal'` (las otras dos son VE y la del tutor
-- sin país, ambas 'simulated'), y con lo que `payoutCountries()` ofrece hoy en
-- el desplegable. No es casualidad: es la misma frontera, escrita dos veces
-- porque responde a dos preguntas distintas —«¿se puede vender?» y «¿qué campos
-- pido?»— y la segunda no cabe en una tabla de ruteo.
--
-- ⚠️ Los literales del enum `beneficiary_document_type` solo están PROBADOS por
-- ejemplo funcional en dos casos: `RUT` (UY) y `CPF` (BR). El resto —CUIT, CUIL,
-- CNPJ, CURP, RFC, DNI, RUC, CI, CE, PASS, DE— salen del NOMBRE de las tablas de
-- validación, no de un request de ejemplo. Argentina es el dudoso: la doc
-- escribe «CUIT or CUIL» junto y no dice si el enum tiene dos valores o uno.
-- Aquí se admiten los dos; si el sandbox dice que solo hay uno, es un UPDATE.
insert into public.payout_country_rules
  (country, currency, account_label, account_help,
   account_types, account_patterns, document_patterns,
   requires_branch, branch_pattern, notas)
values
  ('AR', 'ARS',
   'CBU o alias',
   'El CBU son 22 dígitos. El alias son entre 6 y 20 caracteres y admite puntos y guiones. Elige arriba cuál de los dos estás poniendo.',
   array['CBU', 'ALIAS'],
   '{"CBU": "^[0-9]{22}$", "ALIAS": "^[A-Za-z0-9.-]{6,20}$"}'::jsonb,
   '{"CUIT": "^[0-9]{11}$", "CUIL": "^[0-9]{11}$"}'::jsonb,
   false, null,
   'Documentado: CBU 22 numérico, ALIAS 6-20 alfanumérico con . y -, documento CUIT/CUIL de 11 dígitos, 66 bank codes (ojo: "CVU Account" es el 000). SIN DOCUMENTAR: bank_branch (el CBU ya lleva banco y sucursal dentro) y bank_account_type — aquí se usan CBU/ALIAS, que son valores del enum global, porque es lo único que distingue los dos formatos. Por probar en sandbox: si CUIT y CUIL son dos literales o uno solo, y si bank_branch se omite o se manda vacío.'),

  ('BR', 'BRL',
   'Conta bancária',
   'El formato depende de tu banco, con o sin guion (Itaú 12345-6, Bradesco 1234567-8…). Copia el número tal y como te lo da el banco. La agência va aparte.',
   array['CHECKING', 'SAVINGS'],
   '{}'::jsonb,
   '{"CPF": "^[0-9]{11}$", "CNPJ": "^[0-9]{14}$"}'::jsonb,
   true, '^[0-9A-Za-z-]{4,7}$',
   'Documentado: CPF 11 y CNPJ 14 numéricos (dígito verificador en los dos últimos), bank_branch obligatorio con formato por banco (XXXX, XXXXD, XXXX-D, XXXXDD, XXXX-DD), formato de cuenta por banco (7 bancos + "otros" + Pix), 146 bank codes COMPE, y OCHO códigos que rechazan CPF. account_patterns se deja vacío a propósito: el formato es por banco y no cabe en una regex por país; lo valida dLocal. Por probar: si Pix necesita algún campo distinto (su fila dice "No format validation").'),

  ('CL', 'CLP',
   'Número de cuenta',
   'El número de tu cuenta, sin puntos ni guiones. Elige arriba si es corriente, de ahorro o vista.',
   array['CHECKING', 'SAVINGS', 'VISTA'],
   '{}'::jsonb,
   '{"RUT": "^[0-9A-Z]{8,9}$"}'::jsonb,
   false, null,
   'Documentado: RUT de 8 o 9 caracteres ALFANUMÉRICOS (alfanumérico por la K del dígito verificador; un check numérico lo rechazaría), los tres bank_account_type que admite Chile —es el ÚNICO país que publica su subconjunto— y 20 bank codes. SIN DOCUMENTAR: el formato de bank_account; Chile y Ecuador son los dos países donde no hay sección de validación de cuenta y no se puede escribir una regex.'),

  ('EC', 'USD',
   'Número de cuenta',
   'El número de tu cuenta en el banco, sin puntos ni guiones.',
   '{}'::text[],
   '{}'::jsonb,
   '{"CI": "^[0-9]{5,20}$", "RUC": "^[0-9]{13}$", "PASS": "^[0-9A-Z]{7,12}$"}'::jsonb,
   false, null,
   'Único país de los ocho cuya moneda es USD, o sea el único donde currency_to_pay coincide con payouts.currency y no hace falta conversión. ⚠️ CONTRADICCIÓN OFICIAL: Country reference dice "CI entre 5 y 20 dígitos" y Document validations dice "CI 10 numérico con dígito verificador". Se toma la permisiva (5-20). SIN DOCUMENTAR: formato de bank_account y bank_account_type. La lista de 213 códigos dice "This list includes the MAIN banks", así que puede estar incompleta: si un tutor no encuentra su cooperativa, se añade la fila.'),

  ('MX', 'MXN',
   'CLABE',
   'La CLABE son 18 dígitos. No es el número de tu tarjeta ni el número corto de cuenta: te la da tu banco en la app o en el estado de cuenta.',
   '{}'::text[],
   '{"*": "^[0-9]{18}$"}'::jsonb,
   '{"CURP": "^[0-9A-Z]{10,18}$", "RFC": "^[0-9A-Z]{12,13}$"}'::jsonb,
   false, null,
   'Documentado: CLABE de 18 numérico, CURP de 10 a 18 caracteres, RFC de 12 o 13, 88 bank codes. La CLABE lleva banco y plaza dentro, así que no hay bank_branch que mandar. NO se valida el dígito verificador de la CLABE: la doc dice "apply verification algorithm" y no publica cuál. SIN DOCUMENTAR: bank_account_type.'),

  ('PY', 'PYG',
   'Cuenta SIPAP',
   'Son 16 dígitos. Es el número de cuenta que usa el sistema SIPAP, te lo da tu banco.',
   '{}'::text[],
   '{"*": "^[0-9]{16}$"}'::jsonb,
   '{"CI": "^[0-9]{5,20}$", "RUC": "^[0-9]{5,20}$"}'::jsonb,
   false, null,
   '⚠️ CONTRADICCIÓN OFICIAL, y en la MISMA página: Country reference dice "CI entre 5 y 20 dígitos"; Document validations dice CI = 7 numérico y RUC = 8 numérico. Son incompatibles y las dos son oficiales. Se toma la permisiva (5-20) para las dos, porque rechazar aquí deja al tutor sin cobrar y sin recurso. Documentado sí: cuenta SIPAP de 16 numérico y 37 bank codes, que la doc dice que valen "para cuentas en PYG así como USD" — el multimoneda no se modela (no dice qué literal acepta currency_to_pay).'),

  ('PE', 'PEN',
   'CCI',
   'El CCI son 20 dígitos: es el código interbancario, no el número de cuenta corto. Lo encuentras en la app de tu banco como "código interbancario" o "CCI".',
   '{}'::text[],
   '{"*": "^[0-9]{20}$"}'::jsonb,
   '{"DNI": "^([0-9]{8}|[0-9A-Z]{9})$", "RUC": "^[0-9]{11}$", "CE": "^[0-9A-Z]{4,12}$", "PASS": "^[0-9A-Z]{4,12}$"}'::jsonb,
   false, null,
   'Documentado: CCI de 20 numérico —sus 3 primeros dígitos SON el bank_code y los 2 últimos el verificador—, DNI de 8 numérico o 9 alfanumérico, RUC de 11, CE y PASS de 4 a 12, y 28 bank codes con columna de soporte PEN/USD (el multimoneda no se modela). Ojo: la tabla oficial repite el código 043 con dos nombres distintos, fusionados en la siembra. Como los 3 primeros dígitos del CCI son el banco, se podría cruzar con bank_code — NO se hace: los códigos de la tabla no siempre son de 3 dígitos y la doc no promete esa correspondencia.'),

  ('UY', 'UYU',
   'Número de cuenta',
   'El formato depende de tu banco: BROU 14 dígitos, Itaú 7, Santander 12, BBVA hasta 9… Cópialo tal cual, con los ceros de delante si los tiene. La sucursal va aparte.',
   array['CHECKING'],
   '{}'::jsonb,
   '{"CI": "^[0-9]{8}$", "RUT": "^[0-9]{12}$", "DE": "^[0-9]{1,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[0-9A-Za-z-]{1,10}$',
   'El país mejor documentado: formato de cuenta banco a banco (13 bancos), CI de 8 y RUT de 12 con verificador, 15 bank codes con soporte UYU/USD, y bank_branch con ejemplo oficial ("67"). account_patterns vacío porque el formato es por banco. ⚠️ account_types se queda en CHECKING SOLO: es el único valor que aparece en el ejemplo oficial de Uruguay. SAVINGS existe en el enum global pero no está confirmado para UY, y ofrecérselo a un tutor con caja de ahorro sería adivinar. Es lo primero que hay que probar en el sandbox.');


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Siembra de los bancos — 612 códigos
-- ════════════════════════════════════════════════════════════════════════════
--
-- Transcritos mecánicamente de las tablas de la documentación (no a mano: son
-- 612 filas y una errata aquí es un payout rechazado). El `on conflict do
-- update` deja la siembra reejecutable: cuando dLocal publique cambios, esto se
-- vuelve a correr en una migración nueva y las filas se actualizan en su sitio.
--
-- Recuento por país, para poder cotejarlo con la doc de un vistazo:
-- AR 66 · BR 146 · CL 20 · EC 213 · MX 88 · PY 37 · PE 27 · UY 15.
-- Perú da 28 filas en la doc y aquí son 27: el código 043 aparece DOS VECES con
-- nombres distintos ("Crediscotia Financiera" y "Tarjetas Peruanas Prepago").
-- Es una incoherencia de la documentación oficial, no de la transcripción; se
-- fusionan los nombres porque el bank_code que viaja a dLocal es el mismo y el
-- tutor tiene que poder encontrar el suyo busque el nombre que busque.
-- ── AR · 66 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('AR', '340', 'Bacs Banco de Credito Y Securitizacion', false),
  ('AR', '147', 'Banco B. I. Creditanstalt', false),
  ('AR', '426', 'Banco Bica S.A.', false),
  ('AR', '336', 'Banco Bradesco Argentina', false),
  ('AR', '331', 'Banco Cetelem Argentina', false),
  ('AR', '319', 'Banco CMF', false),
  ('AR', '431', 'Banco Coinag S.A.', false),
  ('AR', '389', 'Banco Columbia', false),
  ('AR', '299', 'Banco Comafi', false),
  ('AR', '191', 'Banco Credicoop Coop. L', false),
  ('AR', '432', 'Banco de Comercio S.A.', false),
  ('AR', '094', 'Banco de Corrientes', false),
  ('AR', '315', 'Banco de Formosa', false),
  ('AR', '007', 'Banco de Galicia Y Buenos Aires', false),
  ('AR', '300', 'Banco de Inversion Y Comercio Exterior', false),
  ('AR', '029', 'Banco de La Ciudad de Buenos Aires', false),
  ('AR', '011', 'Banco de La Nacion Argentina', false),
  ('AR', '093', 'Banco de La Pampa Sociedad de Economia M', false),
  ('AR', '014', 'Banco de La Provincia de Buenos Aires', false),
  ('AR', '020', 'Banco de La Provincia de Cordoba', false),
  ('AR', '269', 'Banco de La Republica Oriental Del Uruguay', false),
  ('AR', '045', 'Banco de San Juan', false),
  ('AR', '086', 'Banco de Santa Cruz', false),
  ('AR', '321', 'Banco de Santiago del Estero', false),
  ('AR', '332', 'Banco de Servicios Financieros', false),
  ('AR', '338', 'Banco de Servicios Y Transacciones', false),
  ('AR', '198', 'Banco de Valores', false),
  ('AR', '083', 'Banco Del Chubut', false),
  ('AR', '310', 'Banco Del Sol', false),
  ('AR', '448', 'Banco Dino S.A.', false),
  ('AR', '044', 'Banco Hipotecario', false),
  ('AR', '305', 'Banco Julio', false),
  ('AR', '285', 'Banco Macro', false),
  ('AR', '254', 'Banco Mariva', false),
  ('AR', '341', 'Banco Mas Ventas', false),
  ('AR', '281', 'Banco Meridian', false),
  ('AR', '065', 'Banco Municipal de Rosario', false),
  ('AR', '034', 'Banco Patagonia Sudameris', false),
  ('AR', '301', 'Banco Piano', false),
  ('AR', '268', 'Banco Provincia de Tierra Del Fuego', false),
  ('AR', '097', 'Banco Provincia Del Neuquen', false),
  ('AR', '247', 'Banco Roela', false),
  ('AR', '277', 'Banco Saenz', false),
  ('AR', '072', 'Banco Santander', false),
  ('AR', '435', 'Banco Sucredito Regional S.A.U.', false),
  ('AR', '027', 'Banco Supervielle S.A.', false),
  ('AR', '312', 'Banco Voii S.A.', false),
  ('AR', '262', 'Bank of America, National Associa', false),
  ('AR', '515', 'Bank of Chine Limited Sucursal Buenos Aires', false),
  ('AR', '017', 'BBVA', false),
  ('AR', '266', 'Bnp Paribas', false),
  ('AR', '143', 'Brubank S.A.U.', false),
  ('AR', '000', 'CVU Account', false),
  ('AR', '016', 'Citibank', false),
  ('AR', '150', 'HSBC Bank Argentina', false),
  ('AR', '015', 'Industrial and Commercial Bank of China (ICBC) Argentina', false),
  ('AR', '165', 'J P Morgan Chase Bank Sucursal Buenos Aires', false),
  ('AR', '010', 'Lloyds Tsb Bank', false),
  ('AR', '453', 'NARANJA DIGITAL COMPAÑÍA FINANCIERA S.A.', false),
  ('AR', '386', 'Nuevo Banco de Entre Rios', false),
  ('AR', '309', 'Nuevo Banco de La Rioja', false),
  ('AR', '330', 'Nuevo Banco de Santa Fe', false),
  ('AR', '311', 'Nuevo Banco Del Chaco', false),
  ('AR', '322', 'Nuevo Banco Industrial de Azul', false),
  ('AR', '339', 'RCI Banque Argentina', false),
  ('AR', '384', 'Wilobank S.A.', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── BR · 146 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('BR', '332', 'Acesso Soluções Pagamento S.A.', false),
  ('BR', '654', 'Banco A.J. Renner S.A.', false),
  ('BR', '246', 'Banco ABC Brasil S.A.', false),
  ('BR', '075', 'Banco ABN Amro S.A.', false),
  ('BR', '121', 'Banco Agiplan S.A.', false),
  ('BR', '025', 'Banco Alfa S.A.', false),
  ('BR', '065', 'Banco AndBank (Brasil) S.A.', false),
  ('BR', '213', 'Banco Arbi S.A.', false),
  ('BR', '096', 'Banco B3 S.A.', false),
  ('BR', '024', 'Banco Bandepe S.A.', false),
  ('BR', '330', 'Banco Bari de Investimentos e Financiamentos S.A.', false),
  ('BR', '318', 'Banco BMG S.A.', false),
  ('BR', '752', 'Banco BNP Paribas Brasil S.A.', false),
  ('BR', '107', 'Banco Bocom BBM S.A.', false),
  ('BR', '218', 'Banco Bonsucesso S.A.', false),
  ('BR', '063', 'Banco Bradescard S.A.', false),
  ('BR', '036', 'Banco Bradesco BBI S.A.', false),
  ('BR', '122', 'Banco Bradesco BERJ S.A.', false),
  ('BR', '394', 'Banco Bradesco Financiamentos S.A.', false),
  ('BR', '237', 'Banco Bradesco S.A.', false),
  ('BR', '208', 'Banco BTG Pactual S.A.', false),
  ('BR', '336', 'Banco C6 S.A.', false),
  ('BR', '473', 'Banco Caixa Geral - Brasil S.A.', false),
  ('BR', '412', 'Banco Capital S.A.', false),
  ('BR', '040', 'Banco Cargill S.A.', false),
  ('BR', '266', 'Banco Cédula S.A.', false),
  ('BR', '739', 'Banco Cetelem S.A.', true),
  ('BR', '233', 'Banco Cifra S.A.', false),
  ('BR', '745', 'Banco Citibank', true),
  ('BR', '241', 'Banco Clássico S.A.', true),
  ('BR', '756', 'Banco Cooperativo do Brasil S.A. - Bancoob', false),
  ('BR', '748', 'Banco Cooperativo Sicredi S.A.', false),
  ('BR', '222', 'Banco Crédit Agricole Brasil S.A.', false),
  ('BR', '505', 'Banco Credit Suisse (Brasil) S.A.', false),
  ('BR', '069', 'Banco Crefisa S.A.', false),
  ('BR', '003', 'Banco da Amazônia S.A.', false),
  ('BR', '083', 'Banco da China Brasil S.A.', false),
  ('BR', '707', 'Banco Daycoval S.A.', false),
  ('BR', '070', 'Banco de Brasília S.A. - BRB', false),
  ('BR', '300', 'Banco de la Nación Argentina', false),
  ('BR', '335', 'Banco Digio S.A.', false),
  ('BR', '001', 'Banco do Brasil S.A.', false),
  ('BR', '047', 'Banco do Estado de Sergipe S.A. - Banese', false),
  ('BR', '037', 'Banco do Estado do Pará S.A. - Banpará', false),
  ('BR', '041', 'Banco do Estado do Rio Grande do Sul S.A. - Banrisul', false),
  ('BR', '004', 'Banco do Nordeste do Brasil S.A.', false),
  ('BR', '265', 'Banco Fator S.A.', false),
  ('BR', '224', 'Banco Fibra S.A.', false),
  ('BR', '626', 'Banco Ficsa S.A.', false),
  ('BR', '094', 'Banco Finaxis S.A.', false),
  ('BR', '278', 'Banco Genial', false),
  ('BR', '612', 'Banco Guanabara S.A.', false),
  ('BR', '012', 'Banco Inbursa S.A.', false),
  ('BR', '604', 'Banco Industrial do Brasil S.A.', false),
  ('BR', '653', 'Banco Indusval S.A.', false),
  ('BR', '077', 'Banco Inter', false),
  ('BR', '249', 'Banco Investcred Unibanco S.A.', false),
  ('BR', '184', 'Banco Itaú BBA S.A.', false),
  ('BR', '029', 'Banco Itaú Consignado S.A.', false),
  ('BR', '479', 'Banco ItauBank S.A.', false),
  ('BR', '074', 'Banco J. Safra S.A.', false),
  ('BR', '376', 'Banco J.P. Morgan S.A.', false),
  ('BR', '217', 'Banco John Deere S.A.', false),
  ('BR', '076', 'Banco KDB do Brasil S.A.', false),
  ('BR', '757', 'Banco KEB Hana do Brasil S.A.', false),
  ('BR', '600', 'Banco Luso Brasileiro S.A.', false),
  ('BR', '243', 'Banco Máxima S.A.', false),
  ('BR', '389', 'Banco Mercantil do Brasil S.A.', false),
  ('BR', '370', 'Banco Mizuho do Brasil S.A.', false),
  ('BR', '746', 'Banco Modal S.A.', false),
  ('BR', '066', 'Banco Morgan Stanley S.A.', true),
  ('BR', '456', 'Banco MUFG Brasil S.A.', false),
  ('BR', '007', 'Banco Nacional de Desenvolvimento Econômico e Social', false),
  ('BR', '169', 'Banco Olé Bonsucesso Consignado S.A.', false),
  ('BR', '212', 'Banco Original', false),
  ('BR', '079', 'Banco Original do Agronegócio S.A.', false),
  ('BR', '712', 'Banco Ourinvest S.A.', false),
  ('BR', '623', 'Banco Panamericano S.A.', false),
  ('BR', '611', 'Banco Paulista S.A.', false),
  ('BR', '643', 'Banco Pine S.A.', false),
  ('BR', '747', 'Banco Rabobank International Brasil S.A.', false),
  ('BR', '633', 'Banco Rendimento S.A.', false),
  ('BR', '741', 'Banco Ribeirão Preto S.A.', false),
  ('BR', '120', 'Banco Rodobens S.A.', false),
  ('BR', '422', 'Banco Safra S.A.', false),
  ('BR', '033', 'Banco Santander Brasil S.A.', false),
  ('BR', '743', 'Banco Semear S.A.', false),
  ('BR', '754', 'Banco Sistema S.A.', false),
  ('BR', '630', 'Banco Smartbank S.A.', false),
  ('BR', '366', 'Banco Société Générale Brasil S.A.', false),
  ('BR', '637', 'Banco Sofisa', false),
  ('BR', '464', 'Banco Sumitomo Mitsui Brasileiro S.A.', false),
  ('BR', '082', 'Banco Topázio S.A.', false),
  ('BR', '634', 'Banco Triângulo S.A.', false),
  ('BR', '018', 'Banco Tricury S.A.', true),
  ('BR', '655', 'Banco Votorantim S.A. (Banco Neon)', false),
  ('BR', '610', 'Banco VR S.A.', false),
  ('BR', '119', 'Banco Western Union do Brasil S.A.', false),
  ('BR', '124', 'Banco Woori Bank do Brasil S.A.', false),
  ('BR', '348', 'Banco XP S.A.', false),
  ('BR', '081', 'BancoSeguro S.A.', false),
  ('BR', '021', 'Banestes S.A. Banco do Estado do Espírito Santo', false),
  ('BR', '755', 'Bank of America Merrill Lynch Banco Múltiplo S.A.', false),
  ('BR', '250', 'BCV - Banco de Crédito e Varejo S.A.', false),
  ('BR', '144', 'Bexs Banco de Câmbio S.A.', false),
  ('BR', '253', 'Bexs Corretora de Câmbio S.A.', false),
  ('BR', '017', 'BNY Mellon Banco S.A.', false),
  ('BR', '301', 'BPP Instituição de Pagamento S.A.', false),
  ('BR', '126', 'BR Partners Banco de Investimento S.A.', false),
  ('BR', '104', 'Caixa Econômica Federal - CEF', false),
  ('BR', '320', 'China Construction Bank (Brasil) Banco Múltiplo S.A.', false),
  ('BR', '477', 'Citibank N.A.', true),
  ('BR', '163', 'Commerzbank Brasil S.A. - Banco Múltiplo', false),
  ('BR', '136', 'Confederação Nacional das Cooperativas Centrais Unicreds', false),
  ('BR', '085', 'Cooperativa Central de Crédito Urbano - Cecred', false),
  ('BR', '403', 'Cora SCD S.A.', false),
  ('BR', '010', 'Credicoamo Crédito Rural Cooperativa', false),
  ('BR', '011', 'Credit Suisse Hedging-Griffo Corretora de Valores S.A.', false),
  ('BR', '487', 'Deutsche Bank S.A. - Banco Alemão', false),
  ('BR', '064', 'Goldman Sachs do Brasil Banco Múltiplo S.A.', false),
  ('BR', '078', 'Haitong Banco de Investimento do Brasil S.A.', true),
  ('BR', '062', 'Hipercard Banco Múltiplo S.A.', false),
  ('BR', '269', 'HSBC Brasil S.A. - Banco de Investimento', false),
  ('BR', '132', 'ICBC do Brasil Banco Múltiplo S.A.', false),
  ('BR', '492', 'ING Bank N.V.', false),
  ('BR', '139', 'Intesa Sanpaolo Brasil S.A. - Banco Múltiplo', true),
  ('BR', '652', 'Itaú Unibanco Holding S.A.', false),
  ('BR', '341', 'Itaú Unibanco S.A.', false),
  ('BR', '488', 'JPMorgan Chase Bank National Association', false),
  ('BR', '399', 'Kirton Bank S.A. - Banco Múltiplo', false),
  ('BR', '323', 'Mercadopago.com Representações Ltda.', false),
  ('BR', '259', 'Moneycorp Banco de Câmbio S.A.', false),
  ('BR', '128', 'MS Bank S.A. Banco de Câmbio', false),
  ('BR', '753', 'Novo Banco Continental S.A. - Banco Múltiplo', false),
  ('BR', '260', 'Nu Pagamentos (Nubank)', false),
  ('BR', '613', 'Omni Banco S.A.', false),
  ('BR', '290', 'PagSeguro Internet S.A.', false),
  ('BR', '254', 'Paraná Banco S.A.', false),
  ('BR', '125', 'Plural S.A. Banco Múltiplo', false),
  ('BR', '751', 'Scotiabank Brasil S.A. Banco Múltiplo', false),
  ('BR', '014', 'State Street Brasil S.A. – Banco Comercial', false),
  ('BR', '197', 'Stone Pagamentos S.A.', false),
  ('BR', '095', 'Travelex Banco de Câmbio S.A.', false),
  ('BR', '129', 'UBS Brasil Banco de Investimento S.A.', false),
  ('BR', '015', 'UBS Brasil Corretora de Câmbio Títulos e Valores Mobiliários S.A.', false),
  ('BR', '084', 'Unicred Norte do Paraná', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── CL · 20 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('CL', '28', 'Banco Bice', false),
  ('CL', '55', 'Banco Consorcio', false),
  ('CL', '16', 'Banco Crédito e Inversiones', false),
  ('CL', '1', 'Banco de Chile', false),
  ('CL', '507', 'Banco del Desarrollo', false),
  ('CL', '12', 'Banco del Estado de Chile', false),
  ('CL', '51', 'Banco Falabella', false),
  ('CL', '9', 'Banco Internacional', false),
  ('CL', '53', 'Banco Ripley', false),
  ('CL', '37', 'Banco Santander - Santiago', false),
  ('CL', '49', 'Banco Security', false),
  ('CL', '504', 'BBVA Chile', false),
  ('CL', '738', 'Global66', false),
  ('CL', '672', 'Coopeuch', false),
  ('CL', '31', 'HSBC Bank', false),
  ('CL', '39', 'Itau Corpbanca', false),
  ('CL', '875', 'Mercado Pago', false),
  ('CL', '729', 'Prepago los Héroes', false),
  ('CL', '14', 'Scotiabank Chile', false),
  ('CL', '730', 'Tenpo Prepago', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── EC · 213 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('EC', '034', 'Banco Amazonas', false),
  ('EC', '323', 'Banco Asistencia Comunitaria Finca S.A.', false),
  ('EC', '037', 'Banco Bolivariano', false),
  ('EC', '061', 'Banco Capital S.A.', false),
  ('EC', '024', 'Banco Citibank', false),
  ('EC', '039', 'Banco Comercial de Manabi', false),
  ('EC', '064', 'Banco Coopnacional S.A.', false),
  ('EC', '063', 'Banco D-Miro S.A.', false),
  ('EC', '017', 'Banco de Guayaquil', false),
  ('EC', '029', 'Banco de Loja', false),
  ('EC', '025', 'Banco de Machala', false),
  ('EC', '035', 'Banco del Austro', false),
  ('EC', '461', 'Banco del Instituto Ecuatoriano de Seguridad Social', false),
  ('EC', '043', 'Banco del Litoral', false),
  ('EC', '030', 'Banco del Pacífico', false),
  ('EC', '010', 'Banco del Pichincha', false),
  ('EC', '027', 'Banco Delbank', false),
  ('EC', '052', 'Banco Ecuatoriano de la Vivienda', false),
  ('EC', '007', 'Banco Económico', false),
  ('EC', '047', 'Banco Ecofuturo', false),
  ('EC', '045', 'Banco FIE', false),
  ('EC', '049', 'Banco Fortaleza', false),
  ('EC', '009', 'Banco Ganadero', false),
  ('EC', '042', 'Banco General Rumiñahui', false),
  ('EC', '032', 'Banco Internacional', false),
  ('EC', '060', 'Banco Procredit', false),
  ('EC', '036', 'Banco Produbanco', false),
  ('EC', '059', 'Banco Solidario', false),
  ('EC', '066', 'Banecuador B.P.', false),
  ('EC', '068', 'Banco Desarrollo de Los Pueblos S.A.', false),
  ('EC', '181', 'COAC Ahorrista Solidario', false),
  ('EC', '109', 'COAC Sindicato de Choferes Profesionales de Yantza', false),
  ('EC', '057', 'Coop. 15 de Abril Ltda', false),
  ('EC', '290', 'Coop. 15 de Agosto Pilacoto', false),
  ('EC', '051', 'Coop. Accion y Desarrollo', false),
  ('EC', '660', 'Coop. Aho. y Cred. 16 de Junio', false),
  ('EC', '284', 'Coop. Aho. y Cred. 1ro de Enero del Austro', false),
  ('EC', '058', 'Coop. Aho. y Cred. 23 de Julio', false),
  ('EC', '606', 'Coop. Aho. y Cred. 23 de Mayo Ltda.', false),
  ('EC', '095', 'Coop. Aho. y Cred. 29 de Octubre', false),
  ('EC', '294', 'Coop. Aho. y Cred. 4 de Octubre Ltda.', false),
  ('EC', '325', 'Coop. Aho. y Cred. 9 de Octubre Ltda', false),
  ('EC', '326', 'Coop. Aho. y Cred. Accion Rural', false),
  ('EC', '636', 'Coop. Aho. y Cred. Accion Tungurahua Ltda.', false),
  ('EC', '275', 'Coop. Aho. y Cred. Agraria Mushuk Kawsay Ltda.', false),
  ('EC', '424', 'Coop. Aho. y Cred. Agricola Junin Ltda', false),
  ('EC', '296', 'Coop. Aho. y Cred. Alfonso Jaramillo', false),
  ('EC', '062', 'Coop. Aho. y Cred. Alianza del Valle Ltda', false),
  ('EC', '278', 'Coop. Aho. y Cred. Alianza Minas Ltda.', false),
  ('EC', '414', 'Coop. Aho. y Cred. Ambato Ltda', false),
  ('EC', '642', 'Coop. Aho. y Cred. Andina Ltda.', false),
  ('EC', '417', 'Coop. Aho. y Cred. Artesanos Ltda', false),
  ('EC', '086', 'Coop. Aho. y Cred. Atuntaqui Ltda.', false),
  ('EC', '656', 'Coop. Aho. y Cred. Cacpe Celica', false),
  ('EC', '426', 'Coop. Aho. y Cred. Cam Com Canton Bolivar', false),
  ('EC', '411', 'Coop. Aho. y Cred. Camara Comer Ambato', false),
  ('EC', '295', 'Coop. Aho. y Cred. Camara Comercio Indigena', false),
  ('EC', '422', 'Coop. Aho. y Cred. Cariamanga Ltda', false),
  ('EC', '634', 'Coop. Aho. y Cred. Carroceros de Tungurahua', false),
  ('EC', '657', 'Coop. Aho. y Cred. Catamayo Ltda. Mie', false),
  ('EC', '067', 'Coop. Aho. y Cred. Chone Ltda', false),
  ('EC', '607', 'Coop. Aho. y Cred. Coca Ltda', false),
  ('EC', '088', 'Coop. Aho. y Cred. Comercio Ltda Portoviejo', false),
  ('EC', '407', 'Coop. Aho. y Cred. Const Comercio y Produccion', false),
  ('EC', '065', 'Coop. Aho. y Cred. Cotocollao', false),
  ('EC', '628', 'Coop. Aho. y Cred. Credi Facil Ltda.', false),
  ('EC', '653', 'Coop. Aho. y Cred. Crediamigo Ltda. Loja Mi', false),
  ('EC', '291', 'Coop. Aho. y Cred. Cristo Rey', false),
  ('EC', '658', 'Coop. Aho. y Cred. de la Peq. Emp. Cacpe Macara', false),
  ('EC', '602', 'Coop. Aho. y Cred. de la Peq. Emp. Cacpe Zamora Ltda.', false),
  ('EC', '605', 'Coop. Aho. y Cred. de Los Serv. Publ. del Min. de Ed.', false),
  ('EC', '603', 'Coop. Aho. y Cred. Desarrollo Integral Ltda.', false),
  ('EC', '415', 'Coop. Aho. y Cred. Dorado Ltda', false),
  ('EC', '630', 'Coop. Aho. y Cred. Ecuafuturo Ltda.', false),
  ('EC', '413', 'Coop. Aho. y Cred. Educ del Tungurahua', false),
  ('EC', '292', 'Coop. Aho. y Cred. Educadores Chimborazo', false),
  ('EC', '204', 'Coop. Aho. y Cred. Educadores de Pastaza Ltda.', false),
  ('EC', '085', 'Coop. Aho. y Cred. Educadores Tulcan Ltda.', false),
  ('EC', '627', 'Coop. Aho. y Cred. El Calvario Ltda.', false),
  ('EC', '069', 'Coop. Aho. y Cred. El Sagrario', false),
  ('EC', '410', 'Coop. Aho. y Cred. Erco Ltda', false),
  ('EC', '420', 'Coop. Aho. y Cred. Esc.Sup.Politec. Agrop. de Manabi Man', false),
  ('EC', '641', 'Coop. Aho. y Cred. Escencia Indigena Ltda.', false),
  ('EC', '286', 'Coop. Aho. y Cred. Familia Austral', false),
  ('EC', '429', 'Coop. Aho. y Cred. Fernando Daquilema', false),
  ('EC', '654', 'Coop. Aho. y Cred. Fortuna Mies', false),
  ('EC', '406', 'Coop. Aho. y Cred. Fundesarrollo', false),
  ('EC', '661', 'Coop. Aho. y Cred. Futuro y Progreso de Galapagos Lt', false),
  ('EC', '650', 'Coop. Aho. y Cred. Gonzanama Mies', false),
  ('EC', '604', 'Coop. Aho. y Cred. Grameen Amazonas', false),
  ('EC', '664', 'Coop. Aho. y Cred. Guamote Ltda.', false),
  ('EC', '072', 'Coop. Aho. y Cred. Guaranda Ltda.', false),
  ('EC', '609', 'Coop. Aho. y Cred. Huaicana Ltda', false),
  ('EC', '419', 'Coop. Aho. y Cred. Huayco Pungo Ltda', false),
  ('EC', '626', 'Coop. Aho. y Cred. Huinara Ltda. Mies', false),
  ('EC', '635', 'Coop. Aho. y Cred. Inka Kipu Ltda.', false),
  ('EC', '409', 'Coop. Aho. y Cred. Integral', false),
  ('EC', '625', 'Coop. Aho. y Cred. Jadan Ltda. Mies', false),
  ('EC', '270', 'Coop. Aho. y Cred. Juan de Salinas Ltda.', false),
  ('EC', '638', 'Coop. Aho. y Cred. Juan Pio de Mora Ltda.', false),
  ('EC', '073', 'Coop. Aho. y Cred. La Dolorosa Ltda', false),
  ('EC', '557', 'Coop. Aho. y Cred. La Merced', false),
  ('EC', '348', 'Coop. Aho. y Cred. Llanganates', false),
  ('EC', '663', 'Coop. Aho. y Cred. Lucha Campesina Ltda.', false),
  ('EC', '273', 'Coop. Aho. y Cred. Malchingui Ltda.', false),
  ('EC', '601', 'Coop. Aho. y Cred. Manantial de Oro Ltda.', false),
  ('EC', '631', 'Coop. Aho. y Cred. Maquita Cushun Ltda.', false),
  ('EC', '423', 'Coop. Aho. y Cred. Marcabeli Ltda', false),
  ('EC', '403', 'Coop. Aho. y Cred. Mi Tierra', false),
  ('EC', '293', 'Coop. Aho. y Cred. Minga Ltda.', false),
  ('EC', '333', 'Coop. Aho. y Cred. Mujeres Unidas Tantanakushk', false),
  ('EC', '412', 'Coop. Aho. y Cred. Mushuc Runa Ltda', false),
  ('EC', '416', 'Coop. Aho. y Cred. Nuestros Abuelos Ltda', false),
  ('EC', '427', 'Coop. Aho. y Cred. Nueva Esperanza', false),
  ('EC', '408', 'Coop. Aho. y Cred. Nueva Huancavilca', false),
  ('EC', '272', 'Coop. Aho. y Cred. Nueva Jerusalen', false),
  ('EC', '659', 'Coop. Aho. y Cred. Nuevos Horizontes El Oro Ltda.', false),
  ('EC', '075', 'Coop. Aho. y Cred. Once de Junio', false),
  ('EC', '076', 'Coop. Aho. y Cred. Oscus', false),
  ('EC', '093', 'Coop. Aho. y Cred. Pablo Munoz Vega', false),
  ('EC', '077', 'Coop. Aho. y Cred. Padre Julian Lorente Ltda', false),
  ('EC', '279', 'Coop. Aho. y Cred. Pedro Moncayo Ltda.', false),
  ('EC', '404', 'Coop. Aho. y Cred. Peq Emp Cacpe Yanzatza', false),
  ('EC', '078', 'Coop. Aho. y Cred. Peq Empr Cacpe Biblian', false),
  ('EC', '402', 'Coop. Aho. y Cred. Peq Empresa Gualaquiza', false),
  ('EC', '350', 'Coop. Aho. y Cred. Peq. Emp. de Loja Cacpe', false),
  ('EC', '640', 'Coop. Aho. y Cred. Pijal', false),
  ('EC', '643', 'Coop. Aho. y Cred. Pilahuin', false),
  ('EC', '608', 'Coop. Aho. y Cred. Pilahuin Tio Ltda', false),
  ('EC', '655', 'Coop. Aho. y Cred. Profesionales del Volante Union L', false),
  ('EC', '079', 'Coop. Aho. y Cred. Progreso', false),
  ('EC', '281', 'Coop. Aho. y Cred. Provida', false),
  ('EC', '644', 'Coop. Aho. y Cred. Pucara Ltda.', false),
  ('EC', '271', 'Coop. Aho. y Cred. Puellaro Ltda', false),
  ('EC', '425', 'Coop. Aho. y Cred. Puerto Lopez Ltda', false),
  ('EC', '651', 'Coop. Aho. y Cred. Quilanga Ltda.', false),
  ('EC', '080', 'Coop. Aho. y Cred. Riobamba', false),
  ('EC', '637', 'Coop. Aho. y Cred. Salasaca', false),
  ('EC', '289', 'Coop. Aho. y Cred. San Antonio Ltda.', false),
  ('EC', '081', 'Coop. Aho. y Cred. San Francisco', false),
  ('EC', '054', 'Coop. Aho. y Cred. San Francisco de Asis', false),
  ('EC', '328', 'Coop. Aho. y Cred. San Gabriel Ltda.', false),
  ('EC', '428', 'Coop. Aho. y Cred. San Jorge Ltda', false),
  ('EC', '082', 'Coop. Aho. y Cred. San Jose Ltda', false),
  ('EC', '283', 'Coop. Aho. y Cred. San Jose S.J.', false),
  ('EC', '330', 'Coop. Aho. y Cred. San Miguel de Los Bancos', false),
  ('EC', '646', 'Coop. Aho. y Cred. San Miguel de Sigchos', false),
  ('EC', '084', 'Coop. Aho. y Cred. Santa Ana Ltda', false),
  ('EC', '418', 'Coop. Aho. y Cred. Santa Anita Ltda', false),
  ('EC', '334', 'Coop. Aho. y Cred. Santa Rosa de Patutan Ltda.', false),
  ('EC', '096', 'Coop. Aho. y Cred. Santa Rosa Ltda', false),
  ('EC', '332', 'Coop. Aho. y Cred. Semilla del Progreso Ltda', false),
  ('EC', '285', 'Coop. Aho. y Cred. Senor de Giron', false),
  ('EC', '647', 'Coop. Aho. y Cred. Sierra Centro Ltda.', false),
  ('EC', '639', 'Coop. Aho. y Cred. Simiatug Ltda', false),
  ('EC', '645', 'Coop. Aho. y Cred. Sinchi Runa Ltda', false),
  ('EC', '662', 'Coop. Aho. y Cred. Sumac Llacta Ltda.', false),
  ('EC', '276', 'Coop. Aho. y Cred. Tena Ltda.', false),
  ('EC', '222', 'Coop. Aho. y Cred. Tulcan', false),
  ('EC', '287', 'Coop. Aho. y Cred. Tungurahua Ltda.', false),
  ('EC', '648', 'Coop. Aho. y Cred. Union Mercedaria Ltda.', false),
  ('EC', '632', 'Coop. Aho. y Cred. Valles del Lirio', false),
  ('EC', '629', 'Coop. Aho. y Cred. Vencedores de Tungurahua', false),
  ('EC', '087', 'Coop. Calceta Ltda', false),
  ('EC', '203', 'Coop. Capeco Ltda', false),
  ('EC', '633', 'Coop. Esfuerzo Unido Para El Desarr. del Chilco La', false),
  ('EC', '015', 'Coop. Jardin Azuayo', false),
  ('EC', '091', 'Coop. Juventud Ecuatoriana Progresista Ltda.', false),
  ('EC', '092', 'Coop. Manuel Esteban Godoy Ortega Ltda Coopmego', false),
  ('EC', '089', 'Coop. Peq. Empresa de Pastaza', false),
  ('EC', '053', 'Coop. Policia Nacional', false),
  ('EC', '094', 'Coop. Prevision Ahorro y Desarrollo', false),
  ('EC', '119', 'COOP DE A. Y C. 22 de Junio-Orianga', false),
  ('EC', '102', 'COOP DE A. Y C. Mushuk Yuyay Ltda', false),
  ('EC', '103', 'COOP DE A. Y C. Nizag Ltda.', false),
  ('EC', '118', 'COOP DE A. Y C. Quilotoa', false),
  ('EC', '179', 'COOP DE A. Y C. Sembrando Futuro', false),
  ('EC', '114', 'COOP DE A. Y C. Senor Del Arbol', false),
  ('EC', '100', 'COOP DE A. Y C. Unidad Y Progreso', false),
  ('EC', '108', 'COOP.DE Ahorro Y Credito 29 de Enero', false),
  ('EC', '182', 'COOP.DE Ahorro Y Credito Ciudad de Zamora', false),
  ('EC', '122', 'Cooperativa de Ahorro y Credito Ambato Ltda.', false),
  ('EC', '194', 'Cooperativa de Ahorro y Credito Armada Nacional', false),
  ('EC', '125', 'Cooperativa de Ahorro y Credito Campesina Coopac', false),
  ('EC', '196', 'Cooperativa de Ahorro y Credito Distrito Metropol', false),
  ('EC', '200', 'Cooperativa de Ahorro y Credito General Angel Flor', false),
  ('EC', '176', 'Cooperativa de Ahorro y Credito Santa Isabel Ltda', false),
  ('EC', '177', 'Cooperativa Divino Nino', false),
  ('EC', '178', 'Cooperativa Llacta Pura', false),
  ('EC', '668', 'COPP Aho Cred Credisur', false),
  ('EC', '649', 'COOP.AHO Y Cred Camara de Comercio Pindal Cadecopi', false),
  ('EC', '674', 'COOP Aho Y Cred 20 de Febrero Ltda', false),
  ('EC', '671', 'COOP Aho Y Cred Caseg Ltda', false),
  ('EC', '673', 'COOP Aho Y Cred Finan Indigena', false),
  ('EC', '672', 'COOP Aho Y Cred Focla', false),
  ('EC', '670', 'COOP Aho Y Cred Gral Ruminahui', false),
  ('EC', '677', 'COOP Aho Y Cred Huaquillas', false),
  ('EC', '675', 'COOP Aho Y Cred Indigena Alfa', false),
  ('EC', '669', 'COOP Aho Y Cred Maquita Cushunchic', false),
  ('EC', '232', 'Financiera - Diners Club del Ecuador', false),
  ('EC', '43', 'Financiera Acceso La Paz', false),
  ('EC', '097', 'Financiera Financoop', false),
  ('EC', '44', 'Fondo Financiero de la Comunidad', false),
  ('EC', '667', 'FONDO DE CESANTIA DEL MAGISTERIO ECUATORIANO FCME-', false),
  ('EC', '349', 'Interdin S.A.', false),
  ('EC', '198', 'La Cooperativa de Ah Y Cred Simon Bolivar', false),
  ('EC', '39', 'Magisterio Rural', false),
  ('EC', '098', 'Mutualista Ambato', false),
  ('EC', '070', 'Mutualista Azuay', false),
  ('EC', '099', 'Mutualista Imbabura', false),
  ('EC', '071', 'Mutualista Pichincha', false),
  ('EC', '42', 'Nacional Financiera Boliviana SAN', false),
  ('EC', '005', 'Pacificard', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── MX · 88 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('MX', '138', 'ABC Capital', false),
  ('MX', '133', 'Actinver', false),
  ('MX', '62', 'Afirme', false),
  ('MX', '721', 'Albo', false),
  ('MX', '706', 'Arcus', false),
  ('MX', '128', 'Autofin', false),
  ('MX', '127', 'Azteca', false),
  ('MX', '166', 'BaBien', false),
  ('MX', '30', 'Bajio', false),
  ('MX', '2', 'Banamex', false),
  ('MX', '6', 'Bancomext', false),
  ('MX', '137', 'Bancoppel', false),
  ('MX', '19', 'Banjercito', false),
  ('MX', '9', 'Banobras', false),
  ('MX', '72', 'Banorte', false),
  ('MX', '58', 'Banregio', false),
  ('MX', '60', 'Bansi', false),
  ('MX', '1', 'BANXICO', false),
  ('MX', '129', 'Barclays', false),
  ('MX', '145', 'Bbase', false),
  ('MX', '12', 'BBVA Bancomer', false),
  ('MX', '112', 'BMonex', false),
  ('MX', '132', 'BMultiva', false),
  ('MX', '154', 'Banco Covalto', false),
  ('MX', '160', 'Banco S3', false),
  ('MX', '156', 'Banco Sabadell', false),
  ('MX', '152', 'Bancrea', false),
  ('MX', '106', 'Bank of America', false),
  ('MX', '159', 'Bank of China', false),
  ('MX', '147', 'Bankaool', false),
  ('MX', '677', 'Caja Pop Mexicana', false),
  ('MX', '683', 'Caja Telefonistas', false),
  ('MX', '715', 'Cartera Digital', false),
  ('MX', '124', 'Citi', false),
  ('MX', '901', 'CLS', false),
  ('MX', '903', 'CoDi Valida', false),
  ('MX', '130', 'Compartamos', false),
  ('MX', '140', 'Consubanco', false),
  ('MX', '652', 'Credicapital', false),
  ('MX', '688', 'Crediclub', false),
  ('MX', '680', 'Cristobal Colon', false),
  ('MX', '723', 'Cuenca', false),
  ('MX', '151', 'Donde', false),
  ('MX', '616', 'Finamex', false),
  ('MX', '634', 'Fincomun', false),
  ('MX', '689', 'FOMPED', false),
  ('MX', '699', 'Fondeadora', false),
  ('MX', '685', 'Fondo (FIRA)', false),
  ('MX', '601', 'GBM', false),
  ('MX', '167', 'Hey Banco', false),
  ('MX', '168', 'Hipotecaria Federal', false),
  ('MX', '21', 'HSBC', false),
  ('MX', '155', 'ICBC', false),
  ('MX', '36', 'Inbursa', false),
  ('MX', '902', 'Indeval', false),
  ('MX', '150', 'Inmobiliario', false),
  ('MX', '59', 'Invex', false),
  ('MX', '110', 'JP Morgan', false),
  ('MX', '661', 'Klar', false),
  ('MX', '653', 'Kuspit', false),
  ('MX', '670', 'Libertad', false),
  ('MX', '602', 'Masari', false),
  ('MX', '722', 'Mercado Pago', false),
  ('MX', '720', 'MexPago', false),
  ('MX', '42', 'Mifel', false),
  ('MX', '158', 'Mizuho Bank', false),
  ('MX', '600', 'Monexcb', false),
  ('MX', '108', 'MUFG', false),
  ('MX', '135', 'Nafin', false),
  ('MX', '638', 'Nu Bank', false),
  ('MX', '710', 'NVIO', false),
  ('MX', '659', 'Opciones Empresariales del Noroeste', false),
  ('MX', '148', 'Pagatodo', false),
  ('MX', '732', 'Peibo', false),
  ('MX', '620', 'Profuturo', false),
  ('MX', '14', 'Santander', false),
  ('MX', '44', 'Scotiabank', false),
  ('MX', '157', 'Shinhan', false),
  ('MX', '728', 'SPIN BY OXXO', false),
  ('MX', '646', 'STP', false),
  ('MX', '703', 'Tesored', false),
  ('MX', '684', 'Transfer', false),
  ('MX', '656', 'Unagra', false),
  ('MX', '617', 'Valmex', false),
  ('MX', '605', 'Value', false),
  ('MX', '113', 'Ve Por Mas', false),
  ('MX', '608', 'Vector', false),
  ('MX', '141', 'Volkswagen', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── PY · 37 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('PY', '1', 'Banco Amambay S.A.', false),
  ('PY', '2', 'Banco Atlas S.A.', false),
  ('PY', '3', 'Banco BASA S.A.', false),
  ('PY', '5', 'Banco Busaif S.A. de Inversion y Fomento', false),
  ('PY', '6', 'Banco Central del Paraguay', false),
  ('PY', '7', 'Banco Comercial Paraguayo S.A.', false),
  ('PY', '8', 'Banco Continental S.A.E.C.A.', false),
  ('PY', '9', 'Banco Corporacion S.A.', false),
  ('PY', '10', 'Banco de Desarrollo del Paraguay S.A.', false),
  ('PY', '11', 'Banco de Inversiones del Paraguay', false),
  ('PY', '12', 'Banco de La Nacion Argentina', false),
  ('PY', '13', 'Banco Do Brasil S.A.', false),
  ('PY', '14', 'Banco Familiar S.A.E.C.A.', false),
  ('PY', '16', 'Banco General S.A.', false),
  ('PY', '17', 'Banco GNB Paraguay S.A.', false),
  ('PY', '18', 'Banco Itapua S.A.E.C.A.', false),
  ('PY', '19', 'Banco Itau Paraguay S.A.', false),
  ('PY', '20', 'Banco Nacional de Fomento', false),
  ('PY', '21', 'Banco Nacional de Trabajadores', false),
  ('PY', '22', 'Banco Para la Comercializacion Y La Produccion S.A (BANCOP S.A.)', false),
  ('PY', '23', 'Banco Paraguayo Oriental de Inversion y Fomento S.A.', false),
  ('PY', '24', 'Banco Regional S.A.E.C.A.', false),
  ('PY', '25', 'Banco Rio S.A.E.C.A.', false),
  ('PY', '26', 'BOLPAR Sociedad Anonima', false),
  ('PY', '28', 'British American Tobacco Productora de Cigarrillos S.A.', false),
  ('PY', '29', 'Citibank N.A.', false),
  ('PY', '30', 'Crisol y Encarnacion Financiera S.A.', false),
  ('PY', '32', 'Financiera Exportadora Paraguaya S.A.', false),
  ('PY', '33', 'Financiera Paraguayo Japonesa S.A.E.C.A.', false),
  ('PY', '40', 'Finlantina S.A. de Finanzas', false),
  ('PY', '34', 'Fonplata - Fondo Financiero Para El Desarollo de La Cuenca Del Plata', false),
  ('PY', '4', 'GNB Fusion', false),
  ('PY', '35', 'Grupo Internacional de Finanzas S.A. C.A. (Interfisa Financiera)', false),
  ('PY', '37', 'Sudameris Bank S.A.E.C.A.', false),
  ('PY', '38', 'Summa Asesories', false),
  ('PY', '42', 'Tu Financiera', false),
  ('PY', '48', 'Ueno Bank S.A.', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── PE · 27 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('PE', '001', 'Banco Central de Reserva', false),
  ('PE', '023', 'Banco de Comercio', false),
  ('PE', '002', 'Banco de Crédito del Perú', false),
  ('PE', '018', 'Banco de la Nación', false),
  ('PE', '010', 'Banco del Pichincha', false),
  ('PE', '054', 'Banco Falabella', false),
  ('PE', '035', 'Banco Financiero', false),
  ('PE', '053', 'Banco GNB Perú S.A.', false),
  ('PE', '038', 'Banco Interamericano de Finanzas (BIF)', false),
  ('PE', '055', 'Banco Ripley', false),
  ('PE', '011', 'BBVA Continental', false),
  ('PE', '800', 'Caja Metropolitana de Lima', false),
  ('PE', '803', 'Caja Municipal de Ahorro y Crédito Arequipa', false),
  ('PE', '806', 'Caja Municipal de Ahorro y Crédito Cuzco', false),
  ('PE', '808', 'Caja Municipal de Ahorro y Crédito Huancayo', false),
  ('PE', '801', 'Caja Municipal de Ahorro y Crédito Piura SAC', false),
  ('PE', '813', 'Caja Municipal de Ahorro y Crédito Tacna', false),
  ('PE', '007', 'Citibank', false),
  ('PE', '043', 'Crediscotia Financiera / Tarjetas Peruanas Prepago', false),
  ('PE', '003', 'Interbank', false),
  ('PE', '049', 'Mi Banco', false),
  ('PE', '056', 'Santander', false),
  ('PE', '009', 'Scotiabank', false),
  ('PE', '037', 'Yape', false),
  ('PE', '040', 'Plin', false),
  ('PE', '045', 'Prex', false),
  ('PE', '048', 'Dale', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ── UY · 15 códigos ─────────────────────────────────────────────
insert into public.payout_banks (country, bank_code, name, rejects_cpf) values
  ('UY', '153', 'Banco Bilbao Vizcaya Argentaria', false),
  ('UY', '246', 'Banco de la Nación Argentina', false),
  ('UY', '091', 'Banco Hipotecario del Uruguay', false),
  ('UY', '113', 'Banco ITAU', false),
  ('UY', '137', 'Banco Santander', false),
  ('UY', '162', 'Banque Heritage', false),
  ('UY', '61', 'Bapro', false),
  ('UY', '001', 'BROU - Banco de la República Oriental del Uruguay', false),
  ('UY', '205', 'Citibank N.A. Sucursal', false),
  ('UY', '157', 'HSBC Bank', false),
  ('UY', '917', 'Mi Dinero', false),
  ('UY', '999', 'Oca Blue', false),
  ('UY', '603', 'Prex', false),
  ('UY', '624', 'Redpagos', false),
  ('UY', '128', 'Scotiabank', false)
on conflict (country, bank_code) do update
   set name = excluded.name, rejects_cpf = excluded.rejects_cpf;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · `tutor_payout_accounts` — LA PII
-- ════════════════════════════════════════════════════════════════════════════
--
-- Una fila por tutor: dLocal Go quiere UN beneficiario por payout y no guarda
-- ninguno, así que aquí no hay «cuentas guardadas» que elegir. La PK es el
-- propio tutor.
--
-- El patrón es el de `verification_documents` (`20260706150000`), que es el
-- precedente correcto y está completo: tabla propia, RLS de dueño, `anon` fuera,
-- `service_role` fuera, y toda la escritura por RPC `security definer` que lee
-- `auth.uid()` dentro. Con dos diferencias, y las dos son a más:
--
--   · Aquí NO hay política de admin. En KYC el admin lee porque APROBAR LA
--     IDENTIDAD ES SU TRABAJO (RN-29): `review_document` no puede decidir sin
--     mirar el documento. Ese razonamiento no se traslada — ninguna tarea de
--     admin sobre payouts necesita el número de cuenta: `admin_payout_action`
--     mueve estados, y el motivo de un fallo vuelve del PSP a
--     `payouts.failure_reason` y `provider_metadata`, que el admin ya lee.
--     Abrirla «por si soporte la necesita» convierte el panel en un libro
--     bancario permanentemente legible por cualquiera con el rol, leído además
--     con la sesión del admin desde un Server Component: a un `.select("*")`
--     distraído de acabar en un payload de RSC. El proyecto ya tiene precedente
--     de negárselo al admin: `messages` le da 0 filas por RN-41
--     (`docs/QA-LANZAMIENTO.md` §4.4). Cuando haya un `failed` de verdad que
--     atender, lo que hará falta es una superficie ENMASCARADA (país, banco,
--     ····1234, completa sí/no) — y se escribe ESE día, porque una función
--     `security definer` sobre datos bancarios que hoy no llama nadie es
--     superficie de ataque sin contrapartida.
--
--   · La lectura del propio tutor está ENMASCARADA por column-grants. La RLS
--     filtra filas, no columnas; los grants sí. `bank_account` y
--     `beneficiary_document` no tienen `grant select` para NADIE, así que
--     PostgREST no puede devolverlos por ninguna puerta, ni con un `select=*`
--     (que ahí falla con permission denied) ni por un embed.
--
-- La línea, para que se pueda revisar de un vistazo: **lo que identifica a la
-- PERSONA o a su CUENTA no se devuelve nunca; lo que identifica al BANCO sí.**
-- Por eso `bank_code`, `bank_account_type` y `bank_branch` sí se leen —son
-- «qué banco, qué oficina, qué tipo», y el tutor los necesita para comprobar que
-- se registró bien— y `beneficiary_document` y `bank_account` no.
--
-- ── ¿Y EL NÚMERO ENTERO, CUANDO EL TUTOR VUELVE A ENTRAR? ───────────────────
--
-- NO. Se le enseña `····1234` (columna generada, precedente literal
-- `payment_methods.last4`, `20260709200000:16` «solo display; NO es el PAN»).
-- El motivo no es ceremonia: devolverlo entero significa que CADA visita a
-- /tutor/payouts mete un número de cuenta en el payload del RSC, en la caché del
-- navegador y en la pantalla de un locutorio, a cambio de cero capacidad nueva
-- —el tutor ya sabe su número de cuenta— y de un riesgo que no controlamos.
-- El `····1234` más el banco y el tipo de documento contestan la única pregunta
-- que se hace de verdad al volver: «¿registré la cuenta correcta?». Un dígito
-- equivocado EN MEDIO no lo caza el ojo; lo caza el formato de dLocal.
--
-- Y para que enmascarar no obligue a retecleárselo todo por cambiar una letra
-- del apellido, `upsert_payout_account` acepta null en los dos campos sensibles
-- con el significado «deja el que ya está» — el mismo patrón que un formulario
-- de contraseña. Con una excepción deliberada: si el tutor CAMBIÓ de país, no se
-- conserva nada, porque una cuenta mexicana no es una cuenta argentina.
create table public.tutor_payout_accounts (
  tutor_id                  uuid        primary key
                            references public.profiles (id) on delete cascade,

  -- País CONGELADO en el momento de guardar, y no una lectura de
  -- `tutor_profiles.payout_country`. Son dos datos distintos: aquel dice dónde
  -- cobra HOY, este dice de qué país son ESTOS datos. Si el tutor cambia el
  -- primero, la pantalla tiene que poder decirle «tus datos son de MX y ahora
  -- cobras en AR», y `payout_beneficiary` tiene que negarse a construir un
  -- beneficiario con las coordenadas del país equivocado.
  country                   char(2)     not null
                            references public.payout_country_rules (country),

  beneficiary_first_name    text        not null
                            check (btrim(beneficiary_first_name) <> ''
                                   and length(beneficiary_first_name) <= 80),
  beneficiary_last_name     text        not null
                            check (btrim(beneficiary_last_name) <> ''
                                   and length(beneficiary_last_name) <= 80),

  -- Documento fiscal, NORMALIZADO: sin puntos, guiones ni espacios y en
  -- mayúsculas. La doc de dLocal da "450.539.758-09" y "45053975809" como el
  -- mismo CPF, así que guardar el formateado sería guardar dos verdades para el
  -- mismo dato. Lo normaliza `upsert_payout_account`; este check es la red.
  beneficiary_document_type text        not null
                            check (beneficiary_document_type ~ '^[A-Z]{2,10}$'),
  beneficiary_document      text        not null
                            check (beneficiary_document ~ '^[0-9A-Z]{4,20}$'),

  bank_code                 text        not null,
  -- La cuenta NO se normaliza igual: en Brasil y Uruguay el guion y los ceros de
  -- delante son parte del formato del banco. Se quitan espacios y poco más.
  bank_account              text        not null
                            check (bank_account ~ '^[0-9A-Za-z.-]{4,34}$'),
  -- Lo único de la cuenta que sale de la base de datos hacia el navegador.
  -- `right()` es inmutable, así que puede ser generada y almacenada.
  bank_account_last4        text        generated always as (right(bank_account, 4)) stored,

  -- Nullables porque hay países que no los usan. Quién decide si hacen falta es
  -- la fila de reglas, no el esquema (ver la cabecera).
  bank_account_type         text
                            check (bank_account_type is null or bank_account_type in
                                   ('CHECKING','SAVINGS','SALARY','VISTA','MASTER','MAESTRA','ALIAS','CBU')),
  bank_branch               text
                            check (bank_branch is null or bank_branch ~ '^[0-9A-Za-z-]{1,10}$'),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- El banco tiene que existir Y ser de este país. Es la única de las cuatro
  -- validaciones cruzadas que puede vivir en el esquema, y por eso vive aquí:
  -- un `bank_code` de otro país es el error que más caro sale (se descubre como
  -- REJECTED, semanas después). Las otras tres —formato de cuenta, formato de
  -- documento, y el veto de CPF de Brasil— dependen de una regex guardada en
  -- otra tabla y de la combinación de tres columnas: eso un `check` no lo puede
  -- mirar (tendría que consultar otra tabla, que Postgres no garantiza), así que
  -- van en `payout_account_check`.
  foreign key (country, bank_code)
    references public.payout_banks (country, bank_code)
);

create trigger tutor_payout_accounts_set_updated_at
  before update on public.tutor_payout_accounts
  for each row execute function public.set_updated_at();

comment on table public.tutor_payout_accounts is
  'Datos de cobro del tutor: lo que viaja ENTERO en cada POST /v1/payouts de dLocal Go, que no guarda beneficiarios. Es la tabla con más PII del proyecto después de verification_documents y sigue su mismo patrón: RLS de dueño, sin anon, sin service_role, escritura SOLO por upsert_payout_account (RPC security definer) y lectura enmascarada por column-grants — bank_account y beneficiary_document no tienen grant select para nadie, así que PostgREST no puede devolverlos por ninguna puerta. NO tiene política de admin a propósito: ninguna tarea de admin sobre payouts necesita el número de cuenta. La lee payout_beneficiary(payout_id), que es el único sitio del sistema donde se lee un número de cuenta entero — si algún día Legal pide una traza de acceso, va ahí.';

comment on column public.tutor_payout_accounts.country is
  'País al que corresponden ESTOS datos, congelado al guardarlos. No es tutor_profiles.payout_country (dónde cobra hoy): si el tutor cambia de país, esta columna es lo que permite decirle "tus datos son de MX y ahora cobras en AR" en vez de mandar coordenadas de un país a otro. payout_beneficiary exige que coincida con payouts.payee_country.';

comment on column public.tutor_payout_accounts.beneficiary_document is
  'Documento fiscal del tutor (CUIT/CUIL, CPF/CNPJ, RUT, CI, CURP/RFC, DNI/RUC/CE/PASS…), normalizado sin puntos ni guiones y en mayúsculas: la doc de dLocal da "450.539.758-09" y "45053975809" como el mismo CPF. SIN grant select para ningún rol — al tutor se le devuelve el TIPO, no el número.';

comment on column public.tutor_payout_accounts.bank_account is
  'Número de cuenta tal y como lo exige el país (CBU o alias en AR, CLABE en MX, CCI en PE, SIPAP en PY, formato por banco en BR y UY). Solo se le quitan los espacios: en Brasil y Uruguay el guion y los ceros de delante son parte del formato. SIN grant select para ningún rol; lo que se devuelve es bank_account_last4.';

comment on column public.tutor_payout_accounts.bank_account_last4 is
  'Los cuatro últimos caracteres, para enseñar "····1234". Precedente literal: payment_methods.last4 (20260709200000:16, "solo display; NO es el PAN"). Es lo único de la cuenta que sale hacia el navegador, y contesta la única pregunta que el tutor se hace al volver a la pantalla: si registró la cuenta correcta.';

-- ── RLS: default-deny y una sola política ───────────────────────────────────
-- SOLO select, y solo de la fila propia. No hay política de insert, update ni
-- delete para nadie: la escritura entera pasa por `upsert_payout_account`, que
-- es `security definer` y por tanto no necesita ni política ni grant. Que no
-- exista la política es el segundo cerrojo — si mañana alguien añadiera un
-- `grant insert` por costumbre, seguiría sin poder escribir (regla de oro 1).
alter table public.tutor_payout_accounts enable row level security;

create policy "tutor_payout_accounts_select_own"
  on public.tutor_payout_accounts for select
  to authenticated
  using ( (select auth.uid()) = tutor_id );

-- ── Grants por columna: aquí es donde se enmascara ──────────────────────────
-- Ausentes a propósito: `beneficiary_document` y `bank_account`. Un `select=*`
-- sobre esta tabla devuelve 42501, que es exactamente lo que se quiere.
grant select (
  tutor_id,
  country,
  beneficiary_first_name,
  beneficiary_last_name,
  beneficiary_document_type,
  bank_code,
  bank_account_last4,
  bank_account_type,
  bank_branch,
  created_at,
  updated_at
) on public.tutor_payout_accounts to authenticated;

-- `anon`: NADA. Es el aviso entero de esta migración.
-- `service_role`: NADA, y conviene dejar por escrito por qué, porque el impulso
-- natural es dárselo (`20260901130000` acaba de hacerlo con `payouts` y
-- `payout_items`, con la regla de oro 9 por delante).
--
-- Se eligió lo contrario: C2 no necesita LA TABLA, necesita UN BENEFICIARIO POR
-- ORDEN, y eso es una función. Con `grant select` cualquiera de los Route
-- Handlers que hacen `createAdminClient()` puede leer el libro bancario entero
-- con una línea, y no hay forma de distinguir «C2 pagando la orden 4f2a» de «un
-- .select("*") distraído en un embed que acabó en un RSC». La función, en
-- cambio, recibe el `payout_id`, comprueba que ese payout es ejecutable, que su
-- país cuadra con el de la cuenta y que los datos siguen siendo válidos, y
-- devuelve SOLO los campos que van en ese POST. Un `select` plano no puede hacer
-- nada de eso. Es además lo mismo que ya dice la QA ejecutada: el dinero se
-- mueve por RPC SECURITY DEFINER, nunca por PATCH (regla de oro 2 y 7).
--
-- El coste es una función más y un `.rpc()` en vez de un `.from()`. La ganancia
-- es que la tabla queda inalcanzable por PostgREST para TODOS los roles —igual
-- que `verification_documents` hoy— y que hay UN solo sitio grepeable donde se
-- lee un número de cuenta.


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · `payout_account_check` — la validación fuerte, y por qué vive aquí
-- ════════════════════════════════════════════════════════════════════════════
--
-- LA VERDAD LA MANDA EL SERVIDOR. Hay tres sitios donde podría estar y solo uno
-- sirve:
--
--   · Un `check` de tabla NO PUEDE. Las reglas dependen de otra tabla
--     (`payout_country_rules`, `payout_banks`), y un `check` que consulta otra
--     tabla no es válido en Postgres —el planificador no garantiza que se
--     reevalúe cuando cambia la otra tabla, y `pg_dump`/restore lo rompe—. Lo
--     que sí es un check, y lo es, son los invariantes que no dependen de nadie:
--     longitudes, charset, el enum de `bank_account_type`, y la FK del banco.
--
--   · Un Route Handler SÍ es servidor, pero es UN camino. Mientras la tabla no
--     tenga grants de escritura da igual, y si algún día los tuviera, un PATCH
--     directo a PostgREST se lo saltaría entero. La validación tiene que estar
--     en el mismo sitio que la escritura, no al lado.
--
--   · Una función SQL llamada desde la RPC que ES la única puerta de escritura:
--     esto. Es lo mismo que hace `submit_document` con el KYC
--     (`20260724130100:49`) y por el mismo motivo — revalidar dentro, porque
--     corre como SECURITY DEFINER y ahí ya no hay RLS que ayude.
--
-- Devuelve NULL si todo cuadra, o el mensaje del primer fallo. Mensaje, no
-- booleano: el tutor tiene que poder arreglarlo sin escribirle a nadie, y
-- «revisa los datos» no es arreglable.
--
-- ⚠️ NO valida dígitos verificadores. La doc dice «apply verification algorithm»
-- para la CLABE mexicana y los RUC de Ecuador y Paraguay, y NO publica el
-- algoritmo. Escribirlo de memoria significa rechazar cuentas buenas, que es el
-- único error de esta pantalla que no tiene arreglo desde el lado del tutor. El
-- verificador lo comprueba dLocal en el POST y vuelve como REJECTED, con motivo.
create or replace function public.payout_account_check(
  p_country       char(2),
  p_document_type text,
  p_document      text,
  p_bank_code     text,
  p_account_type  text,
  p_account       text,
  p_branch        text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rules   public.payout_country_rules%rowtype;
  v_bank    public.payout_banks%rowtype;
  v_pattern text;
begin
  select * into v_rules
    from public.payout_country_rules r
   where r.country = p_country;

  if not found then
    return 'Todavía no podemos transferir a ese país.';
  end if;

  -- ── Documento ─────────────────────────────────────────────────────────────
  -- Las claves del jsonb son a la vez la lista de tipos admitidos: si el tipo no
  -- está, no hay regex y no hay payout.
  v_pattern := v_rules.document_patterns ->> p_document_type;
  if v_pattern is null then
    return format(
      'El tipo de documento «%s» no vale para %s. Admitidos: %s.',
      coalesce(p_document_type, '—'), p_country,
      (select string_agg(k, ', ' order by k)
         from jsonb_object_keys(v_rules.document_patterns) as k)
    );
  end if;
  if p_document is null or p_document !~ v_pattern then
    return format('El %s no tiene el formato que pide %s. Revísalo: va sin puntos ni guiones.',
                  p_document_type, p_country);
  end if;

  -- ── Banco ─────────────────────────────────────────────────────────────────
  select * into v_bank
    from public.payout_banks b
   where b.country = p_country and b.bank_code = p_bank_code;

  if not found or not v_bank.is_active then
    return 'Ese banco no está en la lista de bancos con los que podemos pagar en tu país. Si el tuyo no aparece, escríbenos: nos falta a nosotros.';
  end if;

  -- Brasil: los ocho códigos que solo aceptan CNPJ. Se comprueba aquí y no en un
  -- check porque cruza tres cosas —país, banco y tipo de documento— y una de
  -- ellas vive en otra tabla.
  if v_bank.rejects_cpf and p_document_type = 'CPF' then
    return format('%s no acepta pagos a un CPF, solo a un CNPJ. Elige otro banco o registra el CNPJ.',
                  v_bank.name);
  end if;

  -- ── Tipo de cuenta ────────────────────────────────────────────────────────
  -- `'{}'` = el país no lo desglosa → no se pide y no se manda. Exigir uno ahí
  -- sería inventarse un valor que dLocal quizá rechace.
  if cardinality(v_rules.account_types) > 0 then
    if p_account_type is null then
      return format('Falta el tipo de cuenta. En %s puede ser: %s.',
                    p_country, array_to_string(v_rules.account_types, ', '));
    end if;
    if not (p_account_type = any (v_rules.account_types)) then
      return format('«%s» no es un tipo de cuenta válido en %s. Admitidos: %s.',
                    p_account_type, p_country,
                    array_to_string(v_rules.account_types, ', '));
    end if;
  elsif p_account_type is not null then
    return format('En %s no se indica tipo de cuenta.', p_country);
  end if;

  -- ── Cuenta ────────────────────────────────────────────────────────────────
  -- La regex se busca primero por tipo de cuenta (Argentina: el CBU y el alias
  -- tienen formatos distintos) y si no, por la clave '*' (país de formato único:
  -- CLABE, SIPAP, CCI). Sin ninguna de las dos, el país no documenta el formato
  -- y manda el `check` genérico de la tabla, que ya corrió antes de llegar aquí.
  v_pattern := coalesce(
    v_rules.account_patterns ->> p_account_type,
    v_rules.account_patterns ->> '*'
  );
  if p_account is null or btrim(p_account) = '' then
    return format('Falta el número de cuenta (%s).', v_rules.account_label);
  end if;
  if v_pattern is not null and p_account !~ v_pattern then
    return format('El campo «%s» no tiene el formato correcto. %s',
                  v_rules.account_label, v_rules.account_help);
  end if;

  -- ── Sucursal ──────────────────────────────────────────────────────────────
  if v_rules.requires_branch then
    if p_branch is null or btrim(p_branch) = '' then
      return format('Falta la sucursal (agência), que en %s es obligatoria.', p_country);
    end if;
    if v_rules.branch_pattern is not null and p_branch !~ v_rules.branch_pattern then
      return 'La sucursal no tiene el formato correcto.';
    end if;
  end if;

  return null;
end;
$$;

comment on function public.payout_account_check(char, text, text, text, text, text, text) is
  'Valida unos datos de cobro contra payout_country_rules y payout_banks. Devuelve null si cuadran, o el mensaje del PRIMER fallo — mensaje y no booleano porque el tutor tiene que poder arreglarlo solo. Aquí viven las cuatro validaciones que un check de tabla no puede hacer: formato de documento por tipo, formato de cuenta por tipo, tipo de cuenta admitido, y el veto de CPF de los ocho bancos brasileños. NO valida dígitos verificadores: dLocal dice "apply verification algorithm" sin publicar el algoritmo (CLABE, RUC de EC y PY), y un algoritmo inventado rechaza cuentas buenas — eso lo comprueba dLocal en el POST y vuelve como REJECTED. La llaman upsert_payout_account y payout_beneficiary; nadie más tiene execute.';

-- Nadie la llama directamente: la usan las dos funciones SECURITY DEFINER de
-- abajo, que corren como el dueño. En Postgres el EXECUTE se concede a PUBLIC
-- por defecto, así que sin este revoke sería `POST /rest/v1/rpc/…` abierto — y
-- aunque esta no devuelve datos, sí es un oráculo gratis sobre los formatos.
revoke execute on function public.payout_account_check(char, text, text, text, text, text, text) from public;
revoke execute on function public.payout_account_check(char, text, text, text, text, text, text) from anon;
revoke execute on function public.payout_account_check(char, text, text, text, text, text, text) from authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · `upsert_payout_account` — la única puerta de escritura
-- ════════════════════════════════════════════════════════════════════════════
--
-- Calcada de `submit_document` (`20260724130100:49,101`) y por el mismo motivo:
-- el país decide qué es válido, y un `grant insert` columna a columna —que es lo
-- que A0 hizo con `payout_country`— no puede comprobar nada. La diferencia con
-- A0 es real y conviene no confundirla: aquel razonamiento («no es dinero, es la
-- clave con la que el dinero se rutea») valía para un ISO-3166 de dos letras;
-- aquí lo que se escribe solo es válido en función de OTRA columna y de una
-- lista cerrada que el navegador no puede comprobar.
--
-- ⚠️ NO se bloquea con la baja programada `pending`, y es deliberado. La
-- cabecera de `20260831160000` dice que la cuenta desactivada puede entrar y
-- conserva el rol de tutor precisamente para ver «Mis ingresos»; y un payout
-- `failed` está fallido, muy probablemente, PORQUE ESTOS DATOS ESTABAN MAL. El
-- único que puede arreglarlo es él. Bloquear el formulario al desactivar sería
-- el mismo interbloqueo que se describe abajo, entrando por otra puerta.
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
end;
$$;

comment on function public.upsert_payout_account(text, text, text, text, text, text, text, text) is
  'La ÚNICA puerta de escritura de tutor_payout_accounts (la tabla no tiene grant de insert/update para ningún rol, ni política). Lee auth.uid() y el payout_country del propio tutor —el país no lo manda el cliente, para que no se pueda declarar uno y mandar datos de otro—, normaliza, valida con payout_account_check y hace upsert. p_document y p_account admiten null con el significado "deja el guardado", que es la contrapartida de enmascarar la lectura; salvo que el tutor haya cambiado de país, en cuyo caso no se conserva nada. Devuelve el resumen ENMASCARADO (····1234), nunca la fila. NO se bloquea con una baja programada pending: un payout failed suele estarlo porque estos datos estaban mal, y el único que puede arreglarlo es el tutor.';

revoke execute on function public.upsert_payout_account(text, text, text, text, text, text, text, text) from public;
revoke execute on function public.upsert_payout_account(text, text, text, text, text, text, text, text) from anon;
grant  execute on function public.upsert_payout_account(text, text, text, text, text, text, text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · `payout_beneficiary` — la única lectura del número entero
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 Y AQUÍ ESTÁ EL FALLO MÁS GRAVE POSIBLE DE TODO ESTE DISEÑO, que es no
-- escribir las cuatro líneas de abajo. En Postgres el EXECUTE de una función
-- nueva se concede a PUBLIC POR DEFECTO, y PostgREST publica las funciones de
-- `public` como `POST /rest/v1/rpc/<nombre>`. Una `security definer` que
-- devuelve cuentas bancarias, sin revoke, es un endpoint ANÓNIMO que devuelve
-- números de cuenta. El proyecto ya escribe el revoke completo en cada RPC
-- sensible (`20260901130000:245-247`, `20260901140000:504-506`); aquí no es
-- costumbre, es el cerrojo.
--
-- Qué devuelve y qué no: los campos del beneficiario del `POST /v1/payouts` y
-- las tres constantes que no dependen del tutor (`flow_type`, `purpose`,
-- `transfer_country`). NO devuelve `transfer_amount`, y no es un olvido: el
-- saldo del tutor está en USD y `currency_to_pay` es la moneda del país, así que
-- convertir es una decisión de A2 con su tipo de cambio y su redondeo — no algo
-- que esta función pueda adivinar. `payouts.amount` ya lo tiene C2 delante.
create or replace function public.payout_beneficiary(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    'bank_branch',                v_acc.bank_branch
  );
end;
$$;

comment on function public.payout_beneficiary(uuid) is
  'Construye el beneficiario de UN payout concreto para el POST /v1/payouts de dLocal Go. Es el único sitio del sistema donde se lee un número de cuenta entero, y existe para que no haya un grant select sobre tutor_payout_accounts: recibe la orden, comprueba que es ejecutable (scheduled/processing), que tiene país de destino, que el país de los datos coincide con payouts.payee_country y que los datos siguen validando, y devuelve solo los campos del POST. NO devuelve transfer_amount: el saldo está en USD y currency_to_pay es la moneda del país, así que la conversión es decisión de A2. ⚠️ Sin el revoke de execute a public sería un endpoint anónimo que devuelve números de cuenta.';

-- 🔴 Las cuatro líneas que no se pueden olvidar.
revoke execute on function public.payout_beneficiary(uuid) from public;
revoke execute on function public.payout_beneficiary(uuid) from anon;
revoke execute on function public.payout_beneficiary(uuid) from authenticated;
grant  execute on function public.payout_beneficiary(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 9 · Ciclo de vida — `anonymize_account` se lleva los datos bancarios
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se reemplaza la función entera (regla de oro 5: la migración de
-- `20260827130000` es inmutable y esto la supersede). El cuerpo es BYTE A BYTE
-- el suyo salvo el `delete` nuevo y su comentario, en el bloque 3.6 —el de las
-- filas puramente personales, junto a `verification_documents` y
-- `payment_methods`—; se extrajo y se le añadió esa línea en vez de reescribirlo,
-- para no meter deriva. El porqué de que vaya ahí y no en
-- `request_account_deletion` está escrito dentro, al lado del `delete`, que es
-- donde se lee.
--
-- ⚠️ Y ojo con lo que NO se puede hacer aunque parezca lo mismo: volcar el
-- CUERPO de la petición a dLocal en `payouts.provider_metadata` (que C2 tiene
-- con `grant update` desde `20260901130000:310-318`) haría este borrado
-- COSMÉTICO. `payouts` no se borra nunca —es contabilidad— y `payouts_select_admin`
-- deja a cualquier admin leer ese jsonb de por vida: el `beneficiary_document` y
-- el `bank_account` quedarían copiados ahí para siempre. En `provider_metadata`
-- va la RESPUESTA (id, estado, motivo), nunca el beneficiario. Lo mismo con
-- `account_deletions.summary`.
create or replace function public.anonymize_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers   jsonb;
  v_roles      text[];
  v_ya         timestamptz;
  v_marcador   text := 'Usuario eliminado';
  v_correo     text := 'cuenta-eliminada+' || p_user_id::text || '@ensenameya.invalid';
  -- ⚠️ `v_ficheros` YA NO es un contador: es el mapa `{bucket: [rutas]}` que la
  -- función recolecta y devuelve para que lo barra el Route Handler.
  v_ficheros   jsonb := '{}'::jsonb;
  v_n_ficheros int   := 0;
  v_resumen    jsonb;
begin
  if p_user_id is null then
    raise exception 'falta el usuario' using errcode = '22004';
  end if;

  -- IDEMPOTENCIA. Ejecutarla dos veces no debe romper nada: si ya hay rastro,
  -- se sale sin tocar. Importa de verdad — un reintento del cliente tras un
  -- timeout llega aquí con la cuenta ya vaciada, y sin esta guarda volvería a
  -- recorrer las quince tablas para no cambiar nada.
  --
  -- ⚠️ Y AHORA IMPORTA EL DOBLE. Desde que el barrido de ficheros vive fuera de
  -- la transacción (ver cabecera), «ya anonimizada» ya no significa «no queda
  -- nada por hacer»: puede quedar el barrido a medias de un intento anterior.
  -- Por eso esta rama devuelve las rutas PENDIENTES guardadas en el rastro, con
  -- la misma forma que la rama `ok`, y quien llame las barre sin distinguir de
  -- qué rama vienen. En la práctica esto cubre las peticiones ya en vuelo (el
  -- doble clic, el reintento por timeout); un reintento posterior no llega
  -- —la sesión ya está muerta, ver la cabecera—, pero devolverlas igualmente
  -- es lo que hace que un futuro barrido de admin no tenga que reinventarlas.
  select ad.deleted_at, ad.summary into v_ya, v_resumen
    from public.account_deletions ad where ad.user_id = p_user_id;
  if v_ya is not null then
    return jsonb_build_object(
      'status',                'ya_anonimizada',
      'deleted_at',            v_ya,
      'ficheros',              coalesce(v_resumen -> 'ficheros', '{}'::jsonb),
      'ficheros_recolectados', coalesce((v_resumen ->> 'ficheros_recolectados')::int, 0)
    );
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'la cuenta no existe' using errcode = 'P0002';
  end if;

  -- Segundo cerrojo sobre los bloqueos. El handler ya los consultó para pintar
  -- la pantalla, pero entre aquello y esto la persona pudo comprar una clase.
  v_blockers := public.account_deletion_blockers(p_user_id);
  if v_blockers <> '{}'::jsonb then
    raise exception 'la cuenta no puede darse de baja todavía: %', v_blockers
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(ur.role::text order by ur.role), '{}')
    into v_roles
    from public.user_roles ur where ur.user_id = p_user_id;

  -- ── 3.1) Storage: RECOLECTAR las rutas, NO borrarlas ────────────────────
  -- ⚠️ ESTE BLOQUE SOLÍA BORRAR Y POR ESO LA BAJA DEVOLVÍA 500. Es SELECT a
  -- propósito: ver la cabecera (error 42501). No lo devuelvas a `delete`.
  --
  -- ⚠️ Y LA FUENTE ES `storage.objects`, NO LAS COLUMNAS QUE APUNTAN A ELLOS.
  -- Es tentador sacar las rutas de `profiles.avatar_path`,
  -- `tutor_profiles.avatar_path`, `products.image_path`,
  -- `verification_documents.storage_path` y `tutor_materials.storage_path`,
  -- que es lo primero que se le ocurre a cualquiera. No vale, por dos motivos:
  --   · Se van TODAS dentro de esta misma transacción: las tres primeras se
  --     vacían (§3.2, §3.3, §3.5) y las dos últimas se borran con su fila
  --     (§3.6). Después de anonimizar no queda de dónde leerlas.
  --   · Aunque se leyeran antes, solo listan lo que la app registró. Una subida
  --     que dejó el fichero y falló al guardar la fila NO aparece ahí, y es
  --     justo el huérfano que hay que barrer. El bucket es la lista completa.
  --
  -- El filtro va por prefijo `<uid>/%` en vez de por
  -- `storage.foldername(name))[1]` —que es como lo expresan las políticas—
  -- porque son equivalentes para estos cuatro buckets y el prefijo sí puede
  -- usar el índice de `name`.
  --
  -- `chat-attachments` queda fuera a propósito: trampa 5 de la cabecera.
  --   · avatars         → las dos fotos (trampa 1) viven aquí
  --   · kyc-documents   → documentos de identidad: el dato más fuerte
  --   · tutor-materials → material de clase subido por el tutor
  --   · product-images  → portadas de mentoría; pueden ser su propia cara
  --
  -- Se agrupa POR BUCKET porque la Storage API es por bucket: el handler hace
  -- un `storage.from(<bucket>).remove([...])` por clave, sin tener que partir
  -- cadenas ni adivinar dónde acaba el nombre del bucket.
  select coalesce(jsonb_object_agg(g.bucket_id, g.rutas), '{}'::jsonb),
         coalesce(sum(jsonb_array_length(g.rutas)), 0)
    into v_ficheros, v_n_ficheros
    from (
      select so.bucket_id,
             jsonb_agg(so.name order by so.name) as rutas
        from storage.objects so
       where so.bucket_id in ('avatars', 'kyc-documents', 'tutor-materials', 'product-images')
         and so.name like (p_user_id::text || '/%')
       group by so.bucket_id
    ) g;

  -- ── 3.2) `profiles`: la lápida ──────────────────────────────────────────
  -- Se vacía, NO se borra: es lo que sostiene `bookings.student_id` y
  -- `bookings.tutor_id`, que son `not null`. El nombre se sustituye por un
  -- marcador legible en vez de dejarse a null para que el otro lado de una
  -- reserva vea «Usuario eliminado» y no un hueco en blanco que parece un bug.
  --
  -- `timezone` se queda: no identifica a nadie y las fechas de sus reservas
  -- pasadas se siguen renderizando (RN-01/RN-02).
  -- `stripe_customer_id` se va porque es un identificador personal en un
  -- tercero. No se pierde nada operativo: los reembolsos van por
  -- `payments.provider_payment_id`, no por el cliente de Stripe.
  update public.profiles
     set full_name          = v_marcador,
         phone              = null,
         primary_goal       = null,
         avatar_path        = null,
         referral_code      = null,
         stripe_customer_id = null,
         onboarding_complete = false
   where id = p_user_id;

  -- ── 3.3) `tutor_profiles`: la otra mitad de la identidad ────────────────
  -- El avatar de aquí es el PÚBLICO y es independiente del anterior desde
  -- `20260724170000` (trampa 1). `approval_status = 'suspended'` es lo que
  -- saca al tutor del catálogo: las consultas públicas filtran `= 'approved'`.
  update public.tutor_profiles
     set display_name    = v_marcador,
         avatar_path     = null,
         bio             = null,
         headline        = null,
         socials         = '{}'::jsonb,
         faqs            = '[]'::jsonb,
         approval_notes  = null,
         approval_status = 'suspended'
   where profile_id = p_user_id;

  -- ── 3.4) Las reseñas se quedan, sin autor ───────────────────────────────
  -- Esto es lo que el cliente pidió y lo único que lo hace posible es que la
  -- reserva de la que cuelgan no se borre. `author_display` a null hace que
  -- `home_testimonials` caiga en su `coalesce(…, 'Alumno')`.
  update public.reviews
     set author_display = null
   where student_id = p_user_id;

  -- ── 3.5) Sus mentorías dejan de ofrecerse ───────────────────────────────
  -- `archived`, no borradas: `bookings.product_id` es `on delete restrict`
  -- (`20260709140000:36`) y las reservas se conservan.
  update public.products
     set status     = 'archived',
         image_path = null
   where tutor_id = p_user_id
     and status <> 'archived';

  -- ── 3.6) Filas puramente personales ─────────────────────────────────────
  -- Nada de esto tiene valor contable ni pertenece a otra persona.
  delete from public.verification_documents where tutor_id  = p_user_id;  -- KYC
  -- ⚠️ B1 · LOS DATOS BANCARIOS SE BORRAN AQUÍ, Y SOLO AQUÍ.
  --
  -- Explícito, aunque la FK a `profiles` sea `on delete cascade`: la cascada NO
  -- se dispara nunca, porque `profiles` no se borra, se vacía (3.2). Confiar en
  -- ella dejaría el número de cuenta vivo para siempre.
  --
  -- Y BORRAR, no vaciar: una fila a medias es una fila que `payout_beneficiary`
  -- tendría que aprender a distinguir de una recién creada.
  --
  -- ── POR QUÉ AQUÍ Y NO EN `request_account_deletion` ───────────────────────
  -- Que es donde parece natural ponerlo, porque es donde «se desactiva la
  -- cuenta». Ahí sería un INTERBLOQUEO PERMANENTE: el tutor pide la baja con un
  -- payout `scheduled` → se le borran los datos → C2 no puede construir el
  -- beneficiario → el payout pasa a `failed` → `failed` ESTÁ en la lista de
  -- bloqueos de `account_deletion_state` → `process_pending_account_deletions`
  -- no completa jamás → la cuenta queda desactivada para siempre Y el tutor no
  -- cobra nunca. Y `failed` no se resuelve solo: exige un `admin_payout_action`.
  --
  -- Puesto aquí, la tensión se resuelve sin código extra: esta función YA se
  -- niega a correr mientras haya dinero en vuelo (el cerrojo de bloqueos, más
  -- arriba). Los datos con los que se le paga al tutor sobreviven exactamente
  -- hasta que aterriza el último payout, ni un día más. El corolario para la
  -- pantalla es que /tutor/payouts sigue siendo EDITABLE con la baja `pending`.
  delete from public.tutor_payout_accounts where tutor_id = p_user_id;  -- B1
  delete from public.tutor_materials        where tutor_id  = p_user_id;
  delete from public.payment_methods        where profile_id = p_user_id;
  delete from public.notifications          where recipient_id = p_user_id;
  delete from public.student_interests      where student_id = p_user_id;
  delete from public.tutor_categories       where tutor_id   = p_user_id;
  delete from public.contact_messages       where sender_id  = p_user_id;

  -- La agenda se vacía para que nadie pueda reservar contra una cuenta muerta.
  -- `product_availability_rules` cae sola: su FK a `availability_rules` es
  -- `on delete cascade` (`20260817200000:77`).
  delete from public.availability_exceptions where tutor_id = p_user_id;
  delete from public.availability_rules      where tutor_id = p_user_id;

  -- Los roles se van: la cuenta está muerta y dejar un 'admin' colgando de ella
  -- es superficie de escalada gratis. Por eso se guardan antes en el rastro.
  delete from public.user_roles where user_id = p_user_id;

  -- ⚠️ `messages`, `conversations` y sus adjuntos NO se tocan: trampa 5.
  -- ⚠️ `terms_acceptances` tampoco. Es la prueba de que aceptó los términos
  --    vigentes al comprar, no un dato de contacto: solo guarda uid, versión e
  --    idioma. Borrarla dejaría las reservas conservadas sin su consentimiento.

  -- ── 3.7) Cerrar la puerta ───────────────────────────────────────────────
  -- ⚠️ ESTE ES EL BLOQUE QUE PUEDE FALLAR POR PRIVILEGIOS EN EJECUCIÓN. Ver la
  -- comprobación del final del fichero.
  --
  -- Orden: primero las identidades (que es lo que reconoce Google), después la
  -- fila de usuario, y al final las sesiones vivas.
  --
  -- Borrar `auth.identities` hace DOS cosas, y las dos hacen falta:
  --   a) quita el emparejamiento provider+provider_id, así que «Continuar con
  --      Google» ya no encuentra esta cuenta. Como además el correo queda
  --      liberado (trampa 4), GoTrue crea un usuario NUEVO: exactamente lo que
  --      se quiere, cuenta limpia y sin acceso a lo anterior.
  --   b) borra `identity_data`, un jsonb con el correo, el nombre y la foto de
  --      Google. Sin esto la PII seguiría ahí aunque el acceso estuviera roto.
  delete from auth.identities where user_id = p_user_id;

  -- La fila se conserva —borrarla cascadearía toda la contabilidad— pero se
  -- inutiliza. `banned_until` es lo que mira GoTrue al emitir sesión; se usa
  -- un siglo en vez de 'infinity' porque el `infinity` de Postgres no siempre
  -- sobrevive al parseo de tiempos de GoTrue.
  -- Los campos de token se ponen a '' y no a null: en unas versiones de GoTrue
  -- son `not null default ''` y en otras nulables, y '' vale en las dos.
  update auth.users
     set email                        = v_correo,
         phone                        = null,
         encrypted_password           = null,
         raw_user_meta_data           = '{}'::jsonb,   -- guardaba full_name
         raw_app_meta_data            = '{}'::jsonb,   -- guardaba providers[]
         banned_until                 = now() + interval '100 years',
         email_change                 = '',
         phone_change                 = '',
         confirmation_token           = '',
         recovery_token               = '',
         email_change_token_new       = '',
         email_change_token_current   = '',
         reauthentication_token       = ''
   where id = p_user_id;

  -- Y se le echa AHORA. Sin esto, el JWT que ya tiene en el navegador sigue
  -- siendo válido hasta que caduque (~1 h): estaría baneado y navegando.
  -- ⚠️ `auth.refresh_tokens.user_id` es `varchar`, no `uuid` — de ahí el cast.
  delete from auth.sessions       where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.mfa_factors    where user_id = p_user_id;

  -- ── 3.8) El rastro ──────────────────────────────────────────────────────
  -- ⚠️ AQUÍ SE GUARDAN LAS RUTAS, y no es decorativo: es lo único que hace
  -- recuperable un barrido fallido. Si el handler revienta entre el `commit` y
  -- el `remove()` —se cae el proceso, se agota el tiempo de la función— no
  -- queda NADA de donde reconstruirlas: `profiles.avatar_path` y las demás se
  -- vaciaron hace cuatro bloques, y el log del handler nunca llegó a
  -- escribirse. Sin esta línea, esos ficheros serían huérfanos invisibles.
  --
  -- `ficheros`              → lo que QUEDA por barrer. El handler lo reescribe
  --                           con el resto tras cada pasada; `{}` = terminado.
  -- `ficheros_recolectados` → cuántos había al darse de baja. NO se toca nunca:
  --                           es el número de auditoría.
  v_resumen := jsonb_build_object(
    'ficheros',              v_ficheros,
    'ficheros_recolectados', v_n_ficheros
  );

  insert into public.account_deletions (user_id, roles, summary)
  values (p_user_id, coalesce(v_roles, '{}'), v_resumen)
  on conflict (user_id) do nothing;   -- cinturón: dos llamadas a la vez

  -- Misma forma que la rama de idempotencia en `ficheros` /
  -- `ficheros_recolectados`: el handler barre igual venga de donde venga.
  return jsonb_build_object(
    'status',                'ok',
    'ficheros',              v_ficheros,
    'ficheros_recolectados', v_n_ficheros,
    'roles',                 to_jsonb(coalesce(v_roles, '{}'::text[]))
  );
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 10 · Comprobación en EJECUCIÓN (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `create or replace` valida la sintaxis, NO ejecuta el cuerpo. Es exactamente
-- lo que dejó vivo el fallo de `close_expired_sessions()` durante 12.446
-- corridas: la función se reescribió entera y el `case` sin `::session_status`
-- sobrevivió a la reescritura, porque nadie la llamó.
--
-- Así que aquí se llama. Cuatro casos que ejercitan las cuatro validaciones que
-- no son un `check` de tabla, y si alguno no da lo esperado la migración NO
-- aplica. No escribe nada: `payout_account_check` es `stable` y solo lee.
do $$
declare
  v text;
begin
  -- 1) Argentina bien: CUIT de 11, CBU de 22, banco real (340 = Bacs).
  v := public.payout_account_check('AR', 'CUIT', '20304050607', '340', 'CBU',
                                   '2850590940090418135201', null);
  if v is not null then
    raise exception 'B1: el caso bueno de AR debería validar y devolvió: %', v;
  end if;

  -- 2) Un CBU de 21 dígitos tiene que fallar (formato por tipo de cuenta).
  v := public.payout_account_check('AR', 'CUIT', '20304050607', '340', 'CBU',
                                   '285059094009041813520', null);
  if v is null then
    raise exception 'B1: un CBU de 21 dígitos NO debería validar';
  end if;

  -- 3) Brasil: el 018 es uno de los ocho códigos que rechazan CPF. Y es
  --    justamente uno de los tres que la doc escribe sin el cero de delante.
  v := public.payout_account_check('BR', 'CPF', '45053975809', '018', 'CHECKING',
                                   '123456-7', '1234');
  if v is null then
    raise exception 'B1: el banco 018 de BR NO debería aceptar un CPF';
  end if;
  --    …y con CNPJ el mismo banco sí.
  v := public.payout_account_check('BR', 'CNPJ', '55694732000110', '018', 'CHECKING',
                                   '123456-7', '1234');
  if v is not null then
    raise exception 'B1: el banco 018 de BR con CNPJ debería validar y devolvió: %', v;
  end if;

  -- 4) Un banco de otro país no vale (esto además lo cazaría la FK, pero el
  --    mensaje tiene que ser legible antes de llegar a ella).
  v := public.payout_account_check('MX', 'CURP', 'ABCD800101HDFXYZ01', '340', null,
                                   '032180000118359719', null);
  if v is null then
    raise exception 'B1: un bank_code argentino NO debería valer en MX';
  end if;

  -- 5) Y una CLABE de 18 con un banco mexicano de verdad sí (138 = ABC Capital).
  v := public.payout_account_check('MX', 'CURP', 'ABCD800101HDFXYZ01', '138', null,
                                   '032180000118359719', null);
  if v is not null then
    raise exception 'B1: el caso bueno de MX debería validar y devolvió: %', v;
  end if;

  raise notice 'B1: payout_account_check ejercitada, 6 casos, todo cuadra.';
end;
$$;

-- Y el otro sitio donde este proyecto se ha quemado: los grants, que muerden en
-- tiempo de ejecución y no en el build (regla de oro 9, que ya mordió tres veces
-- el 6-ago). Aquí se comprueba lo contrario de lo habitual —que NADIE de más
-- puede leer la tabla de PII—, porque el fallo de esta migración no es un 42501
-- en un job: es un número de cuenta publicado.
do $$
declare
  v_rol  text;
  v_col  text;
begin
  -- Se pregunta con `has_*_privilege` y no leyendo `information_schema`, porque
  -- esas vistas solo enseñan lo concedido POR o A un rol activo y aquí lo que se
  -- quiere saber es exactamente lo contrario: que NO hay nada.
  --
  -- Ojo: un privilegio concedido a PUBLIC lo heredan todos los roles, así que
  -- preguntar por `anon` y `authenticated` cubre también el caso de un grant a
  -- PUBLIC olvidado — que es el peligroso.
  foreach v_rol in array array['anon', 'service_role'] loop
    foreach v_col in array array['bank_account', 'beneficiary_document', 'tutor_id'] loop
      if has_column_privilege(v_rol::name, 'public.tutor_payout_accounts', v_col, 'select') then
        raise exception 'B1: % puede leer tutor_payout_accounts.% y no debería', v_rol, v_col;
      end if;
    end loop;
    if has_table_privilege(v_rol::name, 'public.tutor_payout_accounts', 'insert')
       or has_table_privilege(v_rol::name, 'public.tutor_payout_accounts', 'update')
       or has_table_privilege(v_rol::name, 'public.tutor_payout_accounts', 'delete') then
      raise exception 'B1: % puede escribir en tutor_payout_accounts — la única puerta es upsert_payout_account', v_rol;
    end if;
  end loop;

  -- `authenticated` lee lo enmascarado y nada más.
  foreach v_col in array array['bank_account', 'beneficiary_document'] loop
    if has_column_privilege('authenticated'::name, 'public.tutor_payout_accounts', v_col, 'select') then
      raise exception 'B1: authenticated puede leer tutor_payout_accounts.% — la lectura tiene que ir enmascarada', v_col;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.tutor_payout_accounts', 'bank_account_last4', 'select') then
    raise exception 'B1: authenticated NO puede leer bank_account_last4 — la pantalla del tutor no podrá enseñar nada';
  end if;
  if has_table_privilege('authenticated', 'public.tutor_payout_accounts', 'insert')
     or has_table_privilege('authenticated', 'public.tutor_payout_accounts', 'update') then
    raise exception 'B1: authenticated puede escribir en tutor_payout_accounts por PostgREST';
  end if;

  -- 🔴 El cerrojo del bloque 8. Si esto salta, hay un endpoint que devuelve
  -- números de cuenta a quien lo llame.
  if has_function_privilege('anon', 'public.payout_beneficiary(uuid)', 'execute') then
    raise exception 'B1: payout_beneficiary es ejecutable por anon — endpoint anónimo con datos bancarios';
  end if;
  if has_function_privilege('authenticated', 'public.payout_beneficiary(uuid)', 'execute') then
    raise exception 'B1: payout_beneficiary es ejecutable por authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.payout_beneficiary(uuid)', 'execute') then
    raise exception 'B1: service_role NO puede ejecutar payout_beneficiary — C2 no podrá pagar';
  end if;
  if has_function_privilege('authenticated', 'public.payout_account_check(char, text, text, text, text, text, text)', 'execute') then
    raise exception 'B1: payout_account_check quedó ejecutable por authenticated';
  end if;

  raise notice 'B1: superficie comprobada — la PII no la lee ni anon, ni service_role, ni authenticated.';
end;
$$;
