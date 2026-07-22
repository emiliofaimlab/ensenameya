"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Armazón del asistente de onboarding (AL01 / TU01). Estructura compartida:
 * cabecera con "Paso N de M" + "Guardar y salir", título, cuerpo y pie con
 * Atrás/Continuar.
 *
 * ponytail: el paso vive en el componente de cada asistente, no en la URL. El
 * borrador se guarda al avanzar, así que recargar no pierde datos y no hacía
 * falta cablear historial ni query params.
 */
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
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium text-muted-foreground">
          Paso {step} de {total}
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href="/app">Guardar y salir</Link>
        </Button>
      </div>

      {/* Progreso: `progressbar` para que un lector de pantalla lo anuncie. */}
      <div
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Paso ${step} de ${total}`}
        className="mt-3 flex gap-1.5"
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

      <div className="mt-8 rounded-2xl bg-card p-8">
        <h1 className="text-[26px] font-bold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}

        <div className="mt-6">{children}</div>

        <div className="mt-8 flex items-center justify-between gap-3">
          {onBack ? (
            <Button variant="outline" onClick={onBack} disabled={busy}>
              Atrás
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onNext} disabled={nextDisabled || busy}>
            {busy ? "Guardando…" : nextLabel}
          </Button>
        </div>
      </div>
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
              "rounded-full border px-4 py-2 text-sm transition-colors",
              on
                ? "border-brand bg-brand font-medium text-white"
                : "hover:border-brand hover:text-brand",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
