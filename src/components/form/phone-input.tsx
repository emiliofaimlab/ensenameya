"use client";

import BasePhoneInput, {
  getCountries,
  type Country,
} from "react-phone-number-input";
import es from "react-phone-number-input/locale/es.json";

import { cn } from "@/lib/utils";

/** Zona IANA → país, construido una vez y solo si alguien pregunta. */
let zoneToCountry: Map<string, Country> | null = null;

/**
 * País al que pertenece una zona horaria (`Pacific/Wallis` → `WF`), para que el
 * prefijo del teléfono siga a la zona que elige el usuario.
 *
 * Lo sabe el propio runtime (`Intl.Locale#getTimeZones`), así que no entra una
 * tabla ni una librería: se invierte el mapa país→zonas de los ~245 países que
 * conoce el selector. Devuelve `undefined` en las zonas que no son de ningún
 * país (`UTC`) o en runtimes sin esa API.
 */
export function countryFromTimezone(tz: string): Country | undefined {
  if (!zoneToCountry) {
    zoneToCountry = new Map();
    for (const c of getCountries()) {
      // `getTimeZones` aún no está en los tipos de TS (sí en los navegadores).
      const locale = new Intl.Locale(`und-${c}`) as Intl.Locale & {
        getTimeZones?: () => string[];
      };
      for (const z of locale.getTimeZones?.() ?? []) zoneToCountry.set(z, c);
    }
  }
  return zoneToCountry.get(tz);
}

/**
 * Teléfono con bandera y formato por país (AL01 p3). Se apoya en
 * `react-phone-number-input` porque su valor de salida ya es **E.164 puro**
 * (`+584121234567`), que es exactamente lo que exige RN-44 y lo que valida el
 * asistente — sin limpiar espacios ni guiones a mano.
 *
 * El desplegable es el `<select>` nativo del sistema (la librería lo superpone
 * invisible sobre la bandera), así que funciona en móvil y con teclado sin que
 * tengamos que cablear nada.
 *
 * ponytail: país por defecto fijo a Venezuela, el mercado que asume el resto
 * del proyecto. Cuando se cierre C-13 (mercados) se lee de ahí; deducirlo del
 * navegador daría desajustes de hidratación por un valor que el usuario cambia
 * en un clic.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  defaultCountry = "VE",
  className,
  placeholder = "412 123 4567",
}: {
  id?: string;
  /** E.164 (`+58…`) o cadena vacía. */
  value: string;
  onChange: (value: string) => void;
  /**
   * País del prefijo al montar. La librería no admite país controlado, así que
   * para cambiarlo después hay que remontar (`key`) — ver los asistentes.
   */
  defaultCountry?: Country;
  className?: string;
  placeholder?: string;
}) {
  return (
    <BasePhoneInput
      id={id}
      international
      defaultCountry={defaultCountry}
      labels={es}
      value={value || undefined}
      // Devuelve `undefined` cuando se vacía el campo.
      onChange={(v) => onChange(v ?? "")}
      countrySelectProps={{ "aria-label": "País" }}
      numberInputProps={{
        autoComplete: "tel",
        placeholder,
        className:
          "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8c8c8c]",
      }}
      className={cn(
        "flex h-[45px] items-center rounded-[8px] border border-input px-3.5 text-sm transition-colors",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        // La bandera es 1em por defecto: se sube para que no quede diminuta
        // dentro de un campo de 45 px.
        "[--PhoneInputCountryFlag-height:1.15em] [--PhoneInputCountrySelect-marginRight:0.6em]",
        className,
      )}
    />
  );
}
