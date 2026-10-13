/**
 * EY-220 · ¿se puede reseñar ya esta reserva?
 *
 * ⚠️ ESPEJO de la guarda de `submit_review` (`20261013130000`). La que manda es
 * la de la base; esta solo decide qué se ENSEÑA (el pop-up al colgar, la
 * tarjeta «Tu reseña» y `/reservas/[id]/resena`). Si se cambia una, la otra.
 *
 * - `completed` → sí (RN-17, lo de siempre).
 * - `in_progress` → sí si la ÚLTIMA clase ya está en su tramo final: ninguna
 *   sesión `scheduled` (en un paquete, la siguiente lo está → no hasta la
 *   última), ninguna `in_progress` a más de 10 min de su fin, y al menos una
 *   se llegó a dar. Existe porque `close_expired_sessions()` cierra la reserva
 *   a fin + 10 min por pg_cron, y el alumno cuelga antes.
 */
export const RESENA_MIN_ANTES_DEL_FIN = 10;

export function reservaResenable(
  bookingStatus: string,
  sessions: ReadonlyArray<{ status: string; end_at: string }>,
  now: number = Date.now(),
): boolean {
  if (bookingStatus === "completed") return true;
  if (bookingStatus !== "in_progress") return false;
  const margen = RESENA_MIN_ANTES_DEL_FIN * 60_000;
  const abierta = sessions.some(
    (s) =>
      s.status === "scheduled" ||
      (s.status === "in_progress" && now < Date.parse(s.end_at) - margen),
  );
  const dada = sessions.some(
    (s) => s.status === "in_progress" || s.status === "completed",
  );
  return !abierta && dada;
}
