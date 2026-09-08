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

// ── 5 · SCA: un 403 pelado NO es un reto ────────────────────────────────────
assert.equal(retoDeSca(403, new Headers()), null, "confunde un 403 de permisos con SCA");
assert.equal(retoDeSca(422, new Headers({ "x-2fa-approval": "ott" })), null, "reta fuera de un 403");
assert.equal(retoDeSca(403, new Headers({ "x-2fa-approval": "ott" })), "ott", "no ve el reto real");

console.log("✓ wise-mapeo: idempotencia, referencia, estados, 8 corredores y SCA");
