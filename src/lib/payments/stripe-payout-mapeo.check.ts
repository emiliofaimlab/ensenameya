import assert from "node:assert/strict";

import type Stripe from "stripe";

import {
  MARGEN_DE_RELOJ_SEGUNDOS,
  claveDeCuenta,
  cuerpoDeTransferencia,
  desenlaceDeTransferencia,
  estadoDeLaCuenta,
  fechaDeAceptacion,
  parametrosDeCuenta,
  parametrosDeCuentaBancaria,
  parametrosDelTitular,
  veredictoDeFallo,
  yaTieneEstaCuenta,
  type BeneficiarioStripe,
} from "./stripe-payout-mapeo.ts";

/**
 * Comprobación del mapeo de payout de Stripe. Sin framework:
 * `npm run check:stripe-payout`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque las cinco reglas que vigila fallan EN SILENCIO y las cinco cuestan
 * dinero de verdad:
 *
 *   · si la marca dejara de ser la misma cadena en la clave de idempotencia y en
 *     `transfer_group`, el barrido no encontraría lo que la creación creó y el
 *     tutor cobraría DOS VECES. Es lo único que lo impide.
 *   · si `estadoDeLaCuenta` diera por lista una cuenta con `transfers: active` y
 *     `payouts_enabled: false`, la transferencia saldría, el job escribiría
 *     `paid`, saldría NTF-12 «Se pagó tu liquidación»… y el dinero se quedaría
 *     atrapado en un saldo de Stripe del que el tutor no puede sacarlo.
 *   · si `yaTieneEstaCuenta` devolviera `false` sobre la cuenta que ya está
 *     adjunta, cada pasada adjuntaría otra copia del mismo IBAN.
 *   · si `veredictoDeFallo` clasificara como `rechazado` un dato incompleto del
 *     tutor, su liquidación acabaría en 'failed' con NTF-16 en vez de esperando a
 *     que rellene el formulario.
 *   · si `fechaDeAceptacion` mandara milisegundos, Stripe rechazaría la cuenta
 *     entera con un 400 que no dice qué le pedimos al tutor.
 */

const AHORA = 1_757_500_000; // un instante fijo, para que nada dependa del reloj

const ES: BeneficiarioStripe = {
  country: "ES",
  currency: "eur",
  first_name: "Ana",
  last_name: "Gómez",
  dob: { day: 14, month: 3, year: 1990 },
  id_number: null,
  address: {
    country: "ES",
    line1: "Calle Mayor 1",
    city: "Madrid",
    state: "Madrid",
    postal_code: "28013",
  },
  // España no usa tipo de cuenta: null, como lo devuelve la RPC allí.
  account_type: null,
  account_number: "ES9121000418450200051332",
  routing_number: null,
  account_holder_name: "Ana Gómez",
  tos_date: AHORA - 600,
  tos_ip: "203.0.113.5",
};

// ── 1 · La cuenta de destinatario: los cinco campos que esconden a Stripe ────
const cuenta = parametrosDeCuenta(ES, "3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90");
assert.equal(cuenta.country, "ES", "el país no viaja en mayúsculas");
// 🔑 Sin estos cuatro, el tutor tendría que darse de alta EN Stripe y ver su
// marca, que es exactamente lo que el dictado del 9-sep eliminó.
assert.equal(cuenta.controller?.requirement_collection, "application", "los requisitos los pediría Stripe");
assert.equal(cuenta.controller?.stripe_dashboard?.type, "none", "el tutor tendría panel de Stripe");
assert.equal(cuenta.controller?.losses?.payments, "application");
assert.equal(cuenta.controller?.fees?.payer, "application");
// El acuerdo `recipient` es lo que hace que baste con `transfers` y no haga falta
// el KYC de un comercio.
assert.equal(cuenta.tos_acceptance?.service_agreement, "recipient", "no pide el acuerdo de destinatario");
assert.equal(cuenta.capabilities?.transfers?.requested, true, "no pide la capability de transferencias");
// `metadata` es `"" | MetadataParam` en el SDK, de ahí el cast.
assert.equal(
  (cuenta.metadata as Record<string, unknown>).tutor_id,
  "3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90",
);
// ⚠️ SIN correo: la RPC no lo devuelve y medido el 10-sep no hace falta. Si esto
// deja de ser cierto, la cuenta se queda sin crear y no es un fallo silencioso.
assert.equal("email" in cuenta, false, "manda un correo que la RPC no devuelve");
// Y nada de `type: 'express'`: eso era el alta vieja, con su onboarding alojado.
assert.equal("type" in cuenta, false, "vuelve a pedir una cuenta de tipo express");

