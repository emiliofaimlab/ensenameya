/**
 * EY-188 · Las cuatro reglas de escritura de iCalendar (RFC 5545), sueltas.
 *
 * Están en su propio módulo —sin `server-only`, sin alias `@/` y sin importar
 * nada— para que `ics-format.check.ts` las pueda ejecutar con
 * `node --experimental-strip-types`, igual que `email-templates.check.ts`. Es
 * la parte del feed que más fácil se rompe y menos ruido hace al romperse: un
 * .ics mal plegado no da error, simplemente el calendario del usuario enseña
 * medio título o descarta el evento.
 */

/** ⚠️ CRLF, no LF. El RFC lo exige y hay clientes que rechazan el archivo. */
export const CRLF = "\r\n";

/** Escapa un valor de tipo TEXT (§3.3.11). */
export function escapar(valor: string): string {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Plegado de líneas largas (§3.1).
 *
 * ⚠️ El límite son 75 **octetos**, no caracteres, y aquí los títulos llevan
 * tildes y eñes: en UTF-8 esos ocupan dos bytes. Cortar por índice de carácter
 * deja líneas de 90 bytes; cortar por índice de byte a lo bruto parte un
 * carácter multibyte por la mitad y el cliente enseña un rombo negro o descarta
 * el evento entero. Por eso se retrocede mientras el byte del corte sea un byte
 * de continuación de UTF-8 (`10xxxxxx`).
 *
 * La primera línea admite 75; las siguientes 74, porque el espacio de
 * continuación cuenta como octeto.
 */
export function plegar(linea: string): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let bytes = enc.encode(linea);
  if (bytes.length <= 75) return linea;

  const trozos: string[] = [];
  let limite = 75;
  while (bytes.length > limite) {
    let corte = limite;
    while (corte > 0 && (bytes[corte] & 0xc0) === 0x80) corte -= 1;
    // Salvaguarda: un carácter que no cupiera ni empezando de cero dejaría
    // `corte` en 0 y esto giraría para siempre. Con UTF-8 (4 bytes máximo) no
    // puede pasar, pero un bucle infinito en una ruta pública no se deja al
    // azar.
    if (corte === 0) corte = limite;
    trozos.push(dec.decode(bytes.slice(0, corte)));
    bytes = bytes.slice(corte);
    limite = 74;
  }
  trozos.push(dec.decode(bytes));
  return trozos.join(`${CRLF} `);
}

/** `NOMBRE:valor` con el valor escapado como TEXT. */
export function campo(nombre: string, valor: string): string {
  return plegar(`${nombre}:${escapar(valor)}`);
}

/**
 * `NOMBRE:valor` SIN escapar. Para los tipos que no son TEXT: fechas, enteros,
 * duraciones y URI. ⚠️ Escapar una URI la rompe — la coma de un enlace es parte
 * del enlace, no un separador de lista.
 */
export function crudo(nombre: string, valor: string): string {
  return plegar(`${nombre}:${valor}`);
}

/** `20260826T210000Z` — forma UTC del RFC (§3.3.5). Regla de oro 4. */
export function utc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
