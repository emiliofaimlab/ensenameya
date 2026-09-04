import assert from "node:assert/strict";

import { cadenaDeCobro, nuncaLlego, porQueNadie, recorreLaCadena, type Salida } from "./cadena.ts";

/**
 * Comprobación de la cadena de respaldo del cobro. Sin framework: se corre con
 * `npm run check:cadena` y falla con exit code, igual que `check:chat`.
 *
 * ── POR QUÉ ESTO MERECE UN FICHERO ──────────────────────────────────────────
 * Porque es la lógica que decide QUIÉN COBRA, y sus dos reglas caras no fallan
 * ruidosamente cuando se rompen:
 *
 *   · si el orden se estropea, el cobro se abre por el proveedor equivocado y
 *     `payments.provider` deja de decir de qué balance sale el payout — se ve
 *     semanas después, en una orden de pago que no cuadra;
 *   · si la parada de `en-duda` se convierte en un `continue` —que es
 *     exactamente el cambio que "arregla" un 503 molesto—, quedan DOS cobros
 *     vivos para la misma reserva y el alumno puede pagar los dos. Eso no se ve
 *     nunca en pruebas: hace falta que un proveedor tarde de más.
 *
 * El caso de abajo que vigila lo segundo asegura que el candidato siguiente
 * **no se llegó a llamar**. Es la única forma de probar una parada: comprobar
 * lo que NO ocurrió.
 */

// ── EL ORDEN ────────────────────────────────────────────────────────────────

// El caso normal: nadie ha cobrado aún y el snapshot es la cabeza del ruteo, así
// que la cadena es el ruteo tal cual.
assert.deepEqual(
  cadenaDeCobro({ cobrador: null, snapshot: "stripe", ruteo: ["stripe", "dlocal"] }),
  ["stripe", "dlocal"],
  "VE/CO: Stripe primero y dLocal detrás",
);
assert.deepEqual(
  cadenaDeCobro({ cobrador: null, snapshot: "dlocal", ruteo: ["dlocal", "stripe"] }),
  ["dlocal", "stripe"],
  "los 8 países de dLocal: al revés",
);

// Quien YA abrió un cobro va primero, aunque el ruteo prefiera a otro. Es lo que
// impide que una recarga abra un segundo cobro con el preferido recién
// arreglado mientras el del respaldo sigue vivo y pagable.
assert.deepEqual(
  cadenaDeCobro({ cobrador: "dlocal", snapshot: "stripe", ruteo: ["stripe", "dlocal"] }),
  ["dlocal", "stripe"],
  "el que ya cobró manda sobre la preferencia",
);

// El snapshot va delante del ruteo: si la tabla se reordenó con reservas a
// medias, esa reserva termina por donde empezó.
assert.deepEqual(
  cadenaDeCobro({ cobrador: null, snapshot: "stripe", ruteo: ["dlocal", "stripe"] }),
  ["stripe", "dlocal"],
  "el snapshot manda sobre el ruteo de hoy",
);

// Un snapshot que ya no está en el ruteo sigue siendo la cabeza, y el ruteo
// entero queda detrás como respaldo.
assert.deepEqual(
  cadenaDeCobro({ cobrador: null, snapshot: "simulated", ruteo: ["stripe", "dlocal"] }),
  ["simulated", "stripe", "dlocal"],
  "un snapshot fuera del ruteo no se pierde",
);

// Sin repetidos y sin vacíos: dos llamadas idénticas al mismo proveedor con la
// misma clave de idempotencia no aportan nada.
assert.deepEqual(
  cadenaDeCobro({ cobrador: "stripe", snapshot: "stripe", ruteo: ["stripe", "", "dlocal", "dlocal"] }),
  ["stripe", "dlocal"],
);

// Sin ruteo y sin nada congelado no hay cadena. Quien llama lo traduce a 503 con
// el motivo, nunca al simulado.
assert.deepEqual(cadenaDeCobro({ cobrador: null, snapshot: null, ruteo: [] }), []);

// ── EL RECORRIDO ────────────────────────────────────────────────────────────

/** Un `intentar` de mentira que anota a quién se llamó, y en qué orden. */
function sonda(respuestas: Record<string, Salida<string>>) {
  const llamados: string[] = [];
  return {
    llamados,
    intentar: async (clave: string): Promise<Salida<string>> => {
      llamados.push(clave);
      return respuestas[clave] ?? { tipo: "descartado", motivo: "sin respuesta en la sonda" };
    },
  };
}

const ABRE = (quien: string): Salida<string> => ({ tipo: "abierto", cobro: quien });

// El primero cobra: no se toca a nadie más.
{
  const s = sonda({ stripe: ABRE("sesión de stripe"), dlocal: ABRE("no debería") });
  const r = await recorreLaCadena(["stripe", "dlocal"], s.intentar);
  assert.equal(r.estado, "cobrado");
  assert.equal(r.estado === "cobrado" && r.clave, "stripe");
  assert.deepEqual(s.llamados, ["stripe"], "el que cobra corta la cadena");
}

