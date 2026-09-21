/**
 * ¿Este error lo produjo un RASTREADOR en vez de una persona?
 *
 * Vive fuera de `src/instrumentation-client.ts` por una razón concreta: ese
 * fichero llama a `Sentry.init()` al importarse, así que no se puede cargar
 * desde una comprobación sin arrancar medio SDK. Aquí es una función pura, con
 * su `npm run check:bots` al lado (`sentry-bot.check.ts`).
 *
 * El caso que lo trae, del 19-sep-2026: «TypeError: Cannot read properties of
 * undefined (reading 'getReader')» en `/privacy`, con marcos
 * `ext:core/01_core.js` y `eventLoopTick` — **las tripas de Deno**, no de un
 * navegador. Un bot que ejecuta JavaScript (vista previa de enlace, monitor de
 * uptime) corriendo nuestra página en un runtime donde el `fetch` no da cuerpo
 * de respuesta.
 *
 * ⚠️ SE MIRA EL ORIGEN, NO EL MENSAJE. Filtrar por «getReader» escondería ese
 * mismo fallo el día que le pase a un usuario de verdad. Un marco cuyo fichero
 * empieza por `ext:` no puede venir de ningún navegador, y eso no depende de
 * qué error sea.
 */

/** Lo mínimo que hace falta de un evento de Sentry. Estructural a propósito:
 *  así esto no importa el SDK y la comprobación corre en Node pelado. */
export type EventoConTraza = {
  exception?: {
    values?: Array<{
      stacktrace?: { frames?: Array<{ filename?: string }> };
    }>;
  };
};

export function loEjecutaUnBot(evento: EventoConTraza): boolean {
  return (evento.exception?.values ?? []).some((v) =>
    (v.stacktrace?.frames ?? []).some((f) => f.filename?.startsWith("ext:")),
  );
}
