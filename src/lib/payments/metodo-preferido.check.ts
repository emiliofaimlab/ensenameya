import assert from "node:assert/strict";

import {
  esCanalManual,
  metodosDelPais,
  ordenaPorPreferencia,
  preferenciaVigente,
  rielSirveAlMetodo,
} from "./metodo-preferido.ts";

const riel = (clave: string, dato: "banco" | "identificador") =>
  ({ clave, dato });

/* ── qué riel sirve a qué método ───────────────────────────────────────── */

// 🔴 dLocal y Wise son UNA opción para el tutor: los dos leen su misma cuenta.
assert.equal(rielSirveAlMetodo(riel("dlocal", "banco"), "banco"), true);
assert.equal(rielSirveAlMetodo(riel("wise", "banco"), "banco"), true,
  "elegir 'banco' tiene que adelantar a los DOS rieles bancarios, no a uno");
// 🔑 Y STRIPE TAMBIÉN, desde el dictado del 9-sep-2026. Aquí se afirmaba lo
// contrario —«el alta de Stripe no es transferencia bancaria: es otra
// tarjeta»— porque existía la familia 'conectada'. Ya no: los TRES rieles de
// banco leen la misma cuenta del tutor y son UNA sola tarjeta.
assert.equal(rielSirveAlMetodo(riel("stripe", "banco"), "banco"), true,
  "elegir 'banco' tiene que adelantar a los TRES rieles bancarios");

// La asimetría de identificador, la misma que en `rielSirveParaEsteTutor`.
assert.equal(rielSirveAlMetodo(riel("paypal", "identificador"), "paypal"), true);
assert.equal(rielSirveAlMetodo(riel("paypal", "identificador"), "zinli"), false,
  "el riel de PayPal solo sirve a su propio canal");
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "zinli"), true);
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "paypal"), false,
  "PayPal lo paga su riel, no el manual");

// 🔴 Y el manual NO se da por elegido cuando el tutor pidió banco. Sin
// `esCanalManual` esto devolvería true —«no es paypal, luego es mío»— y un
// mexicano que eligió su banco vería adelantado el riel que paga una persona.
assert.equal(rielSirveAlMetodo(riel("manual", "identificador"), "banco"), false);

assert.equal(esCanalManual("zinli"), true);
assert.equal(esCanalManual("banco"), false);

/* ── el reordenado ────────────────────────────────────────────────────── */

// La fila real de México: dlocal > stripe > paypal > wise.
const mx = [
  riel("dlocal", "banco"),
  riel("stripe", "banco"),
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

// 🔑 Con 'banco' suben los TRES bancarios —dlocal, stripe y wise—, cada uno en
// su orden de tabla, y PayPal queda detrás. Aquí se esperaba
// ["dlocal","wise","stripe","paypal"] cuando Stripe era de familia 'conectada' y
// no se adelantaba; desde el dictado del 9-sep-2026 es un riel de banco más y
// sube con ellos. Quién va antes lo decide el coste medido en la tabla de ruteo,
// no esta función.
assert.deepEqual(
  ordenaPorPreferencia(mx, "banco").map((r) => r.clave),
  ["dlocal", "stripe", "wise", "paypal"],
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

// 🔑 Colombia: {stripe, wise, paypal} — DOS familias, DOS tarjetas. Antes eran
// tres, porque Stripe traía la suya propia; con el dictado, Stripe y Wise son la
// MISMA tarjeta de banco y el tutor no sabe cuál de los dos le paga.
{
  const metodos = metodosDelPais({
    rieles: [riel("stripe", "banco"), riel("wise", "banco"), riel("paypal", "identificador")],
    familias: ["banco", "identificador"],
    canalesActivos: ["paypal"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["banco", "paypal"]);
}

// 🔴 México: dlocal, stripe Y wise, UNA sola tarjeta de banco. Tres tarjetas
// aquí serían pedirle tres veces su CLABE para la misma cuenta.
{
  const metodos = metodosDelPais({
    rieles: mx,
    familias: ["banco", "identificador"],
    canalesActivos: ["paypal"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["banco", "paypal"]);
}

// 🔴 Un país SIN fila en `payout_country_rules`: 'banco' no es pintable aunque
// los rieles lleguen, porque sin esa fila no hay etiquetas que poner ni formato
// contra el que validar, y el formulario no podría guardar.
//
// ⚠️ ESTE CASO ES LA DEUDA QUE EL DICTADO DESTAPA, no el comportamiento
// deseado: la fase 3 abre esa tabla al mundo justamente para que España y
// compañía dejen de caer aquí. Mientras caigan, ven solo PayPal.
{
  const metodos = metodosDelPais({
    rieles: [riel("stripe", "banco"), riel("paypal", "identificador"), riel("wise", "banco")],
    familias: ["identificador"], // 'banco' ya viene fuera: sin fila de país no hay formulario
    canalesActivos: ["paypal"],
  });
  assert.deepEqual(metodos.map((m) => m.clave), ["paypal"]);
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
