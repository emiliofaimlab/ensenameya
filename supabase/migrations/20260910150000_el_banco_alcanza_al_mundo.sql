-- ══════════════════════════════════════════════════════════════════════════════
-- EL FORMULARIO BANCARIO DEJA DE SER DE NUEVE PAÍSES
--
-- Fase 3 del dictado de pagos (`docs/DICTADO-PAGOS.md` §4 y §8). La aclaración
-- del cliente del 9-sep-2026 dice: «el formulario bancario se le ofrece a todo
-- tutor cuyo país cubra Wise, dLocal o Stripe». `payout_country_rules` es la
-- puerta de ese formulario —`page.tsx` quita la tarjeta de Banco cuando el país
-- no tiene fila— y tenía NUEVE: AR BR CL CO EC MX PE PY UY. Un tutor español
-- veía PayPal y nada más.
--
-- Esta migración añade 44 países. No trae un proveedor nuevo: trae DATOS y
-- formatos de cuenta, que es exactamente lo que el dictado anticipó.
--
-- ── LO QUE SE MIDIÓ, EL 9-SEP-2026, CONTRA LA API EN VIVO DE WISE ───────────
--
-- Perfil business 136151426, `api.transferwise.com` (producción, no sandbox).
-- Dos niveles de medida, y la diferencia importa:
--
--   (1) `POST /v3/profiles/136151426/quotes` + `GET /v1/quotes/{id}/account-
--       requirements` → qué TIPO de cuenta pide cada moneda y con qué campos.
--   (2) `POST /v1/accounts` con datos de prueba → si Wise ACEPTA de verdad ese
--       destinatario. Es la medida dura: (1) describe el formulario, (2) es la
--       llamada que hará el adaptador. Los 20 destinatarios creados para medir
--       se borraron con `DELETE /v2/accounts/{id}` (la cuenta quedó en 0).
--
-- `GET /v1/currency-pairs` → 103 monedas destino desde USD. No están VES, CUP,
-- RUB ni IRR; y el `valuesAllowed` de `address.country` trae 229 países SIN VE,
-- CU, RU ni IR. Los cuatro países que el dictado manda no abrir no son una
-- decisión de producto: Wise no los tiene en la lista.
--
-- VERIFICADO CON UN 200 DE `POST /v1/accounts`:
--   iban              → ES, PT, IE, AT, NL, EE (EUR) · CH (CHF) · SE (SEK) · EG (EGP)
--   sort_code         → GB (GBP), sortCode 231470 + accountNumber 28821822
--   aba               → US (USD), abartn 021000021 + address.state
--   swift_code        → PA (USD, BAGEPAPA) · SV (USD, BAMCSVSS y BSALSVSS)
--                       BO (BOB, BSOLBOLP) · NI (NIO, BAMCNIMA) · RS (RSD)
--   costa_rica        → CR (CRC), IBAN + idDocumentType
--   australian        → AU (AUD), bsbCode + address.state
--   indian            → IN (INR), ifscCode HDFC0000001 y SBIN0000001
--   emirates          → AE (AED), IBAN
--   israeli_local     → IL (ILS), IBAN
--   turkish_earthport → TR (TRY), IBAN
--
-- 🔴 LOS TRES DESCUBRIMIENTOS QUE OBLIGAN A TOCAR EL ESQUEMA
--
-- 1. **`aba` y `australian` exigen `address.state`.** Literal: `422
--    address.state = "Please enter a state."`, y con el estado puesto el mismo
--    cuerpo devuelve 200. Es un campo que esta base no tenía: la búsqueda de
--    dirección de `20260907120000` añadió calle, ciudad, código postal y
--    teléfono, y ahí no hacía falta. Sin él, Estados Unidos —el país que Stripe
--    NO puede pagar (dictado §3)— no es pagable por nadie. Por eso hay columna
--    nueva y por eso `upsert_payout_account` cambia de firma.
--
-- 2. **El segundo número del banco no cabía en `bank_branch`.** Su `check` era
--    `^[0-9A-Za-z-]{1,10}$` y un BIC mide 8 U ONCE caracteres (regex de Wise:
--    `^[a-zA-Z]{6}(([a-zA-Z0-9]{2})|([a-zA-Z0-9]{5}))$`), igual que un IFSC
--    indio. Se amplía a 11.
--
-- 3. **Ese segundo número LO TECLEA EL TUTOR, no sale de un catálogo.** Y eso es
--    una decisión, no una comodidad:
--      · El `abartn` de Estados Unidos cambia por banco Y por estado. Medido:
--        021000021 (Chase NY) y 322271627 (Chase CA) → 200; 121000248, 026009593
--        y 111000025 → 422. Los tres que fallan son números de *wire*, no de
--        ACH. Un catálogo «un banco = un routing» habría dado por bueno el
--        número equivocado en la mitad de los casos.
--      · Del BIC no tenemos lista y Wise no publica una: valida contra su propio
--        directorio. Medido: de 20 BIC candidatos, 5 devolvieron 200 y 15 «Please
--        enter a valid SWIFT code». Es decir, **Wise rechaza el BIC que no
--        conoce**, así que un dedazo no manda el dinero a otro banco: no crea el
--        destinatario. Esa es la red que un catálogo nuestro no daría.
--    Por eso el segundo número viaja en `bank_branch`, que es la columna que YA
--    modela «el otro número que identifica al banco» (la agência de Brasil y la
--    sucursal de Uruguay), y por eso `payout_beneficiary_wise` pasa a devolverlo:
--    hasta hoy no lo devolvía y el adaptador leía el código de `payout_banks`.
--
-- ── LOS PAÍSES QUE **NO** SE ABREN, Y LA MEDIDA QUE LO DICE ─────────────────
--
--   · **VE, CU, RU, IR** — no están en las 229 opciones de `address.country`.
--     Venezuela sigue cobrando por canal manual (dictado §3), y así se queda.
--   · **HN (Honduras)** — `422 legalType = "Recipient type is not valid for this
--     type of account"` con dos BIC distintos (BAMCHNTE, BAPRHNTE). Wise no paga
--     HNL por SWIFT a una PERSONA. Y pide además `taxNumber`, que no figura en
--     `account-requirements`.
--   · **DO (Rep. Dominicana)** — `422 swiftCode = "Sorry, we dont support
--     payments to this country"` con un BIC dominicano válido. Es la única
--     negativa de PAÍS que devolvió la API en toda la medición.
--   · **CA, JP, IN(UPI), NG, KE, ID, MY, PH, TH, ZA, SG, HK, KR, MA, NP, LK, GH,
--     VN** — todas piden un `bankCode` que es un **select** de valores cerrados
--     que sirve Wise (y Canadá pide TRES números: institution, transit y
--     account, y aquí solo hay dos huecos). Abrirlas no es una fila: es un
--     importador de esos `valuesAllowed` a `payout_banks`, con su `wise_bank_code`
--     país por país. Es una historia propia y está anotada como tal, no
--     resuelta a medias. India sí entra porque su `indian` pide un IFSC de texto
--     libre, no un select.
--   · **BR** — sigue en null por lo de `20260907120000`: sus 803 códigos de Wise
--     no se parecen a nuestros 146 COMPE. dLocal le paga.
--
-- ── POR QUÉ HAY UN BANCO «CENTINELA» POR PAÍS ───────────────────────────────
--
-- `tutor_payout_accounts.bank_code` es `not null` y tiene FK compuesta contra
-- `payout_banks (country, bank_code)`. En un país de IBAN no hay banco que
-- elegir —el IBAN lo lleva dentro— pero la FK sigue pidiendo una fila. Se siembra
-- UNA por país, con el código del formato (`IBAN`, `SWIFT`, `ABA`, `SORT`, `BSB`,
-- `IFSC`) y un nombre que dice la verdad. El formulario, cuando el país tiene un
-- solo banco, no pinta desplegable: lo elige él y no se lo pregunta a nadie.
--
-- La alternativa era hacer `bank_code` nullable, y no se hace porque
-- `validarCuenta` (`src/lib/payout-account.ts`) exige que el código esté en la
-- lista de bancos del país, así que un null habría dejado el formulario
-- diciendo «Elige tu banco» sin banco que elegir.
--
-- ── UNA COSA QUE ESTA MIGRACIÓN NO ARREGLA, Y CONVIENE SABER ────────────────
--
-- `document_patterns` no puede estar vacío (`check ... <> '{}'`), pero los tipos
-- `iban`, `aba`, `sort_code`, `australian` y `indian` **no mandan el documento a
-- nadie**: Wise no lo pide en esos corredores. Esas filas piden `TAX`
-- (identificador fiscal) o `PASS` (pasaporte) porque el esquema obliga, no porque
-- haga falta para pagar. El día que `beneficiary_document` pueda ser null, esas
-- 38 filas lo agradecerán. Los tipos que SÍ lo mandan son `colombia`, `uruguay`,
-- `argentina` (taxId), `chile` (rut) y el nuevo `costa_rica`.
-- ══════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · El segundo número del banco necesita once caracteres
-- ════════════════════════════════════════════════════════════════════════════
alter table public.tutor_payout_accounts
  drop constraint tutor_payout_accounts_bank_branch_check;

