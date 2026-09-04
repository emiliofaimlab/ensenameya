import assert from "node:assert/strict";

import { estadoDeTransferencia, verdictoDeTransferencia } from "./connect-mapeo.ts";

// Una credencial rota para el lote entero, y no cuenta como fallo de la orden.
assert.equal(verdictoDeTransferencia({ statusCode: 401 }), "sin-credencial");
assert.equal(verdictoDeTransferencia({ type: "StripePermissionError" }), "sin-credencial");

// Saldo insuficiente es dinero que se debe: vuelve a la cola, no a 'failed'.
assert.equal(
  verdictoDeTransferencia({ statusCode: 400, code: "balance_insufficient" }),
  "sin-fondos",
  "sin fondos NO es un rechazo: el pago sale cuando haya saldo",
);

// 🔴 El alta a medias vuelve a la cola, no a 'failed'. Es lo que devuelve de
// verdad una cuenta conectada recién creada (medido, 4-sep-2026).
assert.equal(
  verdictoDeTransferencia({ statusCode: 400, code: "insufficient_capabilities_for_transfer" }),
  "sin-datos",
  "el tutor todavía no terminó su alta: eso se arregla solo",
);

// El momento, no la orden.
assert.equal(verdictoDeTransferencia({ statusCode: 429 }), "transitorio");
assert.equal(verdictoDeTransferencia({ statusCode: 503 }), "transitorio");
assert.equal(verdictoDeTransferencia({ type: "StripeConnectionError" }), "transitorio");

// La orden: repetirla mañana da lo mismo.
assert.equal(
  verdictoDeTransferencia({ statusCode: 400, code: "transfers_not_allowed" }),
  "rechazado",
  "una cuenta sin capability `transfers` no se arregla reintentando",
);
assert.equal(
  verdictoDeTransferencia({ statusCode: 400, type: "StripeInvalidRequestError" }),
  "rechazado",
);

// 🔴 El defecto. Un error que no reconocemos vuelve a la cola: enterrar el pago
// de un tutor en silencio es peor que hacer ruido.
assert.equal(
  verdictoDeTransferencia({}),
  "transitorio",
  "lo desconocido se reintenta; 'failed' es una decisión, no un defecto",
);
assert.equal(verdictoDeTransferencia({ statusCode: 418, code: "nunca_visto" }), "transitorio");

// Vida de la transferencia.
assert.equal(estadoDeTransferencia({ amount: 1000 }), "viva");
assert.equal(estadoDeTransferencia({ reversed: true, amount: 1000 }), "difunta");
assert.equal(
  estadoDeTransferencia({ amount: 1000, amount_reversed: 400 }),
  "revertida-en-parte",
  "si parte del dinero llegó, remandarla entera paga de más",
);
assert.equal(estadoDeTransferencia({ amount: 1000, amount_reversed: 1000, reversed: true }), "difunta");

console.log("connect-mapeo.check.ts · ok");
