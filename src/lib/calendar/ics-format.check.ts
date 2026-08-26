import assert from "node:assert/strict";

import { campo, crudo, escapar, plegar, utc } from "./ics-format.ts";

/**
 * EY-188 · Comprobación de las reglas de escritura del .ics. Sin framework: se
 * corre con `npm run check:ics` y falla con exit code, igual que
 * `check:email`.
 *
 * Existe porque un .ics mal formado NO da error en ninguna parte: el servidor
 * responde 200, el calendario del usuario se suscribe sin quejarse y lo que
 * falla es la línea 40 de un archivo que nadie mira. El plegado por octetos con
 * títulos acentuados es el sitio exacto donde eso pasa.
 */
const enc = new TextEncoder();

/** Ninguna línea de un .ics puede pasar de 75 octetos. */
function octetosPorLinea(salida: string): number[] {
  return salida.split("\r\n").map((l) => enc.encode(l).length);
}

// ── Escapado (§3.3.11) ──────────────────────────────────────────────────────
assert.equal(escapar("a,b"), "a\\,b", "la coma no se escapó");
assert.equal(escapar("a;b"), "a\\;b", "el punto y coma no se escapó");
assert.equal(escapar("a\\b"), "a\\\\b", "la barra no se escapó");
assert.equal(escapar("a\nb"), "a\\nb", "el salto de línea no se escapó");
assert.equal(escapar("a\r\nb"), "a\\nb", "el CRLF debe colapsar a un solo \\n");
// El orden importa: si se escapara la coma antes que la barra, la barra que
// introduce el escape se volvería a escapar y saldría `a\\,b`.
assert.equal(escapar("\\,"), "\\\\\\,", "el orden del escapado está invertido");

// ── Plegado (§3.1) ──────────────────────────────────────────────────────────
assert.equal(plegar("corta"), "corta", "una línea corta no se debe tocar");

const exacta75 = "X".repeat(75);
assert.equal(plegar(exacta75), exacta75, "75 octetos justos no se pliegan");

const larga = "SUMMARY:" + "a".repeat(200);
for (const n of octetosPorLinea(plegar(larga))) {
  assert.ok(n <= 75, `línea de ${n} octetos: el plegado no respeta el límite`);
}
// Al desplegar (quitar CRLF + espacio) tiene que salir el original intacto.
assert.equal(
  plegar(larga).split("\r\n ").join(""),
  larga,
  "el plegado pierde o añade caracteres",
);

// ⚠️ EL CASO QUE IMPORTA: acentos y eñes. Cada uno son DOS octetos en UTF-8, así
// que una línea de 60 caracteres ya puede pasar de 75 octetos, y el corte cae
// dentro de un carácter si se parte por índice de byte a lo bruto.
const acentuada =
  "SUMMARY:Preparación de exámenes de Matemáticas — Álgebra y Geometría avanzada con María G.";
const plegada = plegar(acentuada);
for (const n of octetosPorLinea(plegada)) {
  assert.ok(n <= 75, `línea acentuada de ${n} octetos: se pasa del límite`);
}
assert.equal(
  plegada.split("\r\n ").join(""),
  acentuada,
  "el plegado partió un carácter multibyte por la mitad",
);
assert.ok(
  !plegada.includes("�"),
  "apareció un carácter de reemplazo: se cortó dentro de un UTF-8",
);

// Un carácter de 4 octetos (emoji) justo en la frontera tampoco se puede partir.
const emoji = "DESCRIPTION:" + "b".repeat(64) + "🎓🎓🎓" + "c".repeat(40);
const plegadoEmoji = plegar(emoji);
for (const n of octetosPorLinea(plegadoEmoji)) {
  assert.ok(n <= 75, `línea con emoji de ${n} octetos`);
}
assert.equal(
  plegadoEmoji.split("\r\n ").join(""),
  emoji,
  "el plegado partió un emoji",
);

// ── Fechas: siempre UTC con Z, sin milisegundos (regla de oro 4) ────────────
assert.equal(
  utc("2026-08-26T21:00:00.000Z"),
  "20260826T210000Z",
  "el formato de fecha UTC no es el del RFC",
);
// Una fecha con desplazamiento se normaliza a UTC, no se copia tal cual.
assert.equal(
  utc("2026-08-26T23:00:00+02:00"),
  "20260826T210000Z",
  "no se está normalizando a UTC",
);
assert.ok(
  /^\d{8}T\d{6}Z$/.test(utc(new Date().toISOString())),
  "la fecha de ahora no cumple el patrón",
);

// ── `campo` escapa y `crudo` no (las URI se romperían) ──────────────────────
assert.equal(campo("SUMMARY", "Inglés, nivel B2"), "SUMMARY:Inglés\\, nivel B2");
const url = "https://ensenameya.com/room/a,b;c";
assert.equal(crudo("URL", url), `URL:${url}`, "crudo() no debe escapar una URI");

console.log("OK · escapado, plegado por octetos, UTF-8 multibyte y fechas UTC");