alter table public.tutor_payout_accounts
  add constraint tutor_payout_accounts_bank_branch_check
  check (bank_branch is null or bank_branch ~ '^[0-9A-Za-z-]{1,11}$');

comment on column public.tutor_payout_accounts.bank_branch is
  'El OTRO número que identifica al banco, cuando el número de cuenta no lo lleva dentro. Era la agência de Brasil y la sucursal de Uruguay; desde el 10-sep-2026 es también el número de ruta ACH de Estados Unidos (9 dígitos), el sort code británico (6), el BSB australiano (6), el IFSC indio (11) y el BIC/SWIFT de los países que Wise solo alcanza por SWIFT (8 u 11 — de ahí el tope de 11 y no de 10). Qué es exactamente en cada país lo dice payout_country_rules.branch_pattern; el rótulo que ve el tutor sale de wise_account_type.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · El beneficiario tiene estado o provincia
-- ════════════════════════════════════════════════════════════════════════════
--
-- Nullable, por lo mismo que los cuatro de `20260907120000`: solo dos corredores
-- lo exigen y ponerlo `not null` rompería el guardado a los nueve países que ya
-- cobran sin él. Quien no lo tenga simplemente no entra en el riel de Wise si su
-- país lo pide, y lo dice `wise_puede_pagar_a()`.
--
-- Texto y no un enum: Wise lo sirve como `select` de 58 valores para Estados
-- Unidos y de 8 para Australia, y las dos listas son suyas y pueden cambiar.
-- El `check` deja pasar el código corto que las dos usan (FL, CA, NSW, QLD) sin
-- fijar cuáles son válidos: eso lo dice Wise en el POST, con su mensaje.
alter table public.tutor_payout_accounts
  add column beneficiary_state text
    check (beneficiary_state is null or beneficiary_state ~ '^[A-Za-z]{2,3}$');

comment on column public.tutor_payout_accounts.beneficiary_state is
  'Estado o provincia del beneficiario, en el código corto (FL, CA, NSW, QLD). Lo exigen DOS corredores de Wise y ninguno lo dice en su documentación: medido el 9-sep-2026, `POST /v1/accounts` de tipo `aba` (Estados Unidos) y `australian` (Australia) devuelve `422 address.state = "Please enter a state."`, y con el estado puesto el mismo cuerpo devuelve 200. Nullable: los países que no lo piden siguen guardando sin él.';