// La clave de la creación es por TUTOR y determinista: dos payouts del mismo
// tutor no pueden crear dos cuentas.
assert.equal(claveDeCuenta("tutor-1"), claveDeCuenta("tutor-1"), "no es determinista");
assert.notEqual(claveDeCuenta("tutor-1"), claveDeCuenta("tutor-2"), "no distingue tutores");

// ── 2 · La aceptación de condiciones ────────────────────────────────────────
const ok = fechaDeAceptacion(AHORA - 600, AHORA);
assert.ok("fecha" in ok && ok.fecha === AHORA - 600, "no deja pasar una fecha válida");

// 🔑 EL CASO MEDIDO: milisegundos. Stripe responde 400 «Dates are expected to be
// integers, measured in seconds, not in the future, and after 2009», y con ese
// error la cuenta entera se queda sin activar.
assert.ok("motivo" in fechaDeAceptacion(AHORA * 1000, AHORA), "traga milisegundos");
// El futuro de verdad tampoco.
assert.ok("motivo" in fechaDeAceptacion(AHORA + 86_400, AHORA), "acepta el futuro");
// Un desfase de relojes de dos segundos NO tumba un pago: se recorta al instante
// actual, porque es un reloj mal puesto y no un dato falso.
const roce = fechaDeAceptacion(AHORA + 2, AHORA);
assert.ok("fecha" in roce && roce.fecha === AHORA, "un desfase de dos segundos tumba el pago");
// Y el borde del margen se respeta en los dos sentidos.
assert.ok("fecha" in fechaDeAceptacion(AHORA + MARGEN_DE_RELOJ_SEGUNDOS, AHORA));
assert.ok("motivo" in fechaDeAceptacion(AHORA + MARGEN_DE_RELOJ_SEGUNDOS + 1, AHORA));
// Sin aceptación no se construye nada: es uno de los dos datos que Stripe no
// perdona (el otro es la fecha de nacimiento).
assert.ok("motivo" in fechaDeAceptacion(null, AHORA), "acepta una cuenta sin condiciones firmadas");
assert.ok("motivo" in fechaDeAceptacion(0, AHORA), "acepta una fecha imposible");

// ── 3 · Los datos del titular ───────────────────────────────────────────────
const titular = parametrosDelTitular(ES, AHORA);
assert.ok("params" in titular, "España no se pudo construir con datos completos");
assert.equal(titular.params.business_type, "individual");
const ind = titular.params.individual!;
assert.deepEqual(ind.dob, { day: 14, month: 3, year: 1990 }, "la fecha de nacimiento no viaja");
assert.deepEqual(
  ind.address,
  { country: "ES", line1: "Calle Mayor 1", city: "Madrid", state: "Madrid", postal_code: "28013" },
  "la dirección no viaja entera",
);
assert.equal(titular.params.tos_acceptance?.date, AHORA - 600);
assert.equal(titular.params.tos_acceptance?.ip, "203.0.113.5");
// España no pide documento y no se manda uno vacío: `id_number: null` no es lo
// mismo que no mandarlo.
assert.equal("id_number" in ind, false, "manda un documento que no existe");

// 🔑 COLOMBIA Y CHILE PIDEN `individual.id_number` (medido: sin él,
// `transfers: inactive` y `currently_due: ['individual.id_number']`). No hay
// mapa por país: se manda cuando lo hay, y ya está.
const conDocumento = parametrosDelTitular({ ...ES, country: "CO", id_number: "901270245" }, AHORA);
assert.ok("params" in conDocumento);
assert.equal(conDocumento.params.individual?.id_number, "901270245", "no manda el documento");

