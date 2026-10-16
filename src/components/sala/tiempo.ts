/**
 * El reloj de la sala, PURO: lo comparten el contador de la barra y el de la
 * ventana flotante (así los dos no pueden discrepar) y lo vigila
 * `npm run check:sala`.
 */

/** A cuántos minutos del final se avisa y el contador cambia de color. */
export const AVISO_MIN_ANTES_DEL_FIN = 5;

/** Los minutos que el tutor puede añadir (`extend_session`, una vez). */
export const MINUTOS_EXTENSION = [5, 10, 20] as const;

/** ms → "12:34" (o "1:02:03" si pasa de una hora). */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${ss}`
    : `${String(m).padStart(2, "0")}:${ss}`;
}

/**
 * · `antes`   — aún no empieza.
 * · `normal`  — en clase.
 * · `aviso`   — quedan 5 min o menos.
 * · `extendida` — el tutor extendió y aún no se cumple el nuevo fin (manda
 *               sobre `aviso`: el ámbar dice «se acaba», y se acaba de alargar).
 * · `extra`   — se cumplió la hora: corren los 10 min de gracia hasta que la
 *               sala se cierra (`access_closes_at`) y Daily echa a todos.
 * · `cerrada` — pasó el cierre.
 */
export type FaseContador = "antes" | "normal" | "aviso" | "extendida" | "extra" | "cerrada";

export function estadoContador(
  now: number,
  startAt: string,
  endAt: string,
  closesAt: string,
  extendida = false,
) {
  const inicio = Date.parse(startAt);
  const fin = Date.parse(endAt);
  const cierre = Date.parse(closesAt);
  // El transcurrido sigue contando en el tiempo extra: es «lo que lleva la
  // clase», no un porcentaje de la reserva.
  const transcurrido = Math.max(0, now - inicio);
  const restante = fin - now;
  const hastaCierre = cierre - now;
  const fase: FaseContador =
    now < inicio
      ? "antes"
      : now >= cierre
        ? "cerrada"
        : restante <= 0
          ? "extra"
          : extendida
            ? "extendida"
            : restante <= AVISO_MIN_ANTES_DEL_FIN * 60_000
            ? "aviso"
            : "normal";
  return { inicio, total: fin - inicio, transcurrido, restante, hastaCierre, fase };
}

/** ¿Se ofrece extender? Desde el aviso hasta el cierre, como la RPC. */
export function puedeExtender(fase: FaseContador): boolean {
  return fase === "aviso" || fase === "extra";
}
