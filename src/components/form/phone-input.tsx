"use client";

import BasePhoneInput from "react-phone-number-input";
import es from "react-phone-number-input/locale/es.json";

import { cn } from "@/lib/utils";

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
  className,
  placeholder = "412 123 4567",
}: {
  id?: string;
  /** E.164 (`+58…`) o cadena vacía. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <BasePhoneInput
      id={id}
      international
      defaultCountry="VE"
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