-- Entra en el grant por columna de `authenticated`, como los cuatro de la
-- dirección: el tutor tiene que poder releerlo y corregirlo. Fuera siguen
-- `bank_account` y `beneficiary_document`.
grant select (beneficiary_state) on public.tutor_payout_accounts to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Los tipos de cuenta de Wise que este proyecto sabe describir
-- ════════════════════════════════════════════════════════════════════════════
--
-- El `check` de `20260907120000` ya admitía `iban`, `aba` y `swift_code` —los
-- dejó preparados sin usarlos— pero no los seis que la medición de hoy añade.
-- Se amplía la lista, no se afloja: sigue siendo cerrada, porque su trabajo es
-- cazar la errata que dejaría a un país con un tipo que el adaptador no conoce.
alter table public.payout_country_rules
  drop constraint payout_country_rules_wise_account_type_check;

alter table public.payout_country_rules
  add constraint payout_country_rules_wise_account_type_check
  check (wise_account_type is null or wise_account_type in (
    -- Los de `20260907120000`.
    'colombia', 'argentina', 'mexican', 'chile', 'uruguay', 'brazil',
    'iban', 'aba', 'swift_code',
    -- Los medidos el 9-sep-2026, uno a uno, con un 200 de POST /v1/accounts.
    'sort_code', 'costa_rica', 'australian', 'indian',
    'emirates', 'israeli_local', 'turkish_earthport'
  ));

comment on column public.payout_country_rules.wise_account_type is
  'El `type` de recipient que pide Wise para este país, o null si Wise no le paga o si no tenemos los datos que ese tipo exige. Null NO es «pendiente»: es lo que hace que el resolvedor descarte el riel y la orden caiga al siguiente candidato. Sigue en null: BR (sus códigos de banco son de otro espacio de nombres), PE/PY (solo swift_code, y su moneda no lo ofrece), y los países cuyo tipo pide un bankCode de lista cerrada que Wise sirve y nosotros no tenemos (CA, JP, NG, KE, ID, MY, PH, TH, ZA, SG, HK, KR, MA, NP, LK, GH, VN). No están ni estarán VE, CU, RU ni IR: no figuran en las 229 opciones de address.country.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Los países de IBAN — un formato para treinta y uno
-- ════════════════════════════════════════════════════════════════════════════
--
-- Zona euro (20) más las once monedas cuyo `account-requirements` ofrece `iban`:
-- CHF, DKK, NOK, SEK, PLN, CZK, HUF, RON, UAH, PKR, EGP. En PL, CZ y HU el tipo
-- «nativo» de Wise es otro (`polish`, `czech`, `hungarian`) pero `iban` está en
-- la lista y es el que se usa: un formato menos que mantener.
--
-- ⚠️ EL PATRÓN DE CUENTA **NO** FIJA LA LONGITUD POR PAÍS, y no es pereza. Un
-- residente en España puede tener un IBAN alemán (N26, Revolut…) y la normativa
-- SEPA prohíbe rechazarlo por eso. Anclar el patrón a `^ES` habría bloqueado un
-- caso legítimo y frecuente. Se valida lo que de verdad distingue un IBAN de un
-- número de cuenta local —dos letras y de 14 a 34 caracteres— y el resto lo
-- valida Wise, que comprueba el dígito de control y su propio directorio de
-- bancos: medido, un IBAN con banco inventado devuelve 422 y NO crea nada.
insert into public.payout_country_rules
  (country, currency, account_label, account_help,
   account_types, account_patterns, document_patterns,
   requires_branch, branch_pattern, wise_account_type, notas)
select
  p.country, p.currency,
  'IBAN',
  'Tu IBAN completo, con las dos letras del país delante. Cópialo sin espacios. El IBAN ya lleva dentro qué banco es el tuyo, así que no hay lista de bancos que elegir.',
  '{}'::text[],
  '{"*": "^[A-Za-z]{2}[0-9A-Za-z]{12,32}$"}'::jsonb,
  '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
  false, null,
  'iban',
  'Tipo `iban` de Wise, verificado con un 200 de POST /v1/accounts en ES, PT, IE, AT, NL y EE (EUR), CH (CHF), SE (SEK) y EG (EGP) el 9-sep-2026. En las demás monedas de este grupo el tipo `iban` sale de GET /v1/quotes/{id}/account-requirements; los 422 que dieron los IBAN de ejemplo fueron siempre del IBAN («We cannot currently accept payments to this recipient»), nunca del país. Wise pide solo IBAN + dirección: ni banco, ni tipo de cuenta, ni documento. Los tipos TAX y PASS existen porque document_patterns no puede estar vacío; ese dato no viaja a ningún proveedor.'
