/**
 * `npm run check:csv` — el escape del CSV, sin red ni base.
 *
 * Existe por el caso 3 de `csv.ts`: la inyección de fórmulas. Ese fallo NO se
 * ve en pantalla —el CSV se descarga bien, se abre bien y la celda enseña lo que
 * Excel decida— y los datos que lo alimentan los teclea cualquiera que se
 * registre. Los otros casos están porque una coma en un nombre desplaza todas
 * las columnas siguientes y eso tampoco lanza ningún error: simplemente sale un
 * fichero con los datos cambiados de sitio.
 */
import assert from "node:assert/strict";
import { aCsv, campoCsv, fechaCsv, importeCsv } from "./csv.ts";

const casos: [string, () => void][] = [
  [
    "un campo normal no se toca",
    () => {
      assert.equal(campoCsv("Marina Gómez"), "Marina Gómez");
      assert.equal(campoCsv(13), "13");
    },
  ],
  [
    "null y undefined salen como celda vacía, no como \"null\"",
    () => {
      assert.equal(campoCsv(null), "");
      assert.equal(campoCsv(undefined), "");
      // El cero SÍ es un dato y tiene que sobrevivir: es «no ha tomado ninguna».
      assert.equal(campoCsv(0), "0");
    },
  ],
  [
    "la coma, las comillas y el salto de línea se entrecomillan",
    () => {
      assert.equal(campoCsv("Gómez, Marina"), '"Gómez, Marina"');
      assert.equal(campoCsv('dijo "hola"'), '"dijo ""hola"""');
      assert.equal(campoCsv("dos\nlíneas"), '"dos\nlíneas"');
    },
  ],
  [
    "⚠️ un nombre que empieza por = no llega a Excel como fórmula",
    () => {
      // El ataque real: al abrir el CSV, Excel ejecuta esto.
      assert.equal(
        campoCsv('=HYPERLINK("http://malo","Haz clic")'),
        `"'=HYPERLINK(""http://malo"",""Haz clic"")"`,
      );
      // Los otros cinco arranques.
      assert.equal(campoCsv("+1"), "'+1");
      assert.equal(campoCsv("-1+2"), "'-1+2");
      assert.equal(campoCsv("@SUM(A1)"), "'@SUM(A1)");
      assert.equal(campoCsv("\tcosa"), "'\tcosa");
    },
  ],
  [
    "un teléfono E.164 sobrevive: empieza por + y no es una fórmula",
    () => {
      // Sale con la comilla delante A PROPÓSITO. Sin ella Excel lo evalúa como
      // suma y «+584124444444» se convierte en el número 584124444444, sin el
      // «+» — que es justo lo que hace falta para poder llamar.
      assert.equal(campoCsv("+584124444444"), "'+584124444444");
    },
  ],
  [
    "el fichero lleva BOM, CRLF y cabecera",
    () => {
      const csv = aCsv(["nombre", "tomadas"], [["Marina", 13]]);
      assert.ok(csv.startsWith("﻿"), "falta el BOM → Excel rompe las tildes");
      assert.equal(csv, "﻿nombre,tomadas\r\nMarina,13\r\n");
    },
  ],
  [
    "una tabla sin filas sigue siendo un CSV válido con su cabecera",
    () => {
      assert.equal(aCsv(["a", "b"], []), "﻿a,b\r\n");
    },
  ],
  [
    "el importe sale sumable en Excel, no formateado",
    () => {
      assert.equal(importeCsv(94100), "941.00");
      assert.equal(importeCsv(0), "0.00");
      assert.equal(importeCsv(5), "0.05");
    },
  ],
  [
    "la fecha sale en ISO corta, y la ausencia como celda vacía",
    () => {
      assert.equal(fechaCsv("2026-08-29T21:00:00+00:00"), "2026-08-29");
      assert.equal(fechaCsv(null), "");
    },
  ],
];

let fallos = 0;
for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.error(`  ✗ ${nombre}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (fallos > 0) {
  console.error(`\n✗ csv: ${fallos} de ${casos.length} comprobaciones fallaron`);
  process.exit(1);
}
console.log(`\n✓ csv: ${casos.length} comprobaciones, el escape aguanta comas, comillas y fórmulas`);
