import "server-only";

/**
 * Las dos ventanas de una sesión, en UN solo sitio del cliente.
 *
 * ⚠️ La fuente de verdad NO es este fichero: son `session_access_window()` y
 * `session_live_window()` en la base, y las columnas
 * `sessions.access_opens_at` / `access_closes_at` que puebla el trigger. Esto
 * es el RESPALDO para las filas que nacieran sin esas columnas, y el criterio
 * con el que las pantallas deciden qué botón ofrecer.
 *
 * ── B-2 · SON DOS, Y CONFUNDIRLAS CUESTA DINERO ─────────────────────────────
 * Hoy las dos valen 10 minutos y da la tentación de dejar una sola constante.
 * No son la misma cosa:
 *
 *   · **ACCESO** (`ACCESS_WINDOW_MIN`) — ¿la sala deja entrar? Es lo que el
 *     cliente ha movido dos veces en una semana: 10 min → 7 días (MN-05, P-6)
 *     → 10 min otra vez (B-2, V-1). Es una decisión de producto y volverá a
 *     moverse.
 *   · **CLASE** (`LIVE_WINDOW_MIN`) — ¿esto es la mentoría? De aquí cuelga
 *     `bookings.completed_at`, y de él el plazo de pago al tutor (§12 del
 *     contrato). El cliente dijo que NO a cobrar más tarde, así que este número
 *     no se mueve por peticiones de UI.
 *
 * Que hoy coincidan es coincidencia. Fundirlas en una constante es exactamente
 * el accidente histórico que MN-05 tuvo que deshacer.
 */
export const ACCESS_WINDOW_MIN = 10;

/** El de `session_live_window()`. Ver arriba por qué NO es el mismo número. */
export const LIVE_WINDOW_MIN = 10;

const MIN_MS = 60_000;

/** Los campos que hacen falta para decidir; cualquier fila de `sessions` los trae. */
export type VentanaDeSala = {
  status: string;
  start_at: string;
  end_at: string;
  access_opens_at: string | null;
  access_closes_at: string | null;
};

/**
 * ¿Esta sesión tiene sala AHORA MISMO?
 *
 * Ventana de acceso **y** sesión no cerrada. Se mira la ventana para no ofrecer
 * un botón que el servidor va a rechazar con «fuera de la ventana de acceso», y
 * el estado por lo mismo: desde `20260828120000` `join_session` rechaza también
 * `completed` y `no_show`.
 *
 * ⚠️ AQUÍ DECÍA QUE LA ÚNICA SESIÓN SIN SALA ERA LA `cancelled`, y era verdad
 * mientras la sala vivió 7 días (MN-05): entonces `completed` solo significaba
 * «el cron cerró el reloj del cobro», no «la puerta está cerrada». Con la
 * ventana de B-2 (10 min) el cierre del cron cae justo cuando la ventana
 * expira, así que el único cierre que ocurre con sala abierta es el anticipado
 * del tutor —«Marcar completada»— y el cliente pidió que ése bloquee el acceso,
 * no solo eche a la gente. La lista es la misma, palabra por palabra, que la
 * guarda de `join_session`: si divergen, el botón aparece y el server dice que
 * no.
 *
 * ⚠️ El respaldo va columna a columna y NUNCA armando un rango con los dos
 * nulos: `tstzrange(null, null, '[]')` es infinito y `@> now()` da `true`, o
 * sea que la versión «elegante» falla ABIERTA y daría acceso eterno.
 *
 * Vive a nivel de módulo y no dentro de un componente por la misma razón que
 * `isUpcoming` en `lib/booking.ts`: leer el reloj en una closure de render
 * dispara la regla de pureza de `react-hooks`.
 */
export function roomOpen(s: VentanaDeSala): boolean {
  if (s.status === "cancelled" || s.status === "completed" || s.status === "no_show")
    return false;
  const now = Date.now();
  const opens = s.access_opens_at
    ? new Date(s.access_opens_at).getTime()
    : new Date(s.start_at).getTime() - ACCESS_WINDOW_MIN * MIN_MS;
  const closes = s.access_closes_at
    ? new Date(s.access_closes_at).getTime()
    : new Date(s.end_at).getTime() + ACCESS_WINDOW_MIN * MIN_MS;
  return now >= opens && now <= closes;
}