from (values
  -- Zona euro (20).
  ('AT','EUR'),('BE','EUR'),('CY','EUR'),('DE','EUR'),('EE','EUR'),
  ('ES','EUR'),('FI','EUR'),('FR','EUR'),('GR','EUR'),('HR','EUR'),
  ('IE','EUR'),('IT','EUR'),('LT','EUR'),('LU','EUR'),('LV','EUR'),
  ('MT','EUR'),('NL','EUR'),('PT','EUR'),('SI','EUR'),('SK','EUR'),
  -- Las otras once monedas con corredor de IBAN.
  ('CH','CHF'),('DK','DKK'),('NO','NOK'),('SE','SEK'),('PL','PLN'),
  ('CZ','CZK'),('HU','HUF'),('RO','RON'),('UA','UAH'),('PK','PKR'),
  ('EG','EGP')
) as p(country, currency);


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Los tres países cuyo tipo propio de Wise es «un IBAN y nada más»
-- ════════════════════════════════════════════════════════════════════════════
--
-- `emirates`, `israeli_local` y `turkish_earthport` piden exactamente lo mismo
-- que `iban` —un IBAN— pero con nombre de tipo distinto, así que son tres filas
-- y tres `case` en el mapeo. Aquí sí se fija la longitud, porque el propio Wise
-- la fija: su `validationRegexp` para AED es `^AE\d{21}$` y para ILS
-- `^IL\d{2}([-_\s]?\d{4}){4}[-_\s]?\d{3}$`, que sin separadores es
-- `^IL[0-9]{21}$`. En TRY no publica regex y la longitud sale de su propio
-- ejemplo (26 caracteres).
insert into public.payout_country_rules
  (country, currency, account_label, account_help,
   account_types, account_patterns, document_patterns,
   requires_branch, branch_pattern, wise_account_type, notas)
values
  ('AE', 'AED',
   'IBAN',
   'Tu IBAN de los Emiratos: AE y 21 dígitos, sin espacios. El IBAN ya identifica a tu banco.',
   '{}'::text[],
   '{"*": "^AE[0-9]{21}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   false, null, 'emirates',
   'Tipo `emirates`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026. La regex es la que publica Wise (^AE\d{21}$). Sus campos `nationality` y `dateOfBirth` figuran como OPCIONALES y no se piden.'),

  ('IL', 'ILS',
   'IBAN',
   'Tu IBAN israelí: IL y 21 dígitos, sin espacios ni guiones.',
   '{}'::text[],
   '{"*": "^IL[0-9]{21}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   false, null, 'israeli_local',
   'Tipo `israeli_local`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026. Wise acepta separadores (^IL\d{2}([-_\s]?\d{4}){4}[-_\s]?\d{3}$); aquí se exige sin ellos porque upsert_payout_account quita los espacios y el guion se guardaría tal cual.'),

  ('TR', 'TRY',
   'IBAN',
   'Tu IBAN turco: TR y 24 dígitos, sin espacios.',
   '{}'::text[],
   '{"*": "^TR[0-9]{24}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   false, null, 'turkish_earthport',
   'Tipo `turkish_earthport`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026. Wise NO publica regex para este campo; la longitud (26 caracteres en total) sale de su propio ejemplo y de la norma del IBAN turco.');


-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Costa Rica — IBAN más documento, que es su propio tipo
-- ════════════════════════════════════════════════════════════════════════════
--
-- El único país nuevo cuyo corredor SÍ manda el documento del tutor. Wise lo
-- pide como `idDocumentType` de tres valores (NATIONAL_ID_CARD, FOREIGN_ID,
-- BUSINESS_ID) y aquí se ofrecen los dos de persona física: cédula y DIMEX. La
-- traducción a los literales de Wise vive en `wise-mapeo.ts`, como la de Uruguay.
insert into public.payout_country_rules
  (country, currency, account_label, account_help,
   account_types, account_patterns, document_patterns,
   requires_branch, branch_pattern, wise_account_type, notas)
values
  ('CR', 'CRC',
   'IBAN',
   'Tu cuenta IBAN de Costa Rica: CR y 20 dígitos, sin espacios. Te la da tu banco; el IBAN ya identifica el banco y la cuenta.',
   '{}'::text[],
   '{"*": "^CR[0-9]{20}$"}'::jsonb,
   '{"CI": "^[0-9]{9}$", "DIMEX": "^[0-9]{11,12}$"}'::jsonb,
   false, null, 'costa_rica',
   'Tipo `costa_rica`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 (IBAN CR23…, idDocumentType NATIONAL_ID_CARD). Es el único de los países nuevos que manda el documento a Wise: CI → NATIONAL_ID_CARD y DIMEX → FOREIGN_ID, traducidos en wise-mapeo.ts. BUSINESS_ID (cédula jurídica) no se ofrece: los tutores son personas físicas y el legalType que admite el corredor es PRIVATE.');


-- ════════════════════════════════════════════════════════════════════════════
-- 7 · Los cinco países con DOS números: cuenta y código del banco
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reino Unido, Estados Unidos, Australia, India y los siete de SWIFT. El segundo
-- número va en `bank_branch` con `requires_branch = true`, y su formato en
-- `branch_pattern`. Los patrones son los `validationRegexp` que devuelve Wise,
-- copiados y no interpretados — con una sola concesión: se admiten mayúsculas y
-- minúsculas porque Wise las admite y `upsert_payout_account` no pasa el campo
-- a mayúsculas.
insert into public.payout_country_rules
  (country, currency, account_label, account_help,
   account_types, account_patterns, document_patterns,
   requires_branch, branch_pattern, wise_account_type, notas)
