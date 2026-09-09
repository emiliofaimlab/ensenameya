import assert from "node:assert/strict";

import {
  uuidDePago,
  referenciaSegura,
  cuentaDeWise,
  desenlaceDeTransfer,
  retoDeSca,
  type BeneficiarioWise,
} from "./wise-mapeo.ts";

/**
 * Comprobación del mapeo de Wise. Sin framework: `npm run check:wise`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque las cuatro reglas que vigila fallan en silencio, y las cuatro cuestan
 * dinero de verdad:
 *
 *   · si `uuidDePago` dejara de ser determinista, un reintento tras un timeout
 *     mandaría un identificador nuevo, Wise lo trataría como una transferencia
 *     distinta y el tutor cobraría DOS VECES. Es lo único que lo impide: este
 *     adaptador no tiene un candado de duplicado como el 400 de PayPal.
 *   · si `incoming_payment_waiting` acabara mapeando a 'pagado', se escribiría
 *     `paid` y saldría NTF-12 «se pagó tu liquidación» por una transferencia
 *     creada y sin fondear — que con la cuenta a cero es HOY el caso normal.
 *   · si `referenciaSegura` devolviera algo más largo de doce caracteres, cada
 *     pago a Argentina lo rechazaría Wise por el `maxLength` del corredor.
 *   · si `cuentaDeWise` rellenara un hueco con un valor plausible en vez de
 *     negarse, el dinero saldría hacia un destino mal descrito.
 */

// ── 1 · La idempotencia: mismo pago, mismo UUID; otro intento, otro UUID ────
const A = uuidDePago("3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90", 1);
assert.equal(A, uuidDePago("3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90", 1), "no es determinista");
assert.notEqual(A, uuidDePago("3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90", 2), "no distingue intentos");
assert.notEqual(A, uuidDePago("0d5f6a7b-8c90-4c7a-8e21-3f8a1c2e9b4d", 1), "no distingue payouts");

// 🔑 Y tiene que ser un UUID CANÓNICO, que es lo que Wise valida antes que nada:
// medido, `EY-<uuid>-1` y un hex de 32 sin guiones devuelven 422.
assert.match(A, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "no es un UUID");
assert.equal(A[14], "5", "no lleva el nibble de versión");
assert.ok("89ab".includes(A[19]), "no lleva la variante RFC 4122");

// ── 2 · La referencia cabe en el corredor más estrecho que hay ──────────────
// Argentina admite DOCE caracteres y el regex prohíbe el guion bajo y el punto.
const ref = referenciaSegura("3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90", 12);
assert.ok(ref.length <= 12, `la referencia mide ${ref.length}, y ARS admite 12`);
assert.match(ref, /^[a-zA-Z0-9- ]*$/, "la referencia lleva caracteres que el corredor rechaza");
assert.equal(referenciaSegura("3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90", 35).length <= 35, true);

// ── 3 · Los estados: solo uno es dinero fuera ───────────────────────────────
assert.equal(desenlaceDeTransfer("outgoing_payment_sent", "1", false).estado, "pagado");

// 🔑 EL CASO CARO, y hoy el más probable: la cuenta de Wise tiene cero saldo, así
// que toda transferencia nace y se queda aquí. Si esto fuese 'pagado', a cada
// tutor le llegaría el correo de que cobró por un dinero que no se ha movido.
assert.equal(desenlaceDeTransfer("incoming_payment_waiting", "1", false).estado, "enviado");
assert.equal(desenlaceDeTransfer("incoming_payment_initiated", "1", false).estado, "enviado");
assert.equal(desenlaceDeTransfer("processing", "1", false).estado, "enviado");
assert.equal(desenlaceDeTransfer("funds_converted", "1", false).estado, "enviado");

// Muertas: vuelven a la cola con un intento nuevo, no a 'failed'. 'rechazado'
// enterraría dinero que se debe.
assert.equal(desenlaceDeTransfer("cancelled", "1", false).estado, "difunto");
assert.equal(desenlaceDeTransfer("funds_refunded", "1", false).estado, "difunto");

// `bounced_back` NO es un desenlace: Wise dice que o se entrega con retraso o
// pasa a funds_refunded. Y un estado que no conocemos tampoco lo es.
assert.equal(desenlaceDeTransfer("bounced_back", "1", false).estado, "enviado");
assert.equal(desenlaceDeTransfer("un_estado_que_wise_invente", "1", false).estado, "enviado");

