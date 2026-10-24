/**
 * Nombre legible de una zona horaria. Módulo puro, sin `server-only` ni
 * `use client`: lo usan pantallas de servidor y formularios de cliente.
 *
 * ⚠️ El ICU de Node y el del navegador pueden nombrar distinto la misma zona,
 * así que quien lo pinte en un componente que se hidrata lleva
 * `suppressHydrationWarning`.
 */

/** P4 · «hora de Perú (GMT−5)» en vez de `America/Lima`. El nombre y el offset salen de Intl, así que siguen al horario de verano sin tabla. */
export function zonaLegible(tz: string, ahora: Date = new Date()): string {
  try {
    const parte = (timeZoneName: "longGeneric" | "shortOffset") =>
      new Intl.DateTimeFormat("es", { timeZone: tz, timeZoneName })
        .formatToParts(ahora)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    let nombre = parte("longGeneric");
    // Sin nombre propio Intl devuelve el offset («GMT-5»): se cae a la ciudad.
    if (!nombre || nombre.startsWith("GMT"))
      nombre = `hora de ${tz.split("/").pop()!.replace(/_/g, " ")}`;
    const gmt = parte("shortOffset").replace("-", "−");
    return gmt ? `${nombre} (${gmt})` : nombre;
  } catch {
    return tz;
  }
}
