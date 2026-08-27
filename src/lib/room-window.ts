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
 * Se pregunta por la ventana de acceso, no por el estado: `completed` y
 * `no_show` son contabilidad —la clase venció y con ella arrancó el reloj del
 * cobro del tutor—, no una puerta cerrada. La única sesión sin sala es la
 * `cancelled`. Y se mira la ventana además del estado para no ofrecer un botón
 * que el servidor va a rechazar con «fuera de la ventana de acceso».
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
  if (s.status === "cancelled") return false;
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