// ── 4 · El cuerpo del recipient, país a país ────────────────────────────────
const CO: BeneficiarioWise = {
  wise_account_type: "colombia",
  transfer_country: "CO",
  currency_to_pay: "COP",
  account_holder_name: "Ana Gómez",
  legal_type: "PRIVATE",
  wise_bank_code: "COLOCOBM",
  // Colombia identifica el banco con el código TRADUCIDO de nuestro catálogo, así
  // que no tiene segundo número. Los cinco tipos que sí lo tienen están abajo.
  bank_branch: null,
  bank_account: "00012345678",
  bank_account_type: "CHECKING",
  document_type: "CC",
  document: "901270245",
  phone: "+57 300 1234567",
  address: { country: "CO", city: "Bogotá", firstLine: "Calle 1 # 2-3", postCode: "110111" },
};

const co = cuentaDeWise(CO, 136151426);
assert.ok("cuenta" in co, "Colombia no se pudo construir con datos completos");
// ⚠️ La dirección va ANIDADA. Medido: en plano, Wise devuelve los cuatro errores
// de dirección igualmente. `address.country` es una ruta, no un nombre de campo.
assert.deepEqual(co.cuenta.details.address, CO.address, "la dirección no va anidada");
assert.equal(co.cuenta.details.bankCode, "COLOCOBM", "manda nuestro código y no el de Wise");
// ⚠️ Colombia llama CURRENT a nuestro CHECKING. Mandar CHECKING es un 422.
assert.equal(co.cuenta.details.accountType, "CURRENT", "no traduce CHECKING a CURRENT");

// Sin código de Wise no se construye: es el tutor de un banco que Wise no cubre,
// y prometerle este riel es dejarle sin cobrar en silencio.
assert.ok("motivo" in cuentaDeWise({ ...CO, wise_bank_code: null }, 1), "acepta banco sin mapear");
// Sin teléfono tampoco, que Colombia lo exige.
assert.ok("motivo" in cuentaDeWise({ ...CO, phone: null }, 1), "acepta Colombia sin teléfono");
// Y un documento que Wise no conoce NO se traduce a uno parecido.
assert.ok("motivo" in cuentaDeWise({ ...CO, document_type: "NIT" }, 1), "inventa un documento");
assert.ok(
  "motivo" in cuentaDeWise({ ...CO, address: { ...CO.address, postCode: "" } }, 1),
  "acepta una dirección incompleta",
);

// Argentina: ni banco ni tipo de cuenta — el CBU los lleva dentro.
const ar = cuentaDeWise(
  { ...CO, wise_account_type: "argentina", currency_to_pay: "ARS", wise_bank_code: null,
    bank_account: "0170099220000067797370", bank_account_type: "CBU", document_type: "CUIL" },
  1,
);
assert.ok("cuenta" in ar, "Argentina no se pudo construir sin código de banco");
assert.equal(ar.cuenta.details.taxId, "901270245", "Argentina no manda el CUIL como taxId");

// México: la CLABE sola.
const mx = cuentaDeWise({ ...CO, wise_account_type: "mexican", currency_to_pay: "MXN",
  wise_bank_code: null, bank_account: "032180000118359719", bank_account_type: null }, 1);
assert.ok("cuenta" in mx, "México no se pudo construir");
assert.equal(mx.cuenta.details.clabe, "032180000118359719");

// Chile: VISTA es CUENTA_VISTA allí, y solo allí.
const cl = cuentaDeWise({ ...CO, wise_account_type: "chile", currency_to_pay: "CLP",
  wise_bank_code: "012", bank_account_type: "VISTA", document_type: "RUT" }, 1);
assert.ok("cuenta" in cl, "Chile no se pudo construir");
assert.equal(cl.cuenta.details.accountType, "CUENTA_VISTA", "Chile no traduce VISTA");

// Uruguay: su vocabulario de documentos es más estrecho que el nuestro.
const uy = { ...CO, wise_account_type: "uruguay", currency_to_pay: "UYU",
  wise_bank_code: "113", document_type: "CI" };
const uyOk = cuentaDeWise(uy, 1);
assert.ok("cuenta" in uyOk, "Uruguay no se pudo construir con cédula");
assert.equal(uyOk.cuenta.details.idDocumentType, "NATIONAL_ID");
// Pasaporte y documento extranjero existen en nuestras reglas y NO en las suyas.
assert.ok("motivo" in cuentaDeWise({ ...uy, document_type: "PASS" }, 1), "acepta pasaporte en UY");

// Brasil está apagado a propósito y tiene que decirlo, no fingir un mapeo.
assert.ok("motivo" in cuentaDeWise({ ...CO, wise_account_type: "brazil" }, 1));
// Y un tipo que no existe tampoco se cuela.
assert.ok("motivo" in cuentaDeWise({ ...CO, wise_account_type: "narnia" }, 1));

