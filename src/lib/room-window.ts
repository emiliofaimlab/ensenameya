import "server-only";

/**
 * MN-05 · La ventana de acceso a la sala, en UN solo sitio del cliente.
 *
 * ⚠️ La fuente de verdad NO es este fichero: es `session_access_window()` en la
 * base de datos, y las columnas `sessions.access_opens_at` / `access_closes_at`
 * que puebla el trigger. Esto es el RESPALDO para las filas que nacieron antes
 * de MN-05 y no tienen esas columnas, y el criterio con el que las pantallas
 * deciden si ofrecer el botón «Entrar a la sala».
 *
 * Existe porque el número estaba copiado en cuatro sitios y las migraciones
 * afirmaban lo contrario. Si el cliente cambia los 7 días hay que tocar DOS
 * cosas —la función SQL y esta constante— y ningún sitio más; y mientras no
 * coincidan, la pantalla ofrece un botón que el servidor rechaza.
 */
export const ACCESS_WINDOW_DAYS = 7;

const ACCESS_WINDOW_MS = ACCESS_WINDOW_DAYS * 86_400_000;

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
    : new Date(s.start_at).getTime() - ACCESS_WINDOW_MS;
  const closes = s.access_closes_at
    ? new Date(s.access_closes_at).getTime()
    : new Date(s.end_at).getTime() + ACCESS_WINDOW_MS;
  return now >= opens && now <= closes;
}

/** `start_at`/`end_at` desplazados N días, para el respaldo de las filas viejas. */
export function withDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}
