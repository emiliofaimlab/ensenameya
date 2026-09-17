/**
 * Serializar una tabla a CSV para que el cliente la abra en Excel.
 *
 * Son treinta líneas y hay cuatro decisiones dentro, todas por algo que se
 * rompe de verdad. Ninguna es de adorno:
 *
 * 1. **BOM UTF-8.** Excel de Windows NO detecta UTF-8 por su cuenta: abre el
 *    fichero en la codificación del sistema y «Julián Prado» sale «JuliÃ¡n
 *    Prado». Con el cliente en Latinoamérica y nombres con tildes y ñ en cada
 *    fila, esto no es un detalle. Tres bytes lo arreglan y ningún otro programa
 *    se molesta.
 *
 * 2. **Escape RFC 4180.** Un campo con coma, comillas o salto de línea rompe la
 *    rejilla entera y desplaza todas las columnas siguientes. `full_name` lo
 *    escribe el usuario, así que puede traer cualquier cosa.
 *
 * 3. ⚠️ **Anti-inyección de fórmulas.** Un campo que empieza por `=`, `+`, `-`,
 *    `@`, tabulador o retorno de carro lo ejecuta Excel COMO FÓRMULA al abrir el
 *    fichero. Alguien que se registre con el nombre `=HYPERLINK("http://malo",
 *    "Haz clic")` está escribiendo una fórmula en la hoja del administrador, y
 *    hay familias de ataque bastante peores que un enlace. Los datos de estas
 *    tablas los teclean usuarios anónimos, así que esto NO es paranoia: es la
 *    condición para poder exportarlos. Se antepone una comilla simple, que es
 *    la marca de «esto es texto» de Excel y de Sheets.
 *
 * 4. **CRLF.** Lo pide el RFC y es lo que Excel espera.
 *
 * Deliberadamente NO hay lector de CSV: aquí solo se escribe.
 */

/** Los seis arranques que Excel y Sheets interpretan como fórmula. */
const ARRANQUE_PELIGROSO = /^[=+\-@\t\r]/;

/** Un campo, ya escapado y listo para pegar entre comas. */
export function campoCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  let s = String(valor);

  // Punto 3. Va ANTES del escape de comillas: la comilla simple que se añade
  // aquí es parte del texto y tiene que quedar dentro de las comillas dobles.
  if (ARRANQUE_PELIGROSO.test(s)) s = `'${s}`;

  // Punto 2. Se entrecomilla siempre que haga falta, y solo entonces: un
  // fichero lleno de comillas innecesarias es más difícil de leer a ojo.
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Cabeceras + filas → el cuerpo completo del fichero, BOM incluido.
 *
 * Se devuelve `string` y no `Buffer` porque el destino es un `Response` de Next,
 * que ya codifica a UTF-8; el BOM viaja como el carácter U+FEFF y sale como los
 * tres bytes correctos.
 */
export function aCsv(
  cabeceras: string[],
  filas: (string | number | null | undefined)[][],
): string {
  const lineas = [cabeceras, ...filas].map((f) => f.map(campoCsv).join(","));
  return `﻿${lineas.join("\r\n")}\r\n`;
}

/**
 * Importe en unidades mínimas → la unidad principal, con punto decimal.
 *
 * Para el CSV NO se usa `formatMoney`: «941,00 US$» es texto para Excel y no se
 * puede sumar. Sale «941.00» en una columna y «USD» en la de al lado, que es lo
 * que se puede meter en una fórmula. Punto y no coma porque es lo que entiende
 * un Excel en inglés y lo que cualquier otra herramienta espera; un Excel en
 * español lo importa igual desde el asistente de texto.
 *
 * ⚠️ Asume dos decimales, como el resto del proyecto (`lib/dinero.ts`). Si algún
 * día entra una moneda de cero decimales —JPY, CLP— esto y su gemela mienten a
 * la vez y hay que arreglar las dos.
 */
export function importeCsv(unidadesMinimas: number): string {
  return (unidadesMinimas / 100).toFixed(2);
}

/** `timestamptz` → `YYYY-MM-DD`, que es lo que Excel ordena sin pelear. */
export function fechaCsv(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}