// ── 4bis · Los siete corredores del 10-sep-2026 ─────────────────────────────
//
// Todos con un 200 de `POST /v1/accounts` detrás (`20260910150000`), y todos con
// la misma pregunta debajo: ¿el `details` lleva EXACTAMENTE los campos que Wise
// pide, con el valor que sale de la columna correcta? El fallo que se vigila no
// es que falte un campo —eso es un 422 y se ve— sino que el identificador del
// banco venga de `wise_bank_code` cuando tenía que venir de `bank_branch`: eso
// crea un destinatario válido y equivocado.

// Zona euro: la cuenta ES el IBAN y no hay nada más. Ni banco, ni tipo de cuenta,
// ni sucursal, ni documento.
const es = cuentaDeWise({ ...CO, wise_account_type: "iban", currency_to_pay: "EUR",
  wise_bank_code: null, bank_account: "ES9121000418450200051332", bank_account_type: null,
  document_type: "TAX", address: { country: "ES", city: "Madrid", firstLine: "Calle Mayor 1", postCode: "28013" } }, 1);
assert.ok("cuenta" in es, "la zona euro no se pudo construir con un IBAN");
assert.deepEqual(es.cuenta.details, {
  IBAN: "ES9121000418450200051332",
  address: { country: "ES", city: "Madrid", firstLine: "Calle Mayor 1", postCode: "28013" },
}, "el IBAN manda campos de más o de menos");
// Y NO lleva estado: mandarlo donde el corredor no lo pide es un campo desconocido.
assert.equal("state" in (es.cuenta.details.address as object), false, "cuela el estado en la zona euro");

// Los otros tres tipos cuyo details es un IBAN a secas. Se comprueban porque son
// `case` distintos: un olvido dejaría el tipo dentro de TIPOS y sin rama.
for (const tipo of ["emirates", "israeli_local", "turkish_earthport"]) {
  const r = cuentaDeWise({ ...CO, wise_account_type: tipo, wise_bank_code: null,
    bank_account: "AE070331234567890123456", bank_account_type: null }, 1);
  assert.ok("cuenta" in r, `${tipo} no se pudo construir`);
  assert.equal(r.cuenta.details.IBAN, "AE070331234567890123456", `${tipo} no manda el IBAN`);
  assert.equal(r.cuenta.type, tipo, `${tipo} no viaja como type`);
}

// Reino Unido: el sort code sale de `bank_branch`, no del catálogo.
const gb = cuentaDeWise({ ...CO, wise_account_type: "sort_code", currency_to_pay: "GBP",
  wise_bank_code: null, bank_branch: "231470", bank_account: "28821822",
  bank_account_type: null }, 1);
assert.ok("cuenta" in gb, "Reino Unido no se pudo construir");
assert.equal(gb.cuenta.details.sortCode, "231470", "el sort code no sale de bank_branch");
assert.equal(gb.cuenta.details.accountNumber, "28821822");

// Estados Unidos: número de ruta de `bank_branch`, tipo de cuenta y ESTADO.
const usBase: BeneficiarioWise = { ...CO, wise_account_type: "aba", currency_to_pay: "USD",
  wise_bank_code: null, bank_branch: "021000021", bank_account: "12345678",
  bank_account_type: "CHECKING", document_type: "TAX",
  address: { country: "US", city: "Miami", firstLine: "1 Brickell Ave", postCode: "33131", state: "FL" } };
const us = cuentaDeWise(usBase, 1);
assert.ok("cuenta" in us, "Estados Unidos no se pudo construir");
// 🔑 EL FALLO QUE ESTA LÍNEA EXISTE PARA CAZAR: `abartn` venía de
// `wise_bank_code`, que en Estados Unidos es null. Con eso el `details` salía con
// `abartn: null` y el 422 llegaba desde Wise, no desde aquí.
assert.equal(us.cuenta.details.abartn, "021000021", "el número de ruta no sale de bank_branch");
assert.equal(us.cuenta.details.accountType, "CHECKING");
assert.equal((us.cuenta.details.address as { state?: string }).state, "FL", "no manda el estado");
// Sin estado no se construye: es el 422 medido «Please enter a state.»
assert.ok("motivo" in cuentaDeWise({ ...usBase,
  address: { ...usBase.address, state: null } }, 1), "acepta EE. UU. sin estado");
// Sin número de ruta tampoco.
assert.ok("motivo" in cuentaDeWise({ ...usBase, bank_branch: null }, 1),
  "acepta EE. UU. sin número de ruta");
