"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Armazón del asistente de onboarding (AL01 / TU01). El Figma reparte la
 * columna de 600 px en cuatro bloques separados por 24 px: progreso, título,
 * tarjeta (SOLO los campos) y botonera. La tarjeta no envuelve la pantalla.
 *
 * "Guardar y salir" vive en el header (`SiteHeader onboarding`), no aquí.
 *
 * ponytail: el paso vive en el componente de cada asistente, no en la URL. El
 * borrador se guarda al avanzar, así que recargar no pierde datos y no hacía
 * falta cablear historial ni query params.
 */

/** Alto y forma de los controles del asistente: 45 px, r8 (AL01 180:1297). */
export const FIELD_CLASS =
  "h-[45px] rounded-[8px] px-3.5 text-sm placeholder:text-[#8c8c8c]";

/** Botonera: 45 px de alto y 22 de padding → 116×45 "Continuar", 82×45 "Atrás". */
const BUTTON_CLASS = "h-[45px] rounded-[8px] px-[22px] text-sm";

export function WizardShell({
  step,
  total,
  title,
  description,
  children,
  onBack,
  onNext,
  nextLabel = "Continuar",
  nextDisabled,
  busy,
  bare = false,
  maxWidth = 600,
}: {
  step: number;
  total: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  /** El contenido trae sus propias tarjetas (p. ej. el módulo de verificación):
   *  sin la tarjeta blanca del asistente para no anidar. */
  bare?: boolean;
  /** Ancho de la columna; algunos pasos (verificación) piden más aire. */
  maxWidth?: number;
}) {
  return (
    <div
      className="mx-auto flex w-full flex-col gap-6"
      style={{ maxWidth }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs text-[#6b6b6b]">
          Paso {step} de {total}
        </p>

        {/* Progreso: `progressbar` para que un lector de pantalla lo anuncie. */}
        <div
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Paso ${step} de ${total}`}
          className="flex gap-1.5"
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i < step ? "bg-brand" : "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] leading-[1.5] font-bold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="text-[13px] text-[#6b6b6b]">{description}</p>
        ) : null}
      </div>

      {bare ? (
        <div className="flex flex-col gap-5">{children}</div>
      ) : (
        <div className="rounded-[16px] border border-[#e6e6e6] bg-card p-7">
          <div className="flex flex-col gap-5">{children}</div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {onBack ? (
          <Button
            variant="outline"
            onClick={onBack}
            disabled={busy}
            className={cn(BUTTON_CLASS, "text-[#4d4d4d]")}
          >
            Atrás
          </Button>
        ) : (
          <span />
        )}
        <Button
          onClick={onNext}
          disabled={nextDisabled || busy}
          className={cn(BUTTON_CLASS, "font-semibold")}
        >
          {busy ? "Guardando…" : nextLabel}
        </Button>
      </div>
    </div>
  );
}

/** Campo del asistente: etiqueta 12.5/400 gris + control, con 6 px de aire. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-[12.5px] font-normal text-[#6b6b6b]"
      >
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-[#6b6b6b]">{hint}</p> : null}
    </div>
  );
}

/** Chips de selección múltiple (categorías / intereses). */
export function ChipGroup({
  options,
  selected,
  onToggle,
  ariaLabel,
}: {
  options: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = selected.has(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.id)}
            className={cn(
              "inline-flex h-[38px] items-center rounded-full border px-4 text-[13px] transition-colors",
              on
                ? "border-brand bg-brand font-semibold text-white"
                : "bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
