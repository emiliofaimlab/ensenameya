import assert from "node:assert/strict";

import { PaypalError, aDecimal, desenlace, loteYaExistente, type LotePaypal } from "./paypal-mapeo.ts";

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
// Y un duplicado SIN enlace tampoco se adivina componiendo la URL.
assert.equal(
  loteYaExistente(new PaypalError(400, { details: [{ field: "SENDER_BATCH_ID" }] }, "x")),
  null,
);
assert.equal(loteYaExistente(new PaypalError(500, {}, "x")), null);
assert.equal(loteYaExistente(new Error("red")), null);

// ── 4 · El importe sale de unidades menores, y con dos decimales ───────────
// $47,50 se manda como "47.50". Un "47.5" o un 4750 es pagar de menos o de más.
assert.equal(aDecimal(4750), "47.50");
assert.equal(aDecimal(100), "1.00");
assert.equal(aDecimal(1), "0.01");

console.log("✅ mapeo de PayPal: 'pagado' solo con SUCCESS, y el duplicado se reconoce.");
