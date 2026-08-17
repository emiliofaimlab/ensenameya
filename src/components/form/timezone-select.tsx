"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { SearchableSelect } from "./searchable-select";

// Mismas clases que <Input> para que el campo calce con el resto.
const FIELD_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors md:text-sm dark:bg-input/30";

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

/**
 * Zonas IANA nativas del runtime (RN-01), sin librería de timezones.
 *
 * M-09 · Con buscador. Eran ~420 opciones en un `<select>` nativo y no había
 * forma de llegar a la tuya salvo bajando a mano: como la etiqueta empieza por
 * el offset, teclear "caracas" sobre el `<select>` no saltaba a ninguna parte.
 * Ahora se busca por ciudad, por región (`America/…`, que va en el texto
 * oculto) o por offset, y sin tildes.
 *
 * ⚠️ La API pública NO cambia —la consumen `/account` y los DOS asistentes de
 * onboarding, que son de otra mano—: mismos props, y en modo no controlado el
 * valor sigue viajando en el submit con el `name` de siempre (ahora por un
 * input oculto, porque el campo visible ya no es un `<select>`).
 */
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
      .sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
      .map((z) => ({
        value: z.tz,
        label: z.label,
        // El nombre IANA completo entra en la búsqueda pero no se pinta: así
        // "america", "europe" o "argentina/buenos" también encuentran.
        search: z.tz.replace(/[/_]/g, " "),
      }));
  }, []);

  // Modo no controlado: el valor vive aquí. Antes lo guardaba el propio
  // `<select>`; ahora hay que llevarlo a mano para que `defaultValue` siga
  // significando lo mismo para quien ya lo usaba.
  const [interno, setInterno] = useState(defaultValue ?? "");
  const controlado = value !== undefined;
  const actual = controlado ? value : interno;

  return (
    <SearchableSelect
      id={name}
      name={name}
      value={actual}
      options={timezones}
      onChange={(tz) => {
        if (!controlado) setInterno(tz);
        onChange?.(tz);
      }}
      ariaLabel="Zona horaria"
      placeholder="Elige tu zona horaria"
      searchPlaceholder="Busca tu ciudad o país"
      emptyLabel="Ninguna zona coincide"
      triggerClassName={cn(FIELD_CLASS, className)}
    />
  );
}
