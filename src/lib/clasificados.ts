/**
 * Clasificados · franjas horarias del alumno (`class_requests.slots`).
 *
 * Una franja es SEMANAL y vive en la zona del alumno (`class_requests.timezone`),
 * no en UTC: «los lunes de 18:00 a 21:00» no es un instante. Quien la pinta la
 * enseña con su zona; quien comprueba un horario lo pasa a esa zona.
 *
 * 🔴 `enFranjas` es una COPIA de `public.clasificado_admite`
 * (`20261124140000`…`20261125120000_clasificados.sql`). Solo sirve para ofrecer
 * horarios con sentido: quien decide es el SQL. Lo vigila `check:clasificados`.
 */

export type Franja = { dia: number; desde: string; hasta: string };

/** 0 = domingo, como `extract(dow …)` de PostgreSQL y `Date#getDay`. */
export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Lee `slots` de la BD sin fiarse de su forma. */
export function franjasDe(raw: unknown): Franja[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) =>
    f && typeof f === "object" && typeof (f as Franja).desde === "string"
      ? [{ dia: Number((f as Franja).dia), desde: (f as Franja).desde, hasta: (f as Franja).hasta }]
      : [],
  );
}

/** «Lun 18:00–21:00 · Mié 09:00–12:00», ordenado por día y hora. */
export function franjasLabel(franjas: Franja[]): string {
  // Sin repetidas: el formulario deja añadir dos veces la misma franja.
  return [
    ...new Set(
      [...franjas]
        .sort((a, b) => a.dia - b.dia || a.desde.localeCompare(b.desde))
        .map((f) => `${DIAS_CORTOS[f.dia] ?? "?"} ${f.desde}–${f.hasta}`),
    ),
  ].join(" · ");
}

/** «hora de Caracas» a partir de una zona IANA. */
export function zonaLabel(tz: string): string {
  const ciudad = tz.split("/").pop()?.replaceAll("_", " ");
  return ciudad && tz !== "UTC" ? `hora de ${ciudad}` : "hora UTC";
}

/** Día de la semana, hora y fecha de un instante en una zona. */
function enZona(iso: string, tz: string): { dia: number; hhmm: string; fecha: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
  return { dia, hhmm: `${p.hour}:${p.minute}`, fecha: `${p.year}-${p.month}-${p.day}` };
}

/**
 * ¿Una clase que empieza en `iso` y dura `durMin` cabe ENTERA en una franja?
 * Misma regla que el SQL: mismo día local, empieza ≥ desde, acaba ≤ hasta.
 */
export function enFranjas(iso: string, franjas: Franja[], tz: string, durMin: number): boolean {
  const ini = enZona(iso, tz);
  const fin = enZona(new Date(Date.parse(iso) + durMin * 60_000).toISOString(), tz);
  if (fin.fecha !== ini.fecha) return false;
  return franjas.some((f) => f.dia === ini.dia && ini.hhmm >= f.desde && fin.hhmm <= f.hasta);
}
