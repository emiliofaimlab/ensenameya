"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";

// Mismas clases que <Input> para que el <select> nativo calce con el resto.
const FIELD_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

/**
 * Etiqueta legible de una zona: `(GMT-05:00) Lima` en vez de `America/Lima`
 * (AL01 150:22). El offset sale del propio runtime, así que sigue siendo
 * correcto con el horario de verano y no hace falta tabla ni librería.
 */
function zoneLabel(tz: string, now: Date): { label: string; offset: number } {
  const name =
    new Intl.DateTimeFormat("es", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  const offset = m
    ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
    : 0;
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  // `longOffset` devuelve "GMT" pelado en UTC±0; se normaliza para que ordene
  // y se lea igual que el resto.
  return { label: `(${m ? name : "GMT+00:00"}) ${city}`, offset };
}

/** Zonas IANA nativas del runtime (RN-01), sin librería de timezones. */
export function TimezoneSelect({
  name = "timezone",
  defaultValue,
  value,
  onChange,
  className,
}: {
  name?: string;
  defaultValue?: string;
  /** Modo controlado (el asistente de onboarding lo necesita). */
  value?: string;
  onChange?: (tz: string) => void;
  className?: string;
}) {
  const timezones = useMemo(() => {
    const now = new Date();
    return Intl.supportedValuesOf("timeZone")
      .map((tz) => ({ tz, ...zoneLabel(tz, now) }))
      .sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label));
  }, []);

  return (
    <select
      id={name}
      name={name}
      {...(value !== undefined
        ? { value, onChange: (e) => onChange?.(e.target.value) }
        : { defaultValue })}
      className={cn(FIELD_CLASS, className)}
    >
      {timezones.map((z) => (
        <option key={z.tz} value={z.tz}>
          {z.label}
        </option>
      ))}
    </select>
  );
}
