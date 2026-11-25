import assert from "node:assert/strict";

import { enFranjas, franjasDe, franjasLabel } from "./clasificados.ts";

/**
 * `npm run check:clasificados` · `enFranjas` replica `public.clasificado_admite`.
 * Si se desvía, la pantalla ofrece horas que el servidor rechaza.
 */
const tz = "America/Caracas"; // UTC-4, sin horario de verano
const lunes = franjasDe([{ dia: 1, desde: "18:00", hasta: "21:00" }]);

// 30-nov-2026 es lunes. 22:00Z = 18:00 en Caracas.
assert.equal(enFranjas("2026-11-30T22:00:00Z", lunes, tz, 60), true, "18:00-19:00 cabe");
assert.equal(enFranjas("2026-12-01T00:00:00Z", lunes, tz, 60), true, "20:00-21:00 cabe justo");
assert.equal(enFranjas("2026-12-01T00:30:00Z", lunes, tz, 60), false, "20:30-21:30 se sale");
assert.equal(enFranjas("2026-11-30T21:00:00Z", lunes, tz, 60), false, "17:00 empieza antes");
assert.equal(enFranjas("2026-12-01T22:00:00Z", lunes, tz, 60), false, "martes no");

// Sin cruzar la medianoche, como el SQL.
const noche = franjasDe([{ dia: 1, desde: "23:00", hasta: "24:00" }]);
assert.equal(enFranjas("2026-12-01T03:30:00Z", noche, tz, 60), false, "23:30-00:30 cruza el día");

assert.deepEqual(franjasDe("basura"), []);
assert.equal(franjasLabel([...lunes, ...lunes]), "Lun 18:00–21:00", "sin franjas repetidas");
assert.equal(
  franjasLabel(franjasDe([{ dia: 3, desde: "09:00", hasta: "12:00" }, ...lunes])),
  "Lun 18:00–21:00 · Mié 09:00–12:00",
);

console.log("OK · enFranjas replica clasificado_admite (día local, dentro de la franja, sin cruzar medianoche)");