// Falta credencial → se cae al siguiente, y el motivo del descartado se
// conserva: es lo que hace depurable encender un proveedor.
{
  const s = sonda({
    stripe: { tipo: "descartado", motivo: "Stripe no configurado (falta STRIPE_API_KEY)" },
    dlocal: ABRE("cobro de dlocal"),
  });
  const r = await recorreLaCadena(["stripe", "dlocal"], s.intentar);
  assert.equal(r.estado === "cobrado" && r.clave, "dlocal", "el respaldo cobra");
  assert.deepEqual(s.llamados, ["stripe", "dlocal"]);
  assert.deepEqual(
    r.intentos,
    [{ clave: "stripe", motivo: "Stripe no configurado (falta STRIPE_API_KEY)" }],
    "el motivo del descartado viaja con el resultado",
  );
}

// `{ok:false}` del puerto → también se cae al siguiente: el proveedor dijo no a
// propósito y por contrato no creó nada. Es «dLocal no puede cobrar a este
// pagador».
{
  const s = sonda({
    dlocal: { tipo: "descartado", motivo: "el proveedor no devolvió redirect_url" },
    stripe: ABRE("sesión de stripe"),
  });
  const r = await recorreLaCadena(["dlocal", "stripe"], s.intentar);
  assert.equal(r.estado === "cobrado" && r.clave, "stripe");
}

// 🔴 EL CASO CARO: `charge()` LANZÓ. La petición pudo llegar, así que se PARA.
// Lo que se comprueba es lo que NO pasó: al segundo candidato no se le llama.
{
  const s = sonda({
    stripe: { tipo: "en-duda", mensaje: "fetch failed" },
    dlocal: ABRE("ESTE COBRO NO DEBERÍA EXISTIR"),
  });
  const r = await recorreLaCadena(["stripe", "dlocal"], s.intentar);
  assert.equal(r.estado, "en-duda", "un throw no se cae al siguiente");
  assert.deepEqual(
    s.llamados,
    ["stripe"],
    "tras un throw NO se abre un cobro con el siguiente: serían dos cobros vivos",
  );
  assert.equal(r.estado === "en-duda" && r.clave, "stripe");
}

// Y para igual cuando el que lanza es el respaldo, a mitad de cadena.
{
  const s = sonda({
    stripe: { tipo: "descartado", motivo: "sin clave" },
    dlocal: { tipo: "en-duda", mensaje: "504 del proveedor" },
    wise: ABRE("no existe este riel de cobro, pero por si acaso"),
  });
  const r = await recorreLaCadena(["stripe", "dlocal", "wise"], s.intentar);
  assert.equal(r.estado, "en-duda");
  assert.deepEqual(s.llamados, ["stripe", "dlocal"]);
  // El descartado anterior sigue en la lista: el 503 tiene que poder contar la
  // historia entera.
  assert.equal(r.intentos.length, 2);
}

// Nadie pudo: el resultado lleva TODOS los motivos, uno por candidato. Es la
// diferencia entre un 503 depurable y «no se pudo cobrar».
{
  const s = sonda({
    stripe: { tipo: "descartado", motivo: "falta STRIPE_API_KEY" },
    dlocal: { tipo: "descartado", motivo: "falta DLOCALGO_SECRET_KEY" },
  });
  const r = await recorreLaCadena(["stripe", "dlocal"], s.intentar);
  assert.equal(r.estado, "nadie");
  assert.deepEqual(s.llamados, ["stripe", "dlocal"], "se intentan todos");
  assert.equal(
    porQueNadie(r.intentos),
    "stripe: falta STRIPE_API_KEY · dlocal: falta DLOCALGO_SECRET_KEY",
    "el 503 dice qué le faltaba a cada uno",
  );
}

// Una cadena vacía no llama a nadie y tampoco cae al simulado: es un 503 con
// motivo.
{
  const s = sonda({});
  const r = await recorreLaCadena([], s.intentar);
  assert.equal(r.estado, "nadie");
  assert.deepEqual(s.llamados, []);
  assert.ok(porQueNadie(r.intentos).length > 0, "la cadena vacía tiene que explicarse");
}

// `nuncaLlego`: la línea entre «no se envió» y «no sabemos». Es lo que decide si
// un dLocal caído deja pasar a Stripe o deja al alumno sin comprar.
{
  const caido = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
  assert.equal(nuncaLlego(caido), true, "un socket rechazado no pudo abrir ningún cobro");

  const dns = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
  });
  assert.equal(nuncaLlego(dns), true, "si el DNS no resuelve, no se envió nada");

  // 🔴 Los que NO pueden caer al siguiente: la petición ya salió.
  const cortado = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
  });
  assert.equal(nuncaLlego(cortado), false, "un reset ocurre DESPUÉS de enviar: puede haber cobro");

  const tarde = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
  });
  assert.equal(nuncaLlego(tarde), false, "un timeout de respuesta no descarta el cobro");

  assert.equal(nuncaLlego(new Error("500 del proveedor")), false, "un 5xx llegó por definición");
  assert.equal(nuncaLlego(null), false);
}

console.log("cadena.check.ts · ok");