values
  ('GB', 'GBP',
   'Número de cuenta',
   'Los ocho dígitos de tu cuenta. El sort code va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9]{8}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$', 'sort_code',
   'Tipo `sort_code`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 (sortCode 231470, accountNumber 28821822). Regex de Wise: accountNumber [0-9]{8}, sortCode ^\d{2}-?\d{2}-?\d{2}$. El GBP también admite `iban` y `swift_code`; se elige sort_code porque es el dato que un británico tiene a mano y el corredor local, que es el barato.'),

  ('US', 'USD',
   'Número de cuenta',
   'El número de tu cuenta, entre 4 y 17 dígitos. El número de ruta va en el campo de al lado, y elige arriba si la cuenta es corriente o de ahorro.',
   array['CHECKING', 'SAVINGS'],
   '{"*": "^[0-9]{4,17}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[0-9]{9}$', 'aba',
   '⚠️ EL PAÍS QUE STRIPE NO PUEDE PAGAR (dictado §3: nuestra plataforma es de EE. UU. y el acuerdo recipient no vale «for platforms in US creating accounts in US»), y por SWIFT tampoco: medido, USD con swift_code a una cuenta estadounidense devuelve «you cant send USD via Swift to accounts inside the United States or its territories». Solo queda `aba`, verificado con un 200 el 9-sep-2026. DOS trampas medidas: (1) exige address.state, de ahí la columna beneficiary_state; (2) el número de ruta tiene que ser el de la ACH y no el de wire — 021000021 y 322271627 devolvieron 200, mientras 121000248, 026009593 y 111000025 (números de wire) devolvieron 422. Por eso el número lo teclea el tutor y no sale de un catálogo: el mismo banco tiene routing distinto por estado.'),

  ('AU', 'AUD',
   'Número de cuenta',
   'El número de tu cuenta, entre 4 y 9 dígitos. El BSB va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9]{4,9}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[0-9]{3}-?[0-9]{3}$', 'australian',
   'Tipo `australian`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 (bsbCode 802985) — y solo DESPUÉS de añadir address.state: sin él, 422 «Please enter a state.», igual que Estados Unidos. Regex de Wise: bsbCode ^\d{3}-?\d{3}$, accountNumber ^\d{4,9}$.'),

  ('IN', 'INR',
   'Número de cuenta',
   'El número de tu cuenta, de 5 a 20 caracteres. El código IFSC va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{5,20}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{4}0[A-Za-z0-9]{6}$', 'indian',
   'Tipo `indian`. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 con DOS IFSC distintos (HDFC0000001 y SBIN0000001). Entra —y sus vecinas de tamaño parecido no— porque el IFSC es texto libre con regex publicada, mientras que NG, KE, ID, PH, TH, ZA, SG, JP y CA piden un bankCode de lista cerrada que sirve Wise. El otro tipo de INR, `indian_upi`, pide un identificador UPI y no una cuenta: no se ofrece.'),

  ('PA', 'USD',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado; te lo dan en tu banca en línea.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   '⚠️ EL PAÍS CON MÁS TUTORES DESPUÉS DE VENEZUELA (3 de 24) Y ESTABA CERRADO POR UNA MEDIDA MAL HECHA. `20260907120000` escribió que Panamá no era pagable porque «USD→PAB devuelve 422 error.route.not.supported», y es verdad: el balboa NO está entre las 103 monedas de Wise. Pero Panamá cobra en DÓLARES, y USD→USD con swift_code y un BIC panameño (BAGEPAPA, Banco General) devuelve 200 — verificado dos veces el 9-sep-2026. Se midió el corredor con la moneda equivocada.'),

  ('SV', 'USD',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   'Mismo corredor que Panamá (USD por SWIFT) y misma razón para estar aquí. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 con DOS BIC salvadoreños (BAMCSVSS y BSALSVSS). Otros tres candidatos devolvieron «Please enter a valid SWIFT code», que es Wise diciendo que no conoce ese BIC — y es la red que hace seguro que el tutor lo teclee: un BIC desconocido no crea destinatario.'),

  ('GT', 'GTQ',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   '⚠️ VERIFICACIÓN PARCIAL, y conviene decirlo. Wise ACEPTÓ el BIC guatemalteco (INDLGTGC, Banco Industrial): el único 422 que devolvió fue «accountNumber: Please enter a valid account number», con el número inventado que se usó para medir. Es decir, el corredor GTQ existe y el BIC está en su directorio; lo que no se pudo comprobar es un número de cuenta real. Si un tutor guatemalteco no logra guardar, el primer sospechoso es el formato de la cuenta y no el país.'),

  ('BO', 'BOB',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   'Tipo `swift_code` en BOB. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 (BSOLBOLP, Banco Sol). Seis BIC bolivianos más devolvieron «Please enter a valid SWIFT code»: el directorio de Wise no cubre todos los bancos del país, así que un tutor boliviano puede tener banco y no tener riel. Eso lo dice la API al guardar, no nosotros al adivinar.'),

  ('NI', 'NIO',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   'Tipo `swift_code` en NIO. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 (BAMCNIMA, Banco de América Central). Nicaragua entra y Honduras NO, aunque los dos parezcan el mismo caso: en HNL la misma llamada devuelve «Recipient type is not valid for this type of account» con legalType PRIVATE, o sea que Wise no paga por SWIFT a una persona física allí.'),

  ('RS', 'RSD',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   'Tipo `swift_code` en RSD. Verificado con un 200 de POST /v1/accounts el 9-sep-2026 (RZBSRSBG, cuenta de 18 dígitos).'),

  ('IS', 'ISK',
   'Número de cuenta',
   'El número de tu cuenta, sin espacios ni guiones. El código BIC o SWIFT de tu banco va en el campo de al lado.',
   '{}'::text[],
   '{"*": "^[0-9A-Za-z]{4,34}$"}'::jsonb,
   '{"TAX": "^[0-9A-Z]{4,20}$", "PASS": "^[0-9A-Z]{4,20}$"}'::jsonb,
   true, '^[A-Za-z]{6}([A-Za-z0-9]{2}|[A-Za-z0-9]{5})$', 'swift_code',
   '⚠️ VERIFICACIÓN PARCIAL, igual que Guatemala: Wise aceptó el BIC islandés (NBIIISRE, Landsbankinn) y solo se quejó del número de cuenta inventado. El corredor ISK existe y el único tipo que ofrece es swift_code.');


