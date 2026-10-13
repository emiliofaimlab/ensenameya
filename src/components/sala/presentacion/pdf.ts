import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * EY-221 · pdf.js, cargado SOLO en el navegador y solo cuando se presenta.
 *
 * ⚠️ Import dinámico a propósito: `pdfjs-dist` toca `DOMMatrix`, `Path2D` y
 * compañía al evaluarse, y la sala se renderiza también en el servidor. Además
 * pesa: no tiene sentido que lo descargue quien nunca abre un material.
 *
 * El worker se declara con `new URL(…, import.meta.url)`: es la forma que
 * entienden tanto Turbopack como webpack para emitir el fichero como asset y
 * darle una URL propia (sin copiarlo a mano a `/public`, donde se quedaría
 * desfasado en la próxima actualización de la librería).
 */
let lib: Promise<typeof import("pdfjs-dist")> | null = null;

export function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return m;
  });
  return lib;
}

/** Un documento por material y por pestaña: cambiar de página no lo rebaja. */
const cache = new Map<string, Promise<PDFDocumentProxy>>();

/**
 * Abre el PDF de un material de la sesión: URL firmada de vida corta pedida a
 * NUESTRO servidor (que comprueba que eres parte de la sesión) y bajada entera
 * a memoria. Por el canal de Daily solo viaja el `docId`.
 */
export function abrirMaterial(
  sessionId: string,
  docId: string,
): Promise<PDFDocumentProxy> {
  const clave = `${sessionId}:${docId}`;
  let p = cache.get(clave);
  if (!p) {
    p = (async () => {
      const r = await fetch(
        `/api/room/${encodeURIComponent(sessionId)}/materiales/${encodeURIComponent(docId)}`,
        { cache: "no-store" },
      );
      const cuerpo = (await r.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!r.ok || !cuerpo.url) {
        throw new Error(cuerpo.error ?? "No pudimos abrir el material.");
      }
      const f = await fetch(cuerpo.url);
      if (!f.ok) throw new Error("No pudimos descargar el material.");
      const data = new Uint8Array(await f.arrayBuffer());
      const m = await pdfjs();
      return m.getDocument({ data }).promise;
    })();
    // Un fallo no se queda cacheado: el siguiente intento vuelve a pedirlo.
    p.catch(() => cache.delete(clave));
    cache.set(clave, p);
  }
  return p;
}
