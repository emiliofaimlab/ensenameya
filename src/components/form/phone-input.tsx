"use client";

import type { ComponentType } from "react";
import BasePhoneInput, {
  getCountries,
  getCountryCallingCode,
  type Country,
} from "react-phone-number-input";
import es from "react-phone-number-input/locale/es.json";

import { cn } from "@/lib/utils";
import { SearchableSelect, type SearchableOption } from "./searchable-select";

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

/** Bandera emoji desde el ISO ("VE" → 🇻🇪): letras indicadoras regionales. */
function flagEmoji(country: string): string {
  return String.fromCodePoint(
    ...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Props que `react-phone-number-input` inyecta en `countrySelectComponent`. */
type CountrySelectProps = {
  name?: string;
  value?: Country;
  onChange: (value?: Country) => void;
  options: { value?: Country; label: string; divider?: boolean }[];
  iconComponent: ComponentType<{ country?: Country; label: string }>;
  disabled?: boolean;
  readOnly?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  "aria-label"?: string;
};

/**
 * M-09 · El selector de país, con buscador.
 *
 * El desplegable ya no es el `<select>` nativo que la librería superpone sobre
 * la bandera: eran ~245 países que había que recorrer a mano. Ahora se escribe
 * "venez", "+58" o "VE".
 *
 * ⚠️ Las filas llevan bandera EMOJI, no la de la librería. Sus banderas son
 * `<img>` remotos (`purecatamphetamine.github.io/country-flag-icons`), así que
 * pintar la lista entera dispararía ~245 peticiones a un host externo cada vez
 * que se abre. En el disparador sí va la de la librería —es una sola imagen y
 * mantiene el aspecto de siempre—.
 */
function CountrySelect({
  name,
  value,
  onChange,
  options,
  iconComponent: Icon,
  disabled,
  readOnly,
  onFocus,
  onBlur,
  "aria-label": ariaLabel,
}: CountrySelectProps) {
  const opciones: SearchableOption[] = options
    .filter((o) => !o.divider)
    .map((o) => ({
      // "" es la opción "Internacional" (la librería la representa con
      // `undefined`, que no vale como valor de una lista).
      value: o.value ?? "",
      label: o.label,
      hint: o.value ? `+${getCountryCallingCode(o.value)}` : undefined,
      // El código ISO también busca: quien escribe "VE" sabe lo que quiere.
      search: o.value,
      icon: o.value ? flagEmoji(o.value) : "🌐",
    }));

  const etiqueta = options.find((o) => o.value === value)?.label ?? "";

  return (
    <SearchableSelect
      name={name}
      value={value ?? ""}
      options={opciones}
      onChange={(v) => onChange((v || undefined) as Country | undefined)}
      ariaLabel={ariaLabel ?? "País"}
      searchPlaceholder="Busca tu país o prefijo"
      emptyLabel="Ningún país coincide"
      disabled={disabled || readOnly}
      // ⚠️ El foco NO vuelve aquí: al cambiar de país la librería lo manda al
      // número (`focusInputOnCountrySelection`), que es lo que quiere quien
      // acaba de elegir el prefijo. Devolverlo al disparador se lo robaría.
      focusTriggerOnSelect={false}
      onFocus={onFocus}
      onBlur={onBlur}
      className="w-auto shrink-0"
      triggerClassName="w-auto"
      triggerContent={<Icon country={value} label={etiqueta} />}
    />
  );
}

/**
 * Teléfono con bandera y formato por país (AL01 p3). Se apoya en
 * `react-phone-number-input` porque su valor de salida ya es **E.164 puro**
 * (`+584121234567`), que es exactamente lo que exige RN-44 y lo que valida el
 * asistente — sin limpiar espacios ni guiones a mano.
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
   *
   * ⚠️ Elegir país en el buscador NO toca este prop: lo cambia el estado
   * interno de la librería, igual que hacía su `<select>`. El contrato del
   * `key` sigue siendo el de siempre y no se pierde ningún número tecleado.
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
      countrySelectComponent={CountrySelect}
      countrySelectProps={{ "aria-label": "País" }}
      numberInputProps={{
        autoComplete: "tel",
        placeholder,
        className:
          "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8c8c8c]",
      }}
      className={cn(
        "flex h-[45px] items-center gap-2 rounded-[8px] border border-input px-3.5 text-sm transition-colors",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        // La bandera es 1em por defecto: se sube para que no quede diminuta
        // dentro de un campo de 45 px. El hueco entre bandera y número lo pone
        // ahora el `gap` del contenedor, no la variable de la librería: su
        // margen colgaba del `<select>` nativo, que ya no está.
        "[--PhoneInputCountryFlag-height:1.15em]",
        className,
      )}
    />
  );
}