// 🔑 PANAMÁ PIDE `address.line1` Y `.city` Y NADA MÁS, y este mapeo NO exige la
// dirección completa: manda lo que hay y deja que Stripe diga qué falta. Exigirla
// aquí dejaría sin cobrar a los países que no la piden.
const parcial = parametrosDelTitular(
  { ...ES, country: "PA", address: { country: "PA", line1: "Calle 50 12", city: "Panamá", state: null, postal_code: null } },
  AHORA,
);
assert.ok("params" in parcial, "no construye una dirección parcial");
assert.deepEqual(parcial.params.individual?.address, { country: "PA", line1: "Calle 50 12", city: "Panamá" });

// Sin dirección ninguna tampoco se bloquea: es Stripe quien decide si hace falta.
const sinDireccion = parametrosDelTitular({ ...ES, address: null }, AHORA);
assert.ok("params" in sinDireccion, "exige una dirección que Stripe no siempre pide");
assert.equal("address" in (sinDireccion.params.individual ?? {}), false, "manda una dirección vacía");

// Lo que SÍ se exige, porque Stripe lo pide en todas partes y su ausencia deja la
// cuenta en `past_due` con un mensaje que no señala al formulario:
assert.ok("motivo" in parametrosDelTitular({ ...ES, dob: null }, AHORA), "acepta un titular sin fecha de nacimiento");
assert.ok("motivo" in parametrosDelTitular({ ...ES, last_name: null }, AHORA), "acepta un titular sin apellidos");
assert.ok("motivo" in parametrosDelTitular({ ...ES, tos_ip: null }, AHORA), "acepta una aceptación sin IP");
assert.ok(
  "motivo" in parametrosDelTitular({ ...ES, dob: { day: 0, month: 3, year: 1990 } }, AHORA),
  "acepta un día de nacimiento imposible",
);

// ── 4 · La cuenta bancaria ──────────────────────────────────────────────────
const banco = parametrosDeCuentaBancaria(ES);
assert.ok("params" in banco, "el IBAN no se pudo montar");
const ea = banco.params.external_account as unknown as Record<string, unknown>;
assert.equal(ea.object, "bank_account");
assert.equal(ea.account_number, "ES9121000418450200051332");
assert.equal(ea.currency, "eur", "la moneda no va en minúsculas");
assert.equal(ea.country, "ES");
assert.equal(ea.account_holder_name, "Ana Gómez");
// ⚠️ `default_for_currency` va FUERA del `external_account`, donde lo pone la API.
// Dentro también cuela hoy, pero el sitio documentado es este, y es lo que hace
// que un tutor que cambia de banco cobre en el nuevo.
assert.equal(banco.params.default_for_currency, true, "la cuenta nueva no sería la predeterminada");
// Un IBAN no lleva segundo número: mandar `routing_number: null` es un 400.
assert.equal("routing_number" in ea, false, "manda un routing_number vacío");

// 🔑 SEIS DE LOS CATORCE PAÍSES MEDIDOS LO EXIGEN CON UN `parameter_missing`
// (EC, PA, GT, DO, BO, PY): cuando el tutor lo ha tecleado, viaja.
const conRuta = parametrosDeCuentaBancaria({ ...ES, country: "PA", currency: "USD", routing_number: "  0007  " });
assert.ok("params" in conRuta);
const eaPa = conRuta.params.external_account as unknown as Record<string, unknown>;
assert.equal(eaPa.routing_number, "0007", "no manda el código de banco (o no lo recorta)");
assert.equal(eaPa.currency, "usd", "no normaliza la moneda a minúsculas");

assert.ok("motivo" in parametrosDeCuentaBancaria({ ...ES, account_number: null }), "acepta una cuenta sin número");
assert.ok("motivo" in parametrosDeCuentaBancaria({ ...ES, account_holder_name: "  " }), "acepta una cuenta sin titular");
assert.ok("motivo" in parametrosDeCuentaBancaria({ ...ES, currency: "" }), "acepta una cuenta sin moneda");

