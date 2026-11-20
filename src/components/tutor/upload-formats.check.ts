// npm run check:subidas — EY-249: claves de Storage solo ASCII.
import assert from "node:assert/strict";
import { nombreParaClave } from "./upload-formats.ts";

assert.equal(nombreParaClave("Guía práctica.pdf"), "Guia_practica.pdf");
assert.equal(nombreParaClave("Año 2º ¿repaso?.xlsx"), "Ano_2_repaso_.xlsx");
assert.equal(nombreParaClave("ok-file_1.docx"), "ok-file_1.docx");
assert.equal(nombreParaClave("日本.pdf"), "_.pdf");
assert.equal(nombreParaClave(""), "archivo");
for (const n of ["Guía.pdf", "ñandú (copia).pptx", "😀.png"])
  assert.match(nombreParaClave(n), /^[\w.-]+$/);
console.log("check:subidas OK");
