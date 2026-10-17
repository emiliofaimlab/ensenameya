// npm run check:sala — el reloj y el turno de lo compartido en la sala.
import assert from "node:assert/strict";

import { actualizarOrden, ordenados } from "./escenario.ts";
import { estadoContador, puedeExtender, reloj } from "./tiempo.ts";

// ── reloj ────────────────────────────────────────────────────────────────
assert.equal(reloj(0), "00:00");
assert.equal(reloj(65_000), "01:05");
assert.equal(reloj(3_723_000), "1:02:03");
assert.equal(reloj(-5), "00:00");

// ── fases: clase 10:00–11:00, sala cierra 11:10 ──────────────────────────
const S = "2026-10-16T10:00:00Z";
const E = "2026-10-16T11:00:00Z";
const C = "2026-10-16T11:10:00Z";
const t = (hm: string) => Date.parse(`2026-10-16T${hm}:00Z`);
assert.equal(estadoContador(t("09:55"), S, E, C).fase, "antes");
assert.equal(estadoContador(t("10:30"), S, E, C).fase, "normal");
assert.equal(estadoContador(t("10:30"), S, E, C).transcurrido, 30 * 60_000);
assert.equal(estadoContador(t("10:55"), S, E, C).fase, "aviso");
assert.equal(estadoContador(t("11:00"), S, E, C).fase, "extra");
assert.equal(estadoContador(t("11:04"), S, E, C).hastaCierre, 6 * 60_000);
// El transcurrido no se congela al llegar al fin: sigue contando en el extra.
assert.equal(estadoContador(t("11:04"), S, E, C).transcurrido, 64 * 60_000);
assert.equal(estadoContador(t("11:10"), S, E, C).fase, "cerrada");
// Extendida: azul hasta el nuevo fin, aunque falten menos de 5 min.
assert.equal(estadoContador(t("10:58"), S, E, C, true).fase, "extendida");
assert.equal(estadoContador(t("11:01"), S, E, C, true).fase, "extra");
// B9 · grupal (extendida = false): una grupal no se extiende, así que la sala
// grupal pasa `false`. Con `true` pintaba «Clase extendida» desde el minuto 0
// y el aviso de los 5 minutos no salía nunca (el tercer caso es ese fallo).
assert.equal(estadoContador(t("10:00"), S, E, C, false).fase, "normal");
assert.equal(estadoContador(t("10:55"), S, E, C, false).fase, "aviso");
assert.equal(estadoContador(t("10:00"), S, E, C, true).fase, "extendida");
assert.equal(estadoContador(t("10:30"), S, E, C).total, 60 * 60_000);
assert.equal(puedeExtender("normal"), false);
assert.equal(puedeExtender("extendida"), false);
assert.equal(puedeExtender("aviso"), true);
assert.equal(puedeExtender("extra"), true);
assert.equal(puedeExtender("cerrada"), false);

// ── turno de lo compartido ───────────────────────────────────────────────
let o = actualizarOrden({}, ["pantalla:a"], 1);
assert.deepEqual(ordenados(o), ["pantalla:a"]);
// Sin cambios → el mismo objeto (si no, el ajuste en render haría bucle).
assert.equal(actualizarOrden(o, ["pantalla:a"], 9), o);
// Llega el documento: pasa al escenario, la pantalla baja a la franja.
o = actualizarOrden(o, ["pantalla:a", "doc"], 2);
assert.deepEqual(ordenados(o), ["pantalla:a", "doc"]);
// El orden de las claves de entrada no importa, manda la hora.
o = actualizarOrden(o, ["doc", "pantalla:a"], 3);
assert.deepEqual(ordenados(o), ["pantalla:a", "doc"]);
// Se deja de presentar: la pantalla vuelve al escenario.
o = actualizarOrden(o, ["pantalla:a"], 4);
assert.deepEqual(ordenados(o), ["pantalla:a"]);
// Vuelve a presentar: es lo último otra vez.
o = actualizarOrden(o, ["pantalla:a", "doc"], 5);
assert.deepEqual(ordenados(o), ["pantalla:a", "doc"]);
assert.deepEqual(ordenados(actualizarOrden(o, [], 6)), []);

console.log("check:sala OK");