-- ════════════════════════════════════════════════════════════════════════════
-- 8 · El banco centinela — una fila por país nuevo
-- ════════════════════════════════════════════════════════════════════════════
--
-- La FK de `tutor_payout_accounts` obliga a que exista, y el nombre está escrito
-- para el único sitio donde el tutor lo puede llegar a leer: la línea «Guardado:
-- ····1234 · <banco>». El formulario no pinta desplegable cuando el país tiene
-- un solo banco, así que nadie tiene que elegir esto.
insert into public.payout_banks (country, bank_code, name)
select r.country,
       case r.wise_account_type
         when 'aba'        then 'ABA'
         when 'sort_code'  then 'SORT'
         when 'australian' then 'BSB'
         when 'indian'     then 'IFSC'
         when 'swift_code' then 'SWIFT'
         else 'IBAN'
       end,
       case r.wise_account_type
         when 'aba'        then 'Tu banco, identificado por el número de ruta'
         when 'sort_code'  then 'Tu banco, identificado por el sort code'
         when 'australian' then 'Tu banco, identificado por el BSB'
         when 'indian'     then 'Tu banco, identificado por el código IFSC'
         when 'swift_code' then 'Tu banco, identificado por el código BIC/SWIFT'
         else 'Tu banco, identificado por el IBAN'
       end
  from public.payout_country_rules r
 where r.country in (
   'AT','BE','CY','DE','EE','ES','FI','FR','GR','HR','IE','IT','LT','LU','LV',
   'MT','NL','PT','SI','SK','CH','DK','NO','SE','PL','CZ','HU','RO','UA','PK',
   'EG','AE','IL','TR','CR','GB','US','AU','IN','PA','SV','GT','BO','NI','RS','IS'
 )
on conflict (country, bank_code) do update
   set name = excluded.name, is_active = true;


-- ════════════════════════════════════════════════════════════════════════════
-- 9 · ¿Puede Wise pagarle a ESTE tutor? — la pregunta gana tres condiciones
-- ════════════════════════════════════════════════════════════════════════════
--
-- Sigue siendo UNA sola definición con dos llamadores (`datos_de_cobro_del_tutor`
-- y `payout_beneficiary_wise`), por lo que dice `20260907120000`: escribirla dos
-- veces es escribir el bug. Lo que se le añade:
--
--   · los tipos de dos números exigen `bank_branch`;
--   · `aba` y `australian` exigen además `beneficiary_state`;
--   · `costa_rica` exige un documento que Wise sepa traducir.
--
-- Y lo que NO cambia: la lista de tipos que necesitan `wise_bank_code` sigue
-- siendo la de los cuatro países con catálogo traducido. Los tipos nuevos no
-- miran `payout_banks` para nada — su banco lo dice el número que teclea el
-- tutor —, así que meterlos ahí los habría dejado a todos fuera en silencio.
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
       and r.wise_account_type is not null
       -- Los cuatro que Wise exige en todos sus corredores.
       and a.beneficiary_address_line is not null
       and a.beneficiary_city         is not null
       and a.beneficiary_postcode     is not null
       and a.beneficiary_phone        is not null
       -- Estados Unidos y Australia: sin estado, 422 «Please enter a state.»
       and (r.wise_account_type not in ('aba', 'australian')
            or a.beneficiary_state is not null)
       -- Los tipos que identifican el banco por CÓDIGO TRADUCIDO.
       and (r.wise_account_type not in ('colombia', 'brazil', 'chile', 'uruguay')
            or b.wise_bank_code is not null)
       -- Los tipos que identifican el banco por un SEGUNDO NÚMERO que teclea el
       -- tutor: sort code, número de ruta, BSB, IFSC, BIC.
       and (r.wise_account_type not in
              ('sort_code', 'aba', 'australian', 'indian', 'swift_code')
            or a.bank_branch is not null)
       -- Argentina: Wise quiere el CBU, no el alias.
       and (r.wise_account_type <> 'argentina' or a.bank_account_type = 'CBU')
       -- Uruguay: su idDocumentType solo admite cédula o RUT.
       and (r.wise_account_type <> 'uruguay'
            or a.beneficiary_document_type in ('CI', 'RUT'))
       -- Costa Rica: idem, cédula o DIMEX. Es el único de los países nuevos que
       -- manda el documento del tutor a Wise.
       and (r.wise_account_type <> 'costa_rica'
            or a.beneficiary_document_type in ('CI', 'DIMEX'))
  );
$$;

comment on function public.wise_puede_pagar_a(uuid) is
  'La única definición de «Wise puede pagarle a este tutor con lo que tiene registrado». La consultan el resolvedor (vía datos_de_cobro_del_tutor.banco_wise) y el adaptador (vía payout_beneficiary_wise). Que un riel PUEDA pagar y que pueda pagarle A ESTE TUTOR son dos preguntas distintas: confundirlas dejó a un tutor venezolano con Zinli sin cobrar nunca, y en silencio. Desde el 10-sep-2026 mira también el estado (aba, australian), el segundo número del banco (sort_code, aba, australian, indian, swift_code) y el documento de Costa Rica.';

