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
      value?: string;
      stacktrace?: { frames?: Array<{ filename?: string }> };
    }>;
  };
};

/*
 * Los otros dos casos, del 24/25-sep-2026 (18 de las 22 excepciones de esa
 * semana en PostHog):
 *
 * - `app://navigation_performance_logger_android`: el script que el navegador
 *   de Instagram inyecta en la página («Java object is gone»). Ojo: Sentry
 *   reescribe NUESTROS marcos como `app:///_next/…` —tres barras—; lo inyectado
 *   lleva dos y un nombre. Sigue siendo mirar el origen.
 * - «Object Not Found Matching Id:1, MethodName:update, ParamCount:4»: el
 *   puente de CefSharp, o sea el escáner de enlaces de Outlook (Chrome 140 en
 *   Windows 7). Aquí no hay traza, así que se mira el mensaje — y se puede,
 *   porque ninguna línea nuestra rechaza con ese texto.
 */
const INYECTADO_POR_WEBVIEW = /^app:\/\/[^/]/;
const PUENTE_CEFSHARP = /Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/;

export function loEjecutaUnBot(evento: EventoConTraza): boolean {
  return (evento.exception?.values ?? []).some(
    (v) =>
      PUENTE_CEFSHARP.test(v.value ?? "") ||
      (v.stacktrace?.frames ?? []).some(
        (f) => f.filename?.startsWith("ext:") || INYECTADO_POR_WEBVIEW.test(f.filename ?? ""),
      ),
  );
}
