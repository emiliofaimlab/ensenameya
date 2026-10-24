"use client";

import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type PasoId =
  | "tipo"
  | "formato"
  | "contenido"
  | "precio"
  | "extras"
  | "revisar";

/**
 * Indicador de pasos del asistente de mentoría.
 *
 * Dos formas a propósito: en móvil una lista de seis círculos con su nombre no
 * cabe en 375 px sin cortar palabras, así que ahí se dice «Paso 2 de 6» con una
 * barra; desde `sm` se pinta la lista entera, clicable.
 *
 * `libre` = edición: se salta a cualquier paso. En el alta solo se puede ir a
 * los pasos ya alcanzados (`alcanzado`), y quien decide si el salto hacia
 * delante es válido es el formulario (`onIr`), que valida lo de en medio.
 */
export function Stepper({
  pasos,
  actual,
  alcanzado,
  libre,
  onIr,
}: {
  pasos: { id: PasoId; corto: string }[];
  actual: number;
  alcanzado: number;
  libre: boolean;
  onIr: (id: PasoId) => void;
}) {
  const n = pasos.length;
  return (
    <nav aria-label="Pasos de la mentoría">
      <div className="grid gap-2 sm:hidden">
        <p className="flex items-baseline justify-between text-xs text-[#6b6b6b]">
          <span>
            Paso {actual + 1} de {n}
          </span>
          <span className="text-sm font-semibold text-[#19191f]">
            {pasos[actual]?.corto}
          </span>
        </p>
        <div
          role="progressbar"
          aria-label="Progreso"
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={actual + 1}
          className="h-1.5 overflow-hidden rounded-full bg-[#e0e0e0]"
        >
          {/* `scaleX` y no `width`: se anima con transform, sin recalcular layout. */}
          <div
            className="h-full origin-left rounded-full bg-brand motion-safe:transition-transform motion-safe:duration-300"
            style={{ transform: `scaleX(${(actual + 1) / n})` }}
          />
        </div>
      </div>

      <ol className="hidden items-center gap-2 sm:flex">
        {pasos.map((p, i) => {
          const esActual = i === actual;
          const habil = libre || i <= alcanzado;
          const hecho = !esActual && p.id !== "revisar" && (libre || i < actual);
          return (
            <li
              key={p.id}
              className="flex flex-1 items-center gap-2 last:flex-none"
            >
              <button
                type="button"
                disabled={!habil}
                aria-current={esActual ? "step" : undefined}
                onClick={() => onIr(p.id)}
                className={cn(
                  "group flex min-h-11 shrink-0 items-center gap-2 rounded-[8px] px-1.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  habil ? "cursor-pointer" : "cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full border-2 text-xs font-semibold transition-colors",
                    esActual
                      ? "border-brand bg-brand text-white"
                      : hecho
                        ? "border-brand bg-brand-muted text-brand"
                        : "border-[#e0e0e0] bg-card text-[#8c8c8c]",
                  )}
                >
                  {hecho ? (
                    <CheckIcon className="size-3.5" aria-hidden />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap",
                    esActual
                      ? "font-semibold text-[#19191f]"
                      : habil
                        ? "text-[#4d4d4d] group-hover:text-brand"
                        : "text-[#8c8c8c]",
                  )}
                >
                  {p.corto}
                  {hecho ? <span className="sr-only"> (completado)</span> : null}
                </span>
              </button>
              {i < n - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 min-w-3 flex-1 rounded-full",
                    i < actual || libre ? "bg-brand/40" : "bg-[#e0e0e0]",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
