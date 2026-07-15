"use client";

import { useMemo } from "react";

// Mismas clases que <Input> para que el <select> nativo calce con el resto.
const FIELD_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

/** Zonas IANA nativas del runtime (RN-01), sin librería de timezones. */
export function TimezoneSelect({
  name = "timezone",
  defaultValue,
}: {
  name?: string;
  defaultValue?: string;
}) {
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  return (
    <select
      id={name}
      name={name}
      defaultValue={defaultValue}
      className={FIELD_CLASS}
    >
      {timezones.map((tz) => (
        <option key={tz} value={tz}>
          {tz}
        </option>
      ))}
    </select>
  );
}
