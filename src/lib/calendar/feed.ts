/**
 * EY-188 · Las URL de la suscripción de calendario, en un solo sitio.
 *
 * Sin `server-only`: lo necesitan las dos orillas. El Route Handler arma el
 * enlace de la sala que va DENTRO del .ics, y la tarjeta del panel arma el
 * enlace que el usuario pega en Apple o en Google.
 */

import { utc } from "@/lib/calendar/ics-format";

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

/**
 * Ruta del .ics de UNA clase — descarga, no suscripción.
 *
 * ⚠️ Dos segmentos, así que NO choca con `/api/calendario/<token>`, que es uno
 * solo (y un token son 64 hex, nunca la palabra `sesion`). No «arreglar» la
 * vecindad juntándolos.
 */
export function sesionIcsPath(sessionId: string): string {
  return `/api/calendario/sesion/${sessionId}${SUFIJO_ICS}`;
}

/**
 * Plantilla de «evento nuevo» de Google Calendar, con los datos ya rellenos.
 *
 * Existe porque Google de escritorio **no consume un .ics descargado**: obliga
 * a Configuración → Importar. Con esto, un clic y el evento está creado.
 *
 * ⚠️ Mismo aviso que `googleAddUrl`: es una URL de un tercero y su forma la
 * decide Google. Si deja de funcionar, se quita el enlace y el .ics sigue
 * cubriendo Apple y Outlook.
 *
 * `dates` pide exactamente `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ`, que es `utc()`
 * dos veces: cero código de fechas nuevo (regla de oro 4).
 */
export function googleTemplateUrl({
  titulo,
  inicio,
  fin,
  detalle,
}: {
  titulo: string;
  inicio: string;
  fin: string;
  detalle?: string;
}): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: titulo,
    dates: `${utc(inicio)}/${utc(fin)}`,
  });
  if (detalle) p.set("details", detalle);
  return `https://calendar.google.com/calendar/render?${p}`;
}