/**
 * Estados de la RESERVA que pueden tener sala abierta desde una LISTA.
 *
 * ⚠️ No es la misma lista que la de los DETALLES (`ROOM_BOOKING` en
 * `reservas/[id]`, `LIVE` en `tutor/reservas/[id]`), que además incluyen
 * `completed`. La diferencia es a propósito y no un descuido: allí se pinta una
 * sesión concreta y `completed` entra para que el botón no parpadee en el
 * último minuto según qué pasada del cron llegue antes. Aquí se pinta la
 * RESERVA, y una reserva completada en medio de una lista no es un sitio al que
 * ofrecer «Entrar a sala». Es el criterio que ya usaba el panel del alumno
 * (`(app)/app/page.tsx`), copiado tal cual — que es de donde salió esto.
 */
const RESERVA_CON_SALA = new Set<string>(["confirmed", "in_progress"]);

/**
 * La sesión de esta reserva cuya sala está abierta AHORA, o `null`.
 *
 * El criterio es el del panel del alumno: estado de la reserva en
 * `confirmed`/`in_progress` **y** `roomOpen(sesion)`. Vive aquí porque desde
 * hoy lo preguntan las TRES listas de reservas —el panel, `/reservas` y
 * `/tutor/reservas`—, y tres copias de «hay sala» acabarían discrepando: ya
 * pasó con la ventana escrita en cinco sitios (ver la cabecera del fichero).
 *
 * Los dos detalles siguen llamando a `roomOpen` a pelo, y no es un olvido: ahí
 * el botón cuelga de CADA sesión de la reserva (no de la reserva entera) y su
 * lista de estados incluye `completed` — ver `RESERVA_CON_SALA`.
 *
 * Devuelve la SESIÓN y no un booleano porque quien lo llama necesita su `id`
 * para el enlace a `/room/<id>`; y busca en todas las de la reserva en vez de
 * en «la próxima», porque la que abre la sala es la que esté en su ventana, no
 * la que la lista haya elegido para enseñar la fecha.
 */
export function salaDeLaReserva<T extends VentanaDeSala & { id: string }>(
  bookingStatus: string,
  sesiones: readonly T[] | null | undefined,
): T | null {
  if (!RESERVA_CON_SALA.has(bookingStatus)) return null;
  return (sesiones ?? []).find((s) => roomOpen(s)) ?? null;
}

/**
 * ¿Estamos DENTRO de la clase? (`session_live_window` del lado del cliente.)
 *
 * ⚠️ B-2 · ESTO ES LO QUE DEBE GOBERNAR «MARCAR COMPLETADA», y no `roomOpen`.
 * Ese botón llama a `complete_session`, que fija `bookings.completed_at` — el
 * reloj del payout. Y `complete_session` **NO tiene guarda temporal**: acepta
 * cualquier sesión propia en `scheduled`/`in_progress`, incluida la del mes que
 * viene. O sea que el gate de la pantalla es hoy lo único que impide adelantar
 * el reloj del cobro.
 *
 * Atarlo a `roomOpen` era atarlo a un número que el cliente mueve cada semana:
 * con los 7 días de MN-05 el botón salía siete días antes de la clase, y al
 * volver a 10 min se encoge de golpe. Este cálculo NO depende de las columnas
 * de acceso — sale de `start_at`/`end_at`—, así que sobrevive al próximo cambio
 * de la ventana de la sala.
 */
export function classInProgress(s: {
  start_at: string;
  end_at: string;
}): boolean {
  const now = Date.now();
  return (
    now >= new Date(s.start_at).getTime() - LIVE_WINDOW_MIN * MIN_MS &&
    now <= new Date(s.end_at).getTime() + LIVE_WINDOW_MIN * MIN_MS
  );
}

/** `start_at`/`end_at` desplazados N minutos, para el respaldo de filas sin ventana. */
export function withMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MIN_MS).toISOString();
}
