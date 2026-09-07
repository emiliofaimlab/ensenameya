import assert from "node:assert/strict";

import { rielSirveParaEsteTutor, type DatosDeCobro } from "./riel-viable.ts";

const riel = (clave: string, dato: "banco" | "identificador" | "conectada") =>
  ({ clave, dato });

const nada: DatosDeCobro = { conectada: false, banco: false, canales: [] };

// 🔴 EL CASO QUE ESTUVO ROTO Y MUDO: venezolano con Zinli y sin PayPal.
// Antes se elegía PayPal, el adaptador decía «sin destino de paypal» y la orden
// se quedaba en 'scheduled' para siempre.
{
  const zinli: DatosDeCobro = { ...nada, canales: ["zinli"] };
  assert.equal(rielSirveParaEsteTutor(riel("paypal", "identificador"), zinli), false,
    "PayPal NO sirve si el tutor solo registró Zinli");
  assert.equal(rielSirveParaEsteTutor(riel("manual", "identificador"), zinli), true,
    "el riel manual SÍ: es justo el tutor que eligió Zinli");
}

// El que sí registró PayPal cobra por PayPal, que es lo de siempre.
{
  const pp: DatosDeCobro = { ...nada, canales: ["paypal"] };
  assert.equal(rielSirveParaEsteTutor(riel("paypal", "identificador"), pp), true);
  assert.equal(rielSirveParaEsteTutor(riel("manual", "identificador"), pp), false,
    "con solo PayPal no hay canal manual que usar");
}

// Los dos a la vez: sirven los dos, y manda el orden de la tabla de ruteo.
{
  const ambos: DatosDeCobro = { ...nada, canales: ["paypal", "zinli"] };
  assert.equal(rielSirveParaEsteTutor(riel("paypal", "identificador"), ambos), true);
  assert.equal(rielSirveParaEsteTutor(riel("manual", "identificador"), ambos), true);
}

// Banco y cuenta conectada: cada familia mira lo suyo y nada más.
assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), { ...nada, banco: true }), true);
assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), { ...nada, canales: ["zinli"] }), false,
  "un destino de Zinli no es una cuenta bancaria");
assert.equal(rielSirveParaEsteTutor(riel("stripe", "conectada"), { ...nada, conectada: true }), true);
assert.equal(rielSirveParaEsteTutor(riel("stripe", "conectada"), { ...nada, banco: true }), false,
  "tener banco no es tener cuenta conectada: son cosas distintas");

// Sin nada registrado, ningún riel sirve. La orden espera, que es lo correcto.
for (const [clave, dato] of [["paypal","identificador"],["manual","identificador"],
                             ["dlocal","banco"],["stripe","conectada"]] as const) {
  assert.equal(rielSirveParaEsteTutor(riel(clave, dato), nada), false, `${clave} sin datos`);
}

console.log("riel-viable.check.ts · ok");
