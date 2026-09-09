import assert from "node:assert/strict";

import { rielSirveParaEsteTutor, type DatosDeCobro } from "./riel-viable.ts";

const riel = (clave: string, dato: "banco" | "identificador") =>
  ({ clave, dato });

// `metodo_preferido` no interviene aquí: esta función contesta si el riel PUEDE
// pagarle, no si el tutor lo quiere. Quien mira la preferencia es
// `ordenaPorPreferencia` (`metodo-preferido.check.ts`), y separarlas es el punto.
const nada: DatosDeCobro = {
  banco: false, banco_stripe: false, banco_wise: false, canales: [], metodo_preferido: null,
};

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

// Los TRES rieles de banco miran la misma fila, y cada familia mira lo suyo.
assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), { ...nada, banco: true }), true);
assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), { ...nada, canales: ["zinli"] }), false,
  "un destino de Zinli no es una cuenta bancaria");
// 🔑 Stripe pasó a ser riel de BANCO con el dictado del 9-sep-2026: le sirve la
// misma cuenta que a dLocal. Aquí se afirmaba lo contrario —«tener banco no es
// tener cuenta conectada: son cosas distintas»— porque existía la familia
// 'conectada', que era el alta de Connect. Ya no existe.
// ⚠️ AQUÍ SE AFIRMABA que «a Stripe le vale la cuenta bancaria que el tutor
// tecleó, como a dLocal». Era verdad a medias y por eso se corrigió el 10-sep:
// le vale la MISMA cuenta, sí, pero además necesita la fecha de nacimiento y la
// aceptación de condiciones. El caso completo está al final del fichero.
assert.equal(rielSirveParaEsteTutor(riel("stripe", "banco"), { ...nada, banco: true }), false,
  "la cuenta sola no basta para Stripe: le faltan sus dos datos");
assert.equal(rielSirveParaEsteTutor(riel("stripe", "banco"), nada), false,
  "sin cuenta registrada no le puede pagar nadie");

// 🔴 EL MISMO FALLO, UN RIEL MÁS TARDE: dLocal y Wise leen la misma fila de
// coordenadas bancarias y no les vale lo mismo. Un tutor colombiano de Itaú
// tiene banco —y cobra por dLocal— pero Wise no conoce ese banco. Si Wise
// mirase `banco`, se elegiría a sí mismo, el adaptador diría «sin-datos» y la
// orden se quedaría esperando para siempre. Exactamente el caso Zinli.
{
  const soloDlocal: DatosDeCobro = { ...nada, banco: true };
  assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), soloDlocal), true,
    "dLocal sirve con solo tener coordenadas");
  assert.equal(rielSirveParaEsteTutor(riel("wise", "banco"), soloDlocal), false,
    "Wise NO sirve con solo tener coordenadas: pide dirección, teléfono, país y banco suyo");

  const ambos: DatosDeCobro = { ...nada, banco: true, banco_wise: true };
  assert.equal(rielSirveParaEsteTutor(riel("wise", "banco"), ambos), true,
    "con los datos completos Wise sí sirve");
  assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), ambos), true,
    "y no se los quita a dLocal: manda el orden de la tabla de ruteo");
}

// Sin nada registrado, ningún riel sirve. La orden espera, que es lo correcto.
for (const [clave, dato] of [["paypal","identificador"],["manual","identificador"],
                             ["dlocal","banco"],["wise","banco"],["stripe","banco"]] as const) {
  assert.equal(rielSirveParaEsteTutor(riel(clave, dato), nada), false, `${clave} sin datos`);
}

console.log("riel-viable.check.ts · ok");

/* ── 🔑 Stripe pide dos cosas más que dLocal, y por eso tiene su propia clave ──
 *
 * Los dos campos son OPCIONALES en el formulario, así que lo normal es que un
 * tutor tenga banco y NO los tenga. Sin esta rama se elegiría Stripe para él,
 * `payout_beneficiary_stripe` levantaría excepción y la orden se quedaría en
 * `sin-datos`: ni paga ni falla. Es el mismo fallo mudo que dejó a un tutor
 * venezolano con Zinli sin cobrar nunca.
 */
{
  const conBanco = { ...nada, banco: true };
  assert.equal(rielSirveParaEsteTutor(riel("dlocal", "banco"), conBanco), true,
    "a dLocal le basta con que la cuenta exista");
  assert.equal(rielSirveParaEsteTutor(riel("stripe", "banco"), conBanco), false,
    "tener banco NO basta para Stripe: faltan la fecha de nacimiento y la aceptación");
  assert.equal(
    rielSirveParaEsteTutor(riel("stripe", "banco"), { ...conBanco, banco_stripe: true }),
    true,
    "con los dos datos puestos, Stripe sí le puede pagar",
  );
  // Y las tres claves son independientes: completar lo de Wise no habilita a
  // Stripe ni al revés. Confundirlas sería volver al filtro único de antes.
  assert.equal(
    rielSirveParaEsteTutor(riel("stripe", "banco"), { ...conBanco, banco_wise: true }),
    false,
    "lo que Wise necesita no es lo que necesita Stripe",
  );
}