// ── 5 · ¿Ya está adjunta esa cuenta? ────────────────────────────────────────
function cuentaConExternas(externas: unknown[]): Stripe.Account {
  return { external_accounts: { data: externas } } as unknown as Stripe.Account;
}

// Medido: el IBAN `ES91…51332` vuelve de Stripe como `last4: '1332'`.
const adjunta = cuentaConExternas([{ object: "bank_account", last4: "1332", currency: "eur" }]);
assert.equal(yaTieneEstaCuenta(adjunta, ES), true, "no reconoce la cuenta que ya está adjunta");
// 🔑 EL FALLO QUE ESTA LÍNEA CAZA: si esto fuese `false`, cada pasada adjuntaría
// otra copia del mismo IBAN a la misma cuenta conectada.
assert.equal(yaTieneEstaCuenta(cuentaConExternas([]), ES), false, "cree que hay cuenta donde no hay ninguna");
// Otro banco del mismo tutor: hay que adjuntar el nuevo, no dar por bueno el viejo.
assert.equal(
  yaTieneEstaCuenta(cuentaConExternas([{ object: "bank_account", last4: "9999", currency: "eur" }]), ES),
  false,
  "confunde dos cuentas distintas",
);
// Misma cola, OTRA moneda: es otro destino.
assert.equal(
  yaTieneEstaCuenta(cuentaConExternas([{ object: "bank_account", last4: "1332", currency: "usd" }]), ES),
  false,
  "confunde dos monedas",
);
// Una tarjeta no es una cuenta bancaria.
assert.equal(
  yaTieneEstaCuenta(cuentaConExternas([{ object: "card", last4: "1332", currency: "eur" }]), ES),
  false,
  "cuenta una tarjeta como cuenta bancaria",
);

// ── 6 · ¿Está lista para recibir? ───────────────────────────────────────────
function cuentaConEstado(caps: unknown, payouts: boolean, due: string[]): Stripe.Account {
  return {
    capabilities: caps,
    payouts_enabled: payouts,
    requirements: { currently_due: due },
  } as unknown as Stripe.Account;
}

assert.equal(estadoDeLaCuenta(cuentaConEstado({ transfers: "active" }, true, [])).lista, true);

// 🔴 EL CASO CARO Y MEDIDO: una cuenta con los datos del titular pero SIN cuenta
// bancaria adjunta llega a `transfers: active` con `payouts_enabled: false`. La
// transferencia funcionaría, el job escribiría 'paid' y saldría NTF-12 «Se pagó
// tu liquidación» — con el dinero atrapado en un saldo del que el tutor no puede
// sacarlo. Si esta línea cae, ese fallo vuelve y nadie lo reporta.
const trampa = estadoDeLaCuenta(cuentaConEstado({ transfers: "active" }, false, ["external_account"]));
assert.equal(trampa.lista, false, "da por lista una cuenta que no puede sacar el dinero al banco");
assert.ok(!trampa.lista && trampa.falta.includes("external_account"));
assert.ok(!trampa.lista && trampa.enRevision === false, "confunde «falta un dato» con «Stripe revisa»");

// Sin la capability tampoco, aunque `payouts_enabled` diga que sí.
assert.equal(estadoDeLaCuenta(cuentaConEstado({ transfers: "inactive" }, true, ["individual.id_number"])).lista, false);
assert.equal(estadoDeLaCuenta(cuentaConEstado({}, true, [])).lista, false, "no ve que falta la capability");

// Nada pendiente y aun así no lista = Stripe está revisando. Es `transitorio`
// para quien llama, no un dato que le falte al tutor.
const revisando = estadoDeLaCuenta(cuentaConEstado({ transfers: "pending" }, false, []));
assert.ok(!revisando.lista && revisando.enRevision === true, "no distingue la revisión de Stripe");

