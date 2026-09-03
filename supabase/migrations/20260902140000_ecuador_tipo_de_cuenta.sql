-- ============================================================================
-- Enséñame Ya — C2 · Ecuador tiene tipo de cuenta, y por eso no podía cobrar.
--
-- Ecuador es el ÚNICO de los ocho países de dLocal Go cuya moneda es el dólar,
-- o sea el único donde `currency_to_pay` coincide con `payouts.currency` y no
-- hay nada que convertir. Era el país que debería haber cobrado primero. No
-- podía cobrar en absoluto, y no por el tipo de cambio: por un choque entre lo
-- que dice esta base de datos y lo que exige la API.
--
--   · `payout_country_rules` para EC lleva `account_types = '{}'` desde B1
--     (`20260901160000`), porque la documentación de dLocal para Ecuador **no
--     tiene sección de tipos de cuenta**. La fila se sembró con lo que la doc
--     documentaba: nada.
--   · `payout_account_check` lee esa lista vacía como «este país no desglosa
--     tipo de cuenta» y RECHAZA cualquier `bank_account_type` que le manden
--     («En EC no se indica tipo de cuenta»). Así que el tutor ecuatoriano no
--     puede guardar uno ni aunque quiera.
--   · Y `POST /v1/payouts` lo exige igual: sin `bank_account_type` devuelve
--     `400 {"code":5000,"message":"must not be null"}`, un mensaje que ni
--     siquiera dice qué campo falta.
--
-- Resultado: la lista vacía impedía guardar el dato que la API exige tener. Un
-- callejón sin salida silencioso — el tutor rellena su formulario, lo guarda sin
-- error, y su payout muere en un 400 que nadie sabe leer.
--
-- ── DE DÓNDE SALEN LOS VALORES: DE LA API, NO DE LA DOCUMENTACIÓN ───────────
--
-- La doc de Ecuador no los publica, así que se sondearon uno a uno contra el
-- sandbox (`api-sbx.dlocalgo.com`, 2-sep-2026) mandando los ocho literales del
-- enum global. La propia API canta la lista cuando no reconoce un valor:
--
--   Field beneficiary.bank_account.type has unsupported value VISTA
--   … not one of the values accepted for Enum class:
--     [ALIAS, MAESTRA, MASTER, CBU, SAVINGS, SALARY, VISTA, CHECKING]
--
-- Y de esos ocho, Ecuador acepta DOS. Medido: `CHECKING` y `SAVINGS` crean el
-- payout (`19286046113551` y `53528646984394`, los dos `PENDING`); `VISTA`,
-- `MAESTRA`, `MASTER`, `SALARY`, `ALIAS` y `CBU` devuelven «unsupported value».
--
-- ⚠️ La comprobación del tipo corre ANTES que la del documento, y eso es lo que
-- hizo el sondeo barato: con un documento inválido a propósito, un tipo bueno
-- devuelve el error del documento y un tipo malo devuelve el del tipo. Ninguno
-- de los dos crea nada. Queda anotado porque sirve para sondear los demás
-- países sin gastar saldo.
--
-- ── LO QUE ESTA MIGRACIÓN **NO** ARREGLA, Y HAY QUE DECIRLO ─────────────────
--
-- El mismo sondeo dejó tres cosas más medidas, y ninguna cabe en un fichero que
-- se llama «ecuador_tipo_de_cuenta»:
--
--   · MX, PE y PY tienen la MISMA fila vacía (`account_types = '{}'`) y el mismo
--     callejón. Los tres aceptan exactamente `CHECKING` y `SAVINGS`.
--   · UY ofrece solo `CHECKING` porque era el único valor del ejemplo oficial.
--     `SAVINGS` también vale — la propia nota de B1 decía que era lo primero que
--     había que probar en el sandbox. Ya está probado.
--   · PERÚ NO PUEDE COBRAR AUNQUE SE LE ARREGLE EL TIPO DE CUENTA: exige
--     `beneficiary_address_street` y `_city` (`400 Missing required field:
--     beneficiary.address.street`), y `tutor_payout_accounts` no guarda
--     dirección. Eso sí es esquema, y es una migración aparte.
--
-- Los tres primeros son un `update` de datos de tres líneas. Se dejan escritos
-- aquí, sin ejecutar, para que quien los aplique no tenga que volver a sondear:
--
--   update public.payout_country_rules
--      set account_types = array['CHECKING', 'SAVINGS']
--    where country in ('MX', 'PE', 'PY', 'UY');
--
-- ── EL EFECTO SECUNDARIO, QUE ES DELIBERADO ────────────────────────────────
--
-- Un tutor ecuatoriano que YA hubiera guardado sus datos los tiene con
-- `bank_account_type` a null, porque hasta hoy era lo único que se le permitía.
-- A partir de esta migración `payout_account_check` le pedirá el tipo, así que
-- esa fila deja de validar y `payout_beneficiary` levantará «los datos de cobro
-- del tutor ya no son válidos». Eso es lo correcto y por eso B1 revalida al
-- ejecutar y no solo al guardar: esos datos NUNCA habrían cobrado. El tutor ve
-- el desplegable nuevo en su formulario y elige. No se rellena por él —
-- adivinar entre corriente y ahorros es adivinar a qué cuenta va su dinero.
-- ============================================================================