revoke execute on function public.wise_puede_pagar_a(uuid) from public;
revoke execute on function public.wise_puede_pagar_a(uuid) from anon;
revoke execute on function public.wise_puede_pagar_a(uuid) from authenticated;
grant  execute on function public.wise_puede_pagar_a(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 10 · El beneficiario de Wise devuelve el segundo número y el estado
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 ESTO ES LO QUE FALTABA PARA QUE EL MAPEO PUDIERA EXISTIR. Hasta hoy esta
-- función NO devolvía `bank_branch`, y su hermana de Brasil lo dice con nombre y
-- apellidos: «Brasil necesita branchCode, que sale de bank_branch y que
-- payout_beneficiary_wise no devuelve». Sin esta línea, `sort_code`, `aba`,
-- `australian`, `indian` y `swift_code` no tendrían de dónde sacar el código del
-- banco y el adaptador habría tenido que leer `tutor_payout_accounts` por su
-- cuenta — que es justo lo que no puede hacer (service_role no tiene select).
--
-- El resto del cuerpo es el de `20260907120000` sin un cambio: las mismas
-- comprobaciones, en el mismo orden, y sigue sin devolver importe.
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

  v_error := public.payout_account_check(
    v_acc.country, v_acc.beneficiary_document_type, v_acc.beneficiary_document,
    v_acc.bank_code, v_acc.bank_account_type, v_acc.bank_account, v_acc.bank_branch
  );
  if v_error is not null then
    raise exception 'los datos de cobro del tutor ya no son válidos: %', v_error
      using errcode = 'check_violation';
  end if;

  if not public.wise_puede_pagar_a(v_payout.tutor_id) then
    raise exception 'los datos de cobro del tutor no le sirven a wise'
      using errcode = 'check_violation';
  end if;

  select * into v_rules from public.payout_country_rules r where r.country = v_acc.country;
  select * into v_bank  from public.payout_banks b
   where b.country = v_acc.country and b.bank_code = v_acc.bank_code;

  return jsonb_build_object(
    'wise_account_type',   v_rules.wise_account_type,
    'transfer_country',    v_acc.country,
    'currency_to_pay',     v_rules.currency,
    'account_holder_name', v_acc.beneficiary_first_name || ' ' || v_acc.beneficiary_last_name,
    'legal_type',          'PRIVATE',
    'wise_bank_code',      v_bank.wise_bank_code,
    -- 🆕 El segundo número del banco, tal y como lo teclea el tutor. Es el
    -- sortCode, el abartn, el bsbCode, el ifscCode o el swiftCode según el tipo.
    'bank_branch',         v_acc.bank_branch,
    'bank_account',        v_acc.bank_account,
    'bank_account_type',   v_acc.bank_account_type,
    'document_type',       v_acc.beneficiary_document_type,
    'document',            v_acc.beneficiary_document,
    'phone',               v_acc.beneficiary_phone,
    'address', jsonb_build_object(
      'country',   v_acc.country,
      'city',      v_acc.beneficiary_city,
      'firstLine', v_acc.beneficiary_address_line,
      'postCode',  v_acc.beneficiary_postcode,
      -- 🆕 Y el estado, que va DENTRO de address porque es donde Wise lo pide
      -- (`address.state`). Null donde no se pide, y el mapeo lo omite entonces.
      'state',     v_acc.beneficiary_state
    )
  );
end;
$$;

comment on function public.payout_beneficiary_wise(uuid) is
  'El beneficiario de un payout con la forma que pide Wise, que no es la de dLocal. Hermana de payout_beneficiary y por el mismo motivo que destino_connect y payout_identifier_beneficiary: cada riel remoto se trae su puerta. Revalida al ejecutar (no solo al guardar) y NO devuelve el importe. Desde el 10-sep-2026 devuelve bank_branch —el sort code, el número de ruta, el BSB, el IFSC o el BIC— y address.state, sin los cuales los tipos de cuenta nuevos no se pueden construir.';

revoke execute on function public.payout_beneficiary_wise(uuid) from public;
revoke execute on function public.payout_beneficiary_wise(uuid) from anon;
revoke execute on function public.payout_beneficiary_wise(uuid) from authenticated;
grant  execute on function public.payout_beneficiary_wise(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 11 · `upsert_payout_account` aprende a guardar el estado
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 `drop` + `create`, Y ESO PIERDE LOS GRANTS — la misma nota que
-- `20260907130000` escribió y por la misma razón: `create or replace` exige los
-- mismos tipos de argumento, así que añadir uno crearía una función SOBRECARGADA
-- y PostgREST no sabría a cuál llamar. El `grant` a `authenticated` se repite
-- abajo y hay una autocomprobación que se niega a terminar sin él: sin ese
-- grant, el formulario del tutor deja de guardar y no lo dice nadie.
--
-- El argumento nuevo va AL FINAL y con default, para que una llamada de doce
-- argumentos —la que hay desplegada hoy— siga siendo válida mientras el
-- despliegue nuevo llega.
drop function if exists public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text
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
  p_address_line  text default null,
  p_city          text default null,
  p_postcode      text default null,
  p_phone         text default null,
  p_state         text default null
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
      beneficiary_phone, beneficiary_state
    )
    values (
      v_uid, v_country,
      btrim(p_first_name), btrim(p_last_name),
      v_doc_type, v_doc,
      v_bank, v_account, v_acc_type, v_branch,
      v_addr, v_city, v_post, v_phone, v_state
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
           beneficiary_state         = excluded.beneficiary_state
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
$$;

comment on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) is
  'La ÚNICA vía de escritura a tutor_payout_accounts: la tabla no tiene política de insert ni de update para nadie. El país sale de tutor_profiles y no del cliente. Documento, cuenta, dirección, teléfono y estado en blanco significan «deja el que ya está», que es la contrapartida de que la lectura vaya enmascarada. El argumento p_state se añadió el 10-sep-2026: lo exigen los corredores `aba` (Estados Unidos) y `australian` de Wise, medido.';

revoke execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) from public;
revoke execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) from anon;
grant execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 12 · Autocomprobaciones
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ AFIRMAN LO QUE ESTA MIGRACIÓN ESCRIBE, NUNCA EL ESTADO DEL AMBIENTE. Es
-- una lección que este repositorio ya pagó: `20260907120000` dejó escrito «no
-- quedaron exactamente 5 países con riel de Wise», y una cuenta absoluta como esa
-- convierte cualquier migración posterior —esta— en un despliegue roto. Aquí no
-- hay ni un `count(*) = N` sobre la tabla entera: solo «los 46 países que acabo
-- de tocar están, con el tipo que les puse y con su banco».
do $$
declare
  v_paises text[] := array[
    'AT','BE','CY','DE','EE','ES','FI','FR','GR','HR','IE','IT','LT','LU','LV',
    'MT','NL','PT','SI','SK','CH','DK','NO','SE','PL','CZ','HU','RO','UA','PK',
    'EG','AE','IL','TR','CR','GB','US','AU','IN','PA','SV','GT','BO','NI','RS','IS'
  ];
  v_falta  text;