// ── 7 · La transferencia: LA MARCA ES LA MISMA CADENA EN LOS TRES SITIOS ────
const cuerpo = cuerpoDeTransferencia({
  marca: "EY-3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90-1",
  amountMinor: 4750,
  currency: "USD",
  destino: "acct_1234",
});
// 🔴 ESTAS TRES LÍNEAS SON LO QUE IMPIDE PAGAR DOS VECES. La clave de
// idempotencia hace que repetir la llamada devuelva la MISMA transferencia
// (medido); el `transfer_group` es lo que la encuentra cuando esa clave ya
// caducó (24 h). Si dejaran de coincidir, el barrido no vería lo que la creación
// creó y la orden se mandaría otra vez.
assert.equal(cuerpo.idempotencyKey, "EY-3f8a1c2e-9b4d-4c7a-8e21-0d5f6a7b8c90-1");
assert.equal(cuerpo.params.transfer_group, cuerpo.idempotencyKey, "la marca no es la misma en los dos sitios");
assert.equal(cuerpo.params.metadata.marca, cuerpo.idempotencyKey, "el panel de Stripe no vería la marca");
assert.equal(cuerpo.params.amount, 4750, "el importe no es el de la orden");
assert.equal(cuerpo.params.currency, "usd", "la moneda no va en minúsculas");
assert.equal(cuerpo.params.destination, "acct_1234");

// ── 8 · Los desenlaces ──────────────────────────────────────────────────────
function transferencia(extra: Record<string, unknown>) {
  return { id: "tr_1", amount: 4750, reversed: false, amount_reversed: 0, ...extra } as unknown as Stripe.Transfer;
}

// Una transferencia creada ES 'pagado': el dinero salió de nuestro saldo. Mismo
// criterio que el `SUCCESS` de PayPal.
const pagado = desenlaceDeTransferencia(transferencia({}), false);
assert.equal(pagado.estado, "pagado");
assert.equal(pagado.estado === "pagado" && pagado.payoutId, "tr_1");
assert.equal(pagado.estado === "pagado" && pagado.adoptado, false);
assert.equal(desenlaceDeTransferencia(transferencia({}), true).estado === "pagado", true);

// Revertida entera: no pagó y no va a pagar. `difunto` y NO `rechazado`, para que
// `manage_payout('retry')` pueda reintentar con un intento nuevo en vez de
// enterrar la liquidación en 'failed' con NTF-16.
const muerta = desenlaceDeTransferencia(transferencia({ reversed: true, amount_reversed: 4750 }), false);
assert.equal(muerta.estado, "difunto", "una transferencia revertida se daría por pagada");

// Revertida a medias: el dinero salió, así que sigue siendo 'pagado' — pero el
// detalle lo dice, porque acaba escrito en el rastro de la orden.
const aMedias = desenlaceDeTransferencia(transferencia({ amount_reversed: 1000 }), false);
assert.equal(aMedias.estado, "pagado");
assert.match(aMedias.estado === "pagado" ? aMedias.detalle : "", /1000/, "esconde una reversión parcial");

// ── 9 · De un error de Stripe a un veredicto ────────────────────────────────
// Todos los casos de abajo están MEDIDOS contra *test mode* el 10-sep-2026.

// 🔴 US y BR: la plataforma es estadounidense y el acuerdo `recipient` no vale de
// US a US/BR. Es esperado y NO es una avería: `sin-datos` deja la orden viva para
// que la pague Wise, el único riel que llega a esos dos.
assert.equal(
  veredictoDeFallo({
    type: "StripeInvalidRequestError",
    param: "tos_acceptance[service_agreement]",
    message: "The recipient ToS agreement is not supported for platforms in US creating accounts in US.",
  }),
  "sin-datos",
  "trata el país no soportado como un fallo del sistema",
);
// Y también sin `param`, por si Stripe deja de ponerlo.
assert.equal(
  veredictoDeFallo({
    type: "StripeInvalidRequestError",
    message: "The recipient ToS agreement is not supported for platforms in US creating accounts in BR.",
  }),
  "sin-datos",
);