// Y sin tipo de cuenta tampoco, que la ACH lo exige.
assert.ok("motivo" in cuentaDeWise({ ...usBase, bank_account_type: null }, 1),
  "acepta EE. UU. sin tipo de cuenta");

// Australia: BSB en `bank_branch` y estado, igual que Estados Unidos.
const auBase: BeneficiarioWise = { ...CO, wise_account_type: "australian", currency_to_pay: "AUD",
  wise_bank_code: null, bank_branch: "802985", bank_account: "123456789",
  bank_account_type: null, document_type: "TAX",
  address: { country: "AU", city: "Sydney", firstLine: "George St 1", postCode: "2000", state: "NSW" } };
const au = cuentaDeWise(auBase, 1);
assert.ok("cuenta" in au, "Australia no se pudo construir");
assert.equal(au.cuenta.details.bsbCode, "802985", "el BSB no sale de bank_branch");
assert.ok("motivo" in cuentaDeWise({ ...auBase, address: { ...auBase.address, state: null } }, 1),
  "acepta Australia sin estado");

// India: IFSC en `bank_branch`, y NO pide estado.
const inr = cuentaDeWise({ ...CO, wise_account_type: "indian", currency_to_pay: "INR",
  wise_bank_code: null, bank_branch: "HDFC0000001", bank_account: "50100123456789",
  bank_account_type: null, document_type: "TAX",
  address: { country: "IN", city: "Mumbai", firstLine: "MG Road 1", postCode: "400001" } }, 1);
assert.ok("cuenta" in inr, "India no se pudo construir");
assert.equal(inr.cuenta.details.ifscCode, "HDFC0000001", "el IFSC no sale de bank_branch");
assert.equal("state" in (inr.cuenta.details.address as object), false, "cuela el estado en India");

// Panamá y compañía: el BIC lo teclea el tutor y va en `bank_branch`.
const paBase: BeneficiarioWise = { ...CO, wise_account_type: "swift_code", currency_to_pay: "USD",
  wise_bank_code: null, bank_branch: "BAGEPAPA", bank_account: "0412345678",
  bank_account_type: null, document_type: "TAX",
  address: { country: "PA", city: "Panamá", firstLine: "Calle 50 12", postCode: "0801" } };
const pa = cuentaDeWise(paBase, 1);
assert.ok("cuenta" in pa, "Panamá no se pudo construir");
assert.equal(pa.cuenta.details.swiftCode, "BAGEPAPA", "el BIC no sale de bank_branch");
assert.equal(pa.cuenta.details.accountNumber, "0412345678");
assert.ok("motivo" in cuentaDeWise({ ...paBase, bank_branch: null }, 1),
  "acepta un pago por SWIFT sin BIC");

// Costa Rica: IBAN MÁS documento, y su vocabulario es más estrecho que el nuestro.
const crBase: BeneficiarioWise = { ...CO, wise_account_type: "costa_rica", currency_to_pay: "CRC",
  wise_bank_code: null, bank_branch: null, bank_account: "CR23015108410026012345",
  bank_account_type: null, document_type: "CI", document: "123456789",
  address: { country: "CR", city: "San José", firstLine: "Avenida 2 15", postCode: "10101" } };
const cr = cuentaDeWise(crBase, 1);
assert.ok("cuenta" in cr, "Costa Rica no se pudo construir con cédula");
assert.equal(cr.cuenta.details.IBAN, "CR23015108410026012345");
assert.equal(cr.cuenta.details.idDocumentType, "NATIONAL_ID_CARD", "no traduce la cédula");
assert.equal(cr.cuenta.details.idDocumentNumber, "123456789");
const crDimex = cuentaDeWise({ ...crBase, document_type: "DIMEX" }, 1);
assert.ok("cuenta" in crDimex, "Costa Rica no se pudo construir con DIMEX");
assert.equal(crDimex.cuenta.details.idDocumentType, "FOREIGN_ID", "no traduce el DIMEX");
// Un tipo que Wise no conoce en Costa Rica NO se traduce a uno parecido.
assert.ok("motivo" in cuentaDeWise({ ...crBase, document_type: "PASS" }, 1),
  "inventa un documento en Costa Rica");

// ── 5 · SCA: un 403 pelado NO es un reto ────────────────────────────────────
assert.equal(retoDeSca(403, new Headers()), null, "confunde un 403 de permisos con SCA");
assert.equal(retoDeSca(422, new Headers({ "x-2fa-approval": "ott" })), null, "reta fuera de un 403");
assert.equal(retoDeSca(403, new Headers({ "x-2fa-approval": "ott" })), "ott", "no ve el reto real");

console.log(
  "✓ wise-mapeo: idempotencia, referencia, estados, 15 corredores y SCA",
);
