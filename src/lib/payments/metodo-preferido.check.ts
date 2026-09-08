import assert from "node:assert/strict";

import {
  esCanalManual,
  metodosDelPais,
  ordenaPorPreferencia,
  preferenciaVigente,
  rielSirveAlMetodo,
} from "./metodo-preferido.ts";

const riel = (clave: string, dato: "banco" | "identificador" | "conectada") =>
  ({ clave, dato });

/* ── qué riel sirve a qué método ───────────────────────────────────────── */

// 🔴 dLocal y Wise son UNA opción para el tutor: los dos leen su misma cuenta.
assert.equal(rielSirveAlMetodo(riel("dlocal", "banco"), "banco"), true);
assert.equal(rielSirveAlMetodo(riel("wise", "banco"), "banco"), true,
  "elegir 'banco' tiene que adelantar a los DOS rieles bancarios, no a uno");
assert.equal(rielSirveAlMetodo(riel("stripe", "conectada"), "banco"), false,
  "el alta de Stripe no es 'transferencia bancaria': es otra tarjeta");

// La asimetría de identificador, la misma que en `rielSirveParaEsteTutor`.
assert.equal(rielSirveAlMetodo(riel("paypal", "identificador"), "paypal"), true);
assert.equal(rielSirveAlMetodo(riel("paypal", "identificador"), "zinli"), false,
  "el riel de PayPal solo sirve a su propio canal");
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "zinli"), true);
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "paypal"), false,
  "PayPal lo paga su riel, no el manual");

// 🔴 Y el manual NO se da por elegido cuando el tutor pidió banco o Stripe. Sin
// `esCanalManual` esto devolvería true —«no es paypal, luego es mío»— y un
// mexicano que eligió su banco vería adelantado el riel que paga una persona.
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "banco"), false);
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "stripe"), false);

assert.equal(esCanalManual("zinli"), true);
assert.equal(esCanalManual("banco"), false);

/* ── el reordenado ────────────────────────────────────────────────────── */

// La fila real de México: dlocal > stripe > paypal > wise.
const mx = [
  riel("dlocal", "banco"),
  riel("stripe", "conectada"),
  riel("paypal", "identificador"),
  riel("wise", "banco"),
];

// 🔑 EL CONTRATO: sin preferencia, el orden es EXACTAMENTE el de la tabla. Un
// tutor que no ha elegido rutea igual que antes de que esto existiera.
assert.deepEqual(ordenaPorPreferencia(mx, null), mx);

// Con PayPal elegido, PayPal va primero y el resto conserva su orden relativo.
assert.deepEqual(
  ordenaPorPreferencia(mx, "paypal").map((r) => r.clave),
  ["paypal", "dlocal", "stripe", "wise"],
);

// Con 'banco', los DOS bancarios suben, en su orden de tabla (dlocal antes que
// wise, que es lo que decide el coste medido, no esta función).
assert.deepEqual(
  ordenaPorPreferencia(mx, "banco").map((r) => r.clave),
  ["dlocal", "wise", "stripe", "paypal"],
);

// Una preferencia que no tiene candidato —el tutor eligió Zelle y México no
// rutea el riel manual— no reordena nada. Es el fallo seguro de la migración:
// un valor sin riel no puede mandar dinero a ningún sitio.
assert.deepEqual(ordenaPorPreferencia(mx, "zelle"), mx);
assert.deepEqual(ordenaPorPreferencia(mx, "loquesea"), mx);

/* ── las tarjetas que se ofrecen ──────────────────────────────────────── */

// Venezuela: {paypal, manual}. Sale PayPal y un canal por cada manual servible.
{
  const metodos = metodosDelPais({
    rieles: [riel("paypal", "identificador"), riel("manual", "identificador")],
    familias: ["identificador"],
    canalesActivos: ["paypal", "zinli", "binance", "zelle"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["paypal", "zinli", "binance", "zelle"]);
  assert.equal(metodos[0].automatico, true, "PayPal lo ejecuta el job");
  assert.equal(metodos[1].automatico, false, "Zinli lo manda una persona");
}

// Colombia: {stripe, wise, paypal} — tres familias, tres tarjetas, en el orden
// de la tabla de ruteo.
{
  const metodos = metodosDelPais({
    rieles: [riel("stripe", "conectada"), riel("wise", "banco"), riel("paypal", "identificador")],
    familias: ["conectada", "banco", "identificador"],
    canalesActivos: ["paypal"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["stripe", "banco", "paypal"]);
}

// 🔴 México: dlocal Y wise, UNA sola tarjeta de banco. Dos tarjetas aquí serían
// pedirle dos veces su CLABE para la misma cuenta.
{
  const metodos = metodosDelPais({
    rieles: mx,
    familias: ["banco", "conectada", "identificador"],
    canalesActivos: ["paypal"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["banco", "stripe", "paypal"]);
}

// 🔴 España / resto del mundo: la fila por defecto rutea {stripe, paypal, wise},
// pero 'banco' NO es pintable porque ES no tiene fila en `payout_country_rules`.
// Sin ese filtro se le ofrecería un formulario bancario que no puede guardar.
{
  const metodos = metodosDelPais({
    rieles: [riel("stripe", "conectada"), riel("paypal", "identificador"), riel("wise", "banco")],
    familias: ["conectada", "identificador"], // 'banco' ya viene fuera
    canalesActivos: ["paypal"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["stripe", "paypal"]);
}

// Un país mixto donde PayPal no rutea: el canal 'paypal' del catálogo NO se
// ofrece aunque esté encendido. Es el fallo del venezolano con Zinli al revés.
{
  const metodos = metodosDelPais({
    rieles: [riel("manual", "identificador")],
    familias: ["identificador"],
    canalesActivos: ["paypal", "zinli"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["zinli"]);
}

// Sin canales servibles no hay tarjeta de identificador, aunque el riel exista.
assert.deepEqual(
  metodosDelPais({
    rieles: [riel("paypal", "identificador")],
    familias: ["identificador"],
    canalesActivos: [],
  }),
  [],
);

/* ── la preferencia vigente ───────────────────────────────────────────── */

const deVe = metodosDelPais({
  rieles: [riel("paypal", "identificador"), riel("manual", "identificador")],
  familias: ["identificador"],
  canalesActivos: ["paypal", "zinli"],
});

assert.equal(preferenciaVigente("zinli", deVe), "zinli");
assert.equal(preferenciaVigente(null, deVe), null, "sin elegir no se inventa una");
// 🔴 El tutor que eligió su banco y luego se mudó a Venezuela: 'banco' ya no es
// una tarjeta suya, así que no se pinta ningún radio marcado. Enseñarlo sería
// decirle que cobra por donde no cobra.
assert.equal(preferenciaVigente("banco", deVe), null);

console.log("metodo-preferido.check.ts ✅");
