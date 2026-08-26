import "server-only";

import { NRO_SESION_LABEL } from "@/components/room/session-ref";
import { CRLF, campo, crudo, utc } from "@/lib/calendar/ics-format";
import type { EventoFeed } from "@/lib/calendar/rpc";

/**
 * EY-188 · Serializador de iCalendar (RFC 5545). Sin dependencias: el formato
 * que necesitamos son ocho propiedades y cuatro reglas de escritura, y meter una
 * librería para eso trae más superficie que texto. Las reglas de escritura
 * viven en `ics-format.ts`, que sí tiene comprobación (`npm run check:ics`).
 */

/**
 * ⚠️ EL DOMINIO DEL `UID` ES FIJO Y NO SALE DE LA PETICIÓN.
 *
 * El `UID` es lo único que le dice al calendario «este evento ya lo tienes,
 * actualízalo» en vez de «este es nuevo, duplícalo». Si se armara con el host de
 * quien pide —que es lo natural, porque el resto de enlaces sí salen de ahí—,
 * mover la suscripción de la preview a producción cambiaría el UID de TODOS los
 * eventos y el calendario del usuario acabaría con cada clase por duplicado.
 *
 * Y es `sessions.id`, nunca `session_ref`: esa referencia es **no única a
 * propósito** (`20260817140000:130-142`).
 */
const UID_DOMINIO = "ensenameya.com";

/** «Sesión 2 de 4» cuando el paquete tiene más de una clase. */
function ordinal(e: EventoFeed): string | null {
  if (!e.sequence_no || e.num_sessions <= 1) return null;
  return `Sesión ${e.sequence_no} de ${e.num_sessions}`;
}

function vevento(e: EventoFeed, origin: string): string[] {
  const cancelada = e.estado === "cancelada";
  const salaUrl = `${origin}/room/${e.session_id}`;
  const resumen = e.con ? `${e.titulo} con ${e.con}` : e.titulo;

  const descripcion = [
    cancelada
      ? "Esta clase fue cancelada."
      : "Mentoría reservada en Enséñame Ya.",
    ordinal(e),
    e.session_ref ? `${NRO_SESION_LABEL} ${e.session_ref}` : null,
    // La sala solo abre en su ventana (10 min antes, ver `room-window.ts`), así
    // que fuera de ella el enlace lleva a nuestra pantalla, que lo explica. NO
    // se publica el enlace de Daily: `sessions.daily_room_url` está vacío en
    // producción —solo lo escribía la rama simulada (`20260716120000:87`)— y
    // derivarlo a mano es justo lo que hacía fallar a US-1802 en silencio.
    cancelada ? null : `Entrar a la sala: ${salaUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lineas = [
    "BEGIN:VEVENT",
    crudo("UID", `${e.session_id}@${UID_DOMINIO}`),
    crudo("DTSTAMP", utc(new Date().toISOString())),
    crudo("DTSTART", utc(e.start_at)),
    crudo("DTEND", utc(e.end_at)),
    crudo("CREATED", utc(e.created_at)),
    crudo("LAST-MODIFIED", utc(e.updated_at)),
    // Sin un `SEQUENCE` que suba, el cliente que ya tiene el evento se queda
    // con la versión vieja aunque el feed traiga otra: es la mitad que hace que
    // «suscripción» signifique algo frente a «descarga».
    crudo("SEQUENCE", String(e.secuencia)),
    campo("SUMMARY", resumen),
    campo("DESCRIPTION", descripcion),
    // `TENTATIVE` = pagada y esperando a que el tutor la acepte. `CANCELLED` se
    // publica en vez de quitar el evento del feed: un cliente que no hace
    // reemplazo total se quedaría la clase cancelada en el calendario para
    // siempre, que es exactamente el fallo que esta ficha viene a evitar.
    crudo(
      "STATUS",
      cancelada
        ? "CANCELLED"
        : e.estado === "tentativa"
          ? "TENTATIVE"
          : "CONFIRMED",
    ),
    // Una clase cancelada no debe seguir marcando al usuario como ocupado.
    crudo("TRANSP", cancelada ? "TRANSPARENT" : "OPAQUE"),
  ];

  if (!cancelada) {
    lineas.push(campo("LOCATION", salaUrl), crudo("URL", salaUrl));
  }

  lineas.push("END:VEVENT");
  return lineas;
}

/**
 * Arma el .ics completo.
 *
 * `origin` sale de la propia petición (mismo criterio que el cron de correo):
 * el feed lo pide el servidor de Google con la URL que el usuario pegó, así que
 * los enlaces de dentro apuntan solos al despliegue correcto y no hay una
 * variable más que mantener. El `UID` es la excepción, y va con dominio fijo.
 *
 * ⚠️ `REFRESH-INTERVAL` y `X-PUBLISHED-TTL` son PISTAS, no un contrato. Cada
 * cuánto relee un calendario suscrito lo decide el cliente —Google y Apple
 * tienen su propia cadencia y la cambian sin avisar—, así que esto no se puede
 * prometer como «sincronización en tiempo real».
 */
export function construirIcs({
  eventos,
  timezone,
  origin,
}: {
  eventos: EventoFeed[];
  timezone: string;
  origin: string;
}): string {
  const nombre = "Enséñame Ya · Mis mentorías";
  const descripcion = "Tus clases reservadas en Enséñame Ya.";

  const lineas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    // PRODID en ASCII a propósito: es un identificador de producto, no texto
    // para leer, y hay clientes viejos que lo tratan como opaco.
    "PRODID:-//Ensename Ya//Feed de reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    // `NAME`/`DESCRIPTION` son del RFC 7986; las `X-WR-*` son las de facto que
    // Google y Apple entienden desde siempre. Se ponen las dos porque no hay
    // una sola que funcione en los dos sitios con seguridad.
    campo("NAME", nombre),
    campo("X-WR-CALNAME", nombre),
    campo("DESCRIPTION", descripcion),
    campo("X-WR-CALDESC", descripcion),
    campo("X-WR-TIMEZONE", timezone),
    crudo("REFRESH-INTERVAL;VALUE=DURATION", "PT1H"),
    crudo("X-PUBLISHED-TTL", "PT1H"),
  ];

  for (const e of eventos) lineas.push(...vevento(e, origin));

  lineas.push("END:VCALENDAR");

  // El archivo termina en CRLF: la última línea también es una línea.
  return lineas.join(CRLF) + CRLF;
}
