/**
 * "Cuánto lleva esperando esto" para las colas del panel de operaciones
 * (RV-04b y la de reembolsos). En una cola el dato que duele no es la fecha
 * sino la antigüedad: "26 de julio" no dice nada, "lleva 22 días" sí.
 *
 * Se calcula en el servidor, en el render, y por eso NO se usa en componentes
 * cliente: ahí el reloj del navegador daría un texto distinto al del HTML y
 * React cantaría un error de hidratación. Las pantallas que lo usan enseñan
 * además la fecha absoluta en la zona del usuario (regla de oro 4), que es la
 * que sirve para conciliar; esto es el titular.
 */
export function esperaDesde(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return "—";
  const ms = ahora.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  // Futuro (relojes desincronizados, sembrado de pruebas): no se inventa nada.
  if (ms < 0) return "recién";

  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} min`;

  const horas = Math.floor(min / 60);
  if (horas < 48) return `hace ${horas} h`;

  return `hace ${Math.floor(horas / 24)} días`;
}
