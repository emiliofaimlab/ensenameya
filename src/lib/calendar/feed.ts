/**
 * EY-188 · Las URL de la suscripción de calendario, en un solo sitio.
 *
 * Sin `server-only`: lo necesitan las dos orillas. El Route Handler arma el
 * enlace de la sala que va DENTRO del .ics, y la tarjeta del panel arma el
 * enlace que el usuario pega en Apple o en Google.
 */

/**
 * El sufijo `.ics` no lo exige ningún cliente —los dos miran el
 * `Content-Type`— pero la URL se pega a mano en un cuadro de diálogo y un
 * humano necesita reconocer qué es lo que está pegando. El Route Handler lo
 * recorta antes de buscar el token.
 */
export const SUFIJO_ICS = ".ics";

/** Ruta relativa del feed. */
export function feedPath(token: string): string {
  return `/api/calendario/${token}${SUFIJO_ICS}`;
}

/** URL absoluta `https://…` — la que entiende todo el mundo. */
export function feedUrl(origin: string, token: string): string {
  return `${origin}${feedPath(token)}`;
}

/**
 * La misma URL con esquema `webcal:`, que es lo que hace que macOS e iOS abran
 * Calendario directamente en vez de descargar el archivo. No es un protocolo de
 * verdad: los clientes lo traducen a `https` para pedirlo.
 */
export function webcalUrl(origin: string, token: string): string {
  return feedUrl(origin, token).replace(/^https?:/, "webcal:");
}

/**
 * Atajo de Google Calendar para «añadir calendario desde URL».
 *
 * ⚠️ NO SE HA PODIDO VERIFICAR desde el repo: es una URL de un tercero y su
 * forma exacta la decide Google. Por eso el camino principal de la tarjeta es
 * copiar la URL y pegarla a mano —eso funciona siempre— y esto es un atajo. Si
 * algún día deja de abrir el diálogo, se quita el botón y no se rompe nada.
 */
export function googleAddUrl(origin: string, token: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
    webcalUrl(origin, token),
  )}`;
}
