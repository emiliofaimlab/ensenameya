import assert from "node:assert/strict";

import {
  receptorDe, PaypalError, aDecimal, desenlace, loteDuplicadoSinEnlace, loteYaExistente,
  type LotePaypal } from "./paypal-mapeo.ts";

/**
 * Comprobación del mapeo de PayPal. Sin framework: `npm run check:paypal`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque las dos reglas que vigila no fallan ruidosamente cuando se rompen:
 *
 *   · si `UNCLAIMED` acabara mapeando a 'pagado', se marcaría la fila `paid` y
 *     con eso sale NTF-12 «se pagó tu liquidación» a un tutor que NO tiene el
 *     dinero — PayPal lo retiene 30 días y luego lo devuelve. Es el correo que
 *     C1 ya desarmó una vez por mandarse sin que el dinero se moviera.
 *   · si `loteYaExistente` dejara de reconocer el 400 de duplicado, cada
 *     reintento crearía un lote nuevo. La marca de idempotencia es lo ÚNICO que
 *     impide pagarle dos veces al mismo tutor, porque este adaptador —a
 *     diferencia del de dLocal— no tiene barrido de huérfanos que lo atrape.
 */

const lote = (estado: string, batch = "SUCCESS"): LotePaypal => ({
  batch_header: { payout_batch_id: "KKM4X27WFLE3C", batch_status: batch },
  items: [{ transaction_status: estado, payout_item_id: "3VT8LE8DKVWKY" }],
});

// ── 1 · Solo SUCCESS es dinero en manos del tutor ──────────────────────────
assert.equal(desenlace(lote("SUCCESS"), "EY-1-0", false).estado, "pagado");

// 🔑 El caso caro: PayPal aceptó, el LOTE dice SUCCESS, y el tutor no ha
// cobrado. Si esto vuelve a 'pagado', el correo miente.
for (const enVuelo of ["PENDING", "PROCESSING", "ONHOLD", "UNCLAIMED"]) {
  assert.equal(
    desenlace(lote(enVuelo), "EY-1-0", false).estado,
    "enviado",
    `${enVuelo} tiene que dejar la orden en seguimiento, no darla por pagada`,
  );
}

// ── 2 · Los muertos son 'difunto', no 'rechazado' ──────────────────────────
// La diferencia no es cosmética: 'difunto' archiva el id y sube el intento, y
// es lo que permite que `manage_payout('retry')` reintente de verdad en vez de
// preguntar para siempre por un lote que PayPal ya dio por muerto.
for (const muerto of ["DENIED", "FAILED", "BLOCKED", "RETURNED", "REVERSED", "CANCELED"]) {
  assert.equal(desenlace(lote(muerto), "EY-1-0", false).estado, "difunto", muerto);
}

// Un estado que PayPal invente mañana NO se adivina: se sigue mirando.
assert.equal(desenlace(lote("VERIFICANDO_ALGO"), "EY-1-0", false).estado, "enviado");

// Manda el ITEM, no el lote. Lote SUCCESS con item DENIED es un impago.
assert.equal(desenlace(lote("DENIED", "SUCCESS"), "EY-1-0", false).estado, "difunto");

// ── 3 · El 400 de duplicado, tal como PayPal lo devolvió de verdad ─────────
// Cuerpo copiado de la respuesta medida en el sandbox el 3-sep-2026.
const dup = new PaypalError(
  400,
  {
    name: "USER_BUSINESS_ERROR",
    details: [
      {
        field: "SENDER_BATCH_ID",
        issue: "Batch with given sender_batch_id already exists",
        link: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/KKM4X27WFLE3C" }],
      },
    ],
  },
  "PayPal 400",
);
assert.equal(loteYaExistente(dup), "KKM4X27WFLE3C");

// Un 400 por otra cosa NO es un duplicado: adoptar ahí sería adoptar la nada.
assert.equal(
  loteYaExistente(new PaypalError(400, { details: [{ field: "AMOUNT" }] }, "x")),
  null,
);
// Y un duplicado SIN enlace tampoco se adivina componiendo la URL: `null`.
const dupSinEnlace = new PaypalError(400, { details: [{ field: "SENDER_BATCH_ID" }] }, "x");
assert.equal(loteYaExistente(dupSinEnlace), null);

// 🔴 PERO ESE `null` NO SIGNIFICA «no era un duplicado», y confundirlo es lo que
// mandaba la orden al desenlace `rechazado` —«el proveedor no creó nada»— cuando
// PayPal acababa de decir que el lote SÍ existe. Desde AUD-01 un rechazo puede
// bajar al siguiente riel, así que esa confusión paga dos veces.
assert.equal(loteDuplicadoSinEnlace(dupSinEnlace), true,
  "un duplicado sin enlace SÍ es un duplicado: hay un pago que conciliar");
assert.equal(loteDuplicadoSinEnlace(dup), false,
  "el que trae enlace NO pasa por aquí: lo adopta `loteYaExistente`, que es el camino bueno");
assert.equal(loteDuplicadoSinEnlace(new PaypalError(400, { details: [{ field: "AMOUNT" }] }, "x")), false,
  "un 400 por otra cosa no es un duplicado");
assert.equal(loteDuplicadoSinEnlace(new PaypalError(500, {}, "x")), false);
assert.equal(loteDuplicadoSinEnlace(new Error("red")), false);
assert.equal(loteYaExistente(new PaypalError(500, {}, "x")), null);
assert.equal(loteYaExistente(new Error("red")), null);

// ── 4 · El importe sale de unidades menores, y con dos decimales ───────────
// $47,50 se manda como "47.50". Un "47.5" o un 4750 es pagar de menos o de más.
assert.equal(aDecimal(4750), "47.50");
assert.equal(aDecimal(100), "1.00");
assert.equal(aDecimal(1), "0.01");

// ── A quién se le paga ─────────────────────────────────────────────────────
// La cuenta conectada gana al correo SIEMPRE: el correo puede estar sin
// confirmar y entonces el pago no llega, aunque el lote diga SUCCESS.
assert.deepEqual(
  receptorDe({ handle: "tutor@ejemplo.com", verified_account_id: "BEWSZFK8MDBWU" }),
  { recipient_type: "PAYPAL_ID", receiver: "BEWSZFK8MDBWU", conectada: true },
  "con cuenta conectada se paga al id, no al correo",
);

// Sin conectar, el correo es el respaldo y sigue funcionando.
assert.deepEqual(
  receptorDe({ handle: "tutor@ejemplo.com", verified_account_id: null }),
  { recipient_type: "EMAIL", receiver: "tutor@ejemplo.com", conectada: false },
);

// Espacios: un id " " no es un id.
assert.equal(receptorDe({ handle: "  ", verified_account_id: "   " }), null);
assert.deepEqual(receptorDe({ handle: " a@b.com ", verified_account_id: "  " }), {
  recipient_type: "EMAIL", receiver: "a@b.com", conectada: false,
});

// 🔴 Sin nada, NULL. Quien llame devuelve 'sin-datos'; inventarse un receptor
// es mandar dinero a la nada.
assert.equal(receptorDe({}), null);
assert.equal(receptorDe({ handle: null, verified_account_id: null }), null);

console.log("✅ mapeo de PayPal: 'pagado' solo con SUCCESS, y el duplicado se reconoce.");