begin
  -- 1 · Las 46 filas existen y ninguna se quedó sin riel de Wise. Un `insert`
  -- que no entra no falla solo: deja al país sin fila, y sin fila la pantalla
  -- quita la tarjeta de Banco sin decir por qué. Es el fallo de esta migración
  -- que más costaría ver.
  select string_agg(p, ', ') into v_falta
    from unnest(v_paises) as p
   where not exists (
     select 1 from public.payout_country_rules r
      where r.country = p and r.wise_account_type is not null
   );
  if v_falta is not null then
    raise exception 'estos países no quedaron con regla y riel de Wise: %', v_falta;
  end if;

  -- 2 · Cada uno tiene su banco centinela ACTIVO, o la FK de
  -- `tutor_payout_accounts` haría fallar el guardado del primer tutor que
  -- llegue — y el mensaje que vería sería «Ese banco no está en la lista».
  select string_agg(p, ', ') into v_falta
    from unnest(v_paises) as p
   where not exists (
     select 1 from public.payout_banks b where b.country = p and b.is_active
   );
  if v_falta is not null then
    raise exception 'estos países no tienen ningún banco activo: %', v_falta;
  end if;

  -- 3 · Y tienen EXACTAMENTE uno, que es lo que hace que el formulario no pinte
  -- un desplegable de bancos con una sola opción. Si algún día uno de estos
  -- países recibe un catálogo de verdad, esta línea salta y hay que decidir a
  -- conciencia si la pantalla vuelve a preguntar por el banco.
  select string_agg(p, ', ') into v_falta
    from unnest(v_paises) as p
   where (select count(*) from public.payout_banks b
           where b.country = p and b.is_active) <> 1;
  if v_falta is not null then
    raise exception 'estos países nuevos no tienen exactamente un banco: %', v_falta;
  end if;

  -- 4 · Los cinco tipos de dos números exigen sucursal, y los de IBAN no. Un
  -- `requires_branch` mal puesto es un campo que se pide y no se manda (o al
  -- revés, un BIC que nadie teclea y un payout que no se puede construir).
  if exists (
    select 1 from public.payout_country_rules
     where wise_account_type in ('sort_code','aba','australian','indian','swift_code')
       and (not requires_branch or branch_pattern is null)
  ) then
    raise exception 'hay un país de dos números sin requires_branch o sin branch_pattern';
  end if;
  if exists (
    select 1 from public.payout_country_rules
     where wise_account_type in ('iban','emirates','israeli_local',
                                 'turkish_earthport','costa_rica')
       and requires_branch
  ) then
    raise exception 'hay un país de IBAN pidiendo sucursal, que no existe ahí';
  end if;

  -- 5 · Venezuela y los otros tres que Wise no lista siguen fuera. La medida:
  -- no están entre las 229 opciones de address.country.
  if exists (
    select 1 from public.payout_country_rules
     where country in ('VE','CU','RU','IR') and wise_account_type is not null
  ) then
    raise exception 'algún país que Wise no admite quedó con riel de Wise';
  end if;

  -- 6 · La columna nueva y su grant. Sin el `grant select` el formulario no
  -- puede releer el estado guardado; sin la columna, nada de lo de arriba sirve.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tutor_payout_accounts'
       and column_name = 'beneficiary_state'
  ) then
    raise exception 'no se creó tutor_payout_accounts.beneficiary_state';
  end if;
  if not has_column_privilege('authenticated',
       'public.tutor_payout_accounts', 'beneficiary_state', 'select') then
    raise exception 'authenticated no puede leer beneficiary_state';
  end if;

  -- 7 · Los grants de las funciones, que el `drop` se lleva por delante
  -- (regla de oro 9: esto no falla en el build, falla en producción al guardar).
  if not has_function_privilege('authenticated',
       'public.upsert_payout_account(text,text,text,text,text,text,text,text,text,text,text,text,text)',
       'execute') then
    raise exception 'authenticated no puede ejecutar upsert_payout_account: el formulario del tutor está roto';
  end if;
  if has_function_privilege('anon',
       'public.upsert_payout_account(text,text,text,text,text,text,text,text,text,text,text,text,text)',
       'execute') then
    raise exception 'anon puede ejecutar upsert_payout_account';
  end if;
  -- Y que no haya quedado la vieja viva al lado: dos funciones con el mismo
  -- nombre y todos los argumentos con default = PostgREST sin saber a cuál ir.
  if (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'upsert_payout_account') <> 1 then
    raise exception 'hay más de una upsert_payout_account: PostgREST no sabrá a cuál llamar';
  end if;
  if not has_function_privilege('service_role',
       'public.payout_beneficiary_wise(uuid)', 'execute') then
    raise exception 'service_role no puede ejecutar payout_beneficiary_wise (regla de oro 9)';
  end if;
  if has_function_privilege('authenticated',
       'public.payout_beneficiary_wise(uuid)', 'execute') then
    raise exception 'payout_beneficiary_wise es ejecutable por authenticated (fuga de PII)';
  end if;
  if not has_function_privilege('service_role',
       'public.wise_puede_pagar_a(uuid)', 'execute') then
    raise exception 'service_role no puede ejecutar wise_puede_pagar_a (regla de oro 9)';
  end if;
end $$;