// Datos del tutor incompletos o mal: el código postal que Stripe valida por país,
// el código de banco que ocho países exigen, el tipo de cuenta de CL/CO.
for (const param of [
  "individual[address][postal_code]",
  "individual[dob][day]",
  "external_account[routing_number]",
  "external_account[account_type]",
  "business_type",
]) {
  assert.equal(
    veredictoDeFallo({ type: "StripeInvalidRequestError", code: "parameter_missing", param }),
    "sin-datos",
    `un 400 sobre ${param} enterraría la liquidación en 'failed'`,
  );
}

// Saldo: dinero que se debe y saldrá. Se comprueba ANTES que el campo porque
// llega como `invalid_request_error` y sin eso contaría como rechazo.
assert.equal(
  veredictoDeFallo({ type: "StripeInvalidRequestError", code: "balance_insufficient", param: "amount" }),
  "sin-fondos",
);

// Un identificador que ya no existe (sandbox borrado, cuenta eliminada a mano).
assert.equal(
  veredictoDeFallo({ type: "StripeInvalidRequestError", code: "resource_missing", param: "destination" }),
  "no-existe",
);

// La credencial para el lote entero, no la orden.
assert.equal(veredictoDeFallo({ type: "StripeAuthenticationError" }), "sin-credencial");
assert.equal(veredictoDeFallo({ type: "StripePermissionError" }), "sin-credencial");

// El momento, no la orden.
assert.equal(veredictoDeFallo({ type: "StripeConnectionError" }), "transitorio");
assert.equal(veredictoDeFallo({ type: "StripeAPIError" }), "transitorio");
assert.equal(veredictoDeFallo({ type: "StripeRateLimitError" }), "transitorio");

// ⚠️ `StripeIdempotencyError` NO es transitorio: significa que se reusó la marca
// con parámetros distintos, o sea que algo cambió el importe de una orden ya
// intentada. Reintentarlo a ciegas es lo que no se hace con dinero.
assert.equal(veredictoDeFallo({ type: "StripeIdempotencyError" }), "rechazado");
// Y lo que no encaja en nada tampoco se reintenta solo.
assert.equal(veredictoDeFallo({ type: "StripeInvalidRequestError", param: "amount" }), "rechazado");
assert.equal(veredictoDeFallo(new Error("algo raro")), "rechazado");

console.log(
  "✓ stripe-payout-mapeo: cuenta de destinatario, aceptación, titular, banco, idempotencia, desenlaces y 20 errores",
);

/* ── 🔑 Colombia: el tipo de cuenta VIAJA, y sin él no se puede pagar ──────
 *
 * Medido el 10-sep-2026: adjuntar una cuenta colombiana sin `account_type`
 * devuelve «Invalid bank account type: the account type is required». El dato
 * estaba guardado desde siempre en `tutor_payout_accounts.bank_account_type`;
 * lo que faltaba era que la RPC lo mandara y que este mapeo lo pusiera.
 *
 * Se fija aquí porque el fallo era MUDO: el veredicto era `sin-datos`, que deja
 * la orden quieta, y Wise va delante de Stripe en Colombia — así que el tutor
 * cobraba igual y el riel roto no daba la cara.
 */
{
  const CO: BeneficiarioStripe = {
    ...ES,
    country: "CO",
    currency: "cop",
    account_type: "CHECKING",
    account_number: "000123456789",
    routing_number: "007",
  };
  const r = parametrosDeCuentaBancaria(CO);
  assert("params" in r, "Colombia con todos sus datos tiene que poder adjuntar cuenta");
  const ext = r.params.external_account as unknown as Record<string, unknown>;
  assert.equal(ext.account_type, "checking",
    "sin account_type en minúsculas, Stripe rechaza la cuenta colombiana");

  // Y donde no se usa, NO se manda: un campo de más en un país que no lo espera
  // es ruido, y el contrato es «lo que la RPC no trae, no viaja».
  const sinTipo = parametrosDeCuentaBancaria(ES);
  assert("params" in sinTipo);
  assert.equal(
    "account_type" in (sinTipo.params.external_account as unknown as Record<string, unknown>),
    false,
    "España no usa tipo de cuenta y no debe mandarlo",
  );
}