update public.payout_country_rules
   set account_types = array['CHECKING', 'SAVINGS'],
       account_label = 'Número de cuenta',
       account_help  = 'El número de tu cuenta en el banco, sin puntos ni guiones. Elige arriba si es corriente (CHECKING) o de ahorros (SAVINGS).',
       notas = 'Único país de los ocho cuya moneda es USD, o sea el único donde currency_to_pay coincide con payouts.currency y no hace falta conversión. ⚠️ CONTRADICCIÓN OFICIAL: Country reference dice "CI entre 5 y 20 dígitos" y Document validations dice "CI 10 numérico con dígito verificador". Se toma la permisiva (5-20). ⚠️ account_types SE LLENÓ EL 2026-09-02 (migración 20260902140000): la doc de EC no publica tipos de cuenta y la fila nació vacía, pero POST /v1/payouts los EXIGE — sin bank_account_type devuelve 400 code 5000 "must not be null". Sondeados los ocho literales del enum contra el sandbox, EC acepta CHECKING y SAVINGS y rechaza ALIAS, CBU, MAESTRA, MASTER, SALARY y VISTA con "unsupported value". NO viene de la documentación: viene de la API. SIN DOCUMENTAR sigue el formato de bank_account. ⚠️ Y bank_branch: requires_branch es false porque el tutor no tiene que teclearlo, pero la API lo exige presente — lo manda vacío el adaptador, no la BD. La lista de 213 códigos dice "This list includes the MAIN banks", así que puede estar incompleta: si un tutor no encuentra su cooperativa, se añade la fila.'
 where country = 'EC';


-- ════════════════════════════════════════════════════════════════════════════
-- Autocomprobación — que la fila haga lo que dice que hace
-- ════════════════════════════════════════════════════════════════════════════
--
-- Mismo criterio que el bloque final de B1 y por el mismo motivo (regla de oro
-- 10 y la lección de `close_expired_sessions()`): escribir un `update` valida la
-- sintaxis, no el efecto. Aquí se llama a la función que de verdad va a decidir
-- si un tutor ecuatoriano puede cobrar, y si no contesta lo esperado la
-- migración NO aplica.
--
-- `payout_account_check` es `stable` y solo lee: esto no escribe nada.
--
-- El documento es un CI de 10 dígitos con verificador válido (1712345675) y el
-- banco es el 037, Banco Bolivariano, que B1 sembró y que es el que se usó en el
-- sondeo real contra el sandbox.
--
-- ⚠️ Y LA SUCURSAL VA EN LOS SEIS CASOS, AUNQUE ESTA MIGRACIÓN NO TRATE DE ELLA.
-- La primera versión de este bloque la pasaba a `null` y **la migración abortó**:
-- `20260901200000` puso `requires_branch = true` en los OCHO países —medido, sin
-- ella los ocho devuelven `5000 must not be null`—, así que un beneficiario sin
-- sucursal no valida en ninguna parte y el caso 2 fallaba por un motivo que no
-- es el que se está midiendo. Poner '001' no relaja nada: `branch_pattern` es
-- null en EC y en CL, o sea que cualquier valor no vacío pasa, y lo que hace es
-- AISLAR la variable — a partir de aquí, si el caso 4 falla es por el tipo de
-- cuenta y por nada más.
--
-- ponytail: el valor es fijo y no sale de la fila de reglas. Es una prueba, no
-- un formulario: leer `branch_pattern` para fabricar una sucursal válida sería
-- reimplementar aquí la función que se está probando.
do $$
declare
  v text;
begin
  -- 1) Se actualizó UNA fila y sigue siendo EC. Si el país no estuviera, el
  --    update no habría fallado: habría afectado a cero filas en silencio.
  if not exists (
    select 1 from public.payout_country_rules
     where country = 'EC' and account_types = array['CHECKING', 'SAVINGS']
  ) then
    raise exception 'C2/EC: la fila de payout_country_rules no quedó con CHECKING+SAVINGS';
  end if;

  -- 2) El caso bueno: corriente. Es lo que crea el payout `19286046113551`.
  v := public.payout_account_check('EC', 'CI', '1712345675', '037', 'CHECKING',
                                   '1234567890', '001');
  if v is not null then
    raise exception 'C2/EC: CHECKING debería validar y devolvió: %', v;
  end if;

  -- 3) Y ahorros, que es el otro que la API acepta.
  v := public.payout_account_check('EC', 'CI', '1712345675', '037', 'SAVINGS',
                                   '1234567890', '001');
  if v is not null then
    raise exception 'C2/EC: SAVINGS debería validar y devolvió: %', v;
  end if;

  -- 4) 🔴 EL CASO QUE ERA EL BUG: sin tipo de cuenta ya NO se puede guardar.
  --    Antes de esta migración esto devolvía null —validaba— y el payout moría
  --    después en un 400 que no decía qué faltaba. Ahora se para en el
  --    formulario del tutor, que es donde tiene arreglo.
  v := public.payout_account_check('EC', 'CI', '1712345675', '037', null,
                                   '1234567890', '001');
  if v is null then
    raise exception 'C2/EC: sin bank_account_type NO debería validar — es el 400 de dLocal';
  end if;

  -- 5) Y un tipo que dLocal rechaza tampoco pasa de aquí. VISTA es válido en
  --    Chile y no en Ecuador: el enum es global, la lista por país no.
  v := public.payout_account_check('EC', 'CI', '1712345675', '037', 'VISTA',
                                   '1234567890', '001');
  if v is null then
    raise exception 'C2/EC: VISTA no lo acepta dLocal en Ecuador y aquí sí validó';
  end if;

  -- 6) Chile NO se ha tocado: sigue admitiendo VISTA. Es el control de que el
  --    update no se ha llevado por delante otra fila.
  v := public.payout_account_check('CL', 'RUT', '12345678K', '1', 'VISTA',
                                   '1234567890', '001');
  if v is not null then
    raise exception 'C2/EC: se tocó Chile sin querer — VISTA en CL devolvió: %', v;
  end if;

  raise notice 'C2/EC: tipo de cuenta CHECKING/SAVINGS exigido y validado, 6 casos.';
end $$;
