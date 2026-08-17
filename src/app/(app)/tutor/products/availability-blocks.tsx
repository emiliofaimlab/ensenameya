"use client";

import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** 0=domingo, igual que `availability_rules.weekday` (Doc 1 §1.4.8). */
const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

/** Orden de lectura del panel de disponibilidad (194:48): Lunes…Domingo. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

export type AvailabilityRule = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

/**
 * Los dos únicos estados que sabe representar la BD (N-04):
 *   · `all`    → CERO filas en `product_availability_rules` para este producto.
 *                La mentoría se ofrece en toda la disponibilidad del tutor.
 *   · `blocks` → una fila por franja elegida; solo esas generan horarios.
 * No hay una tercera opción, y por eso son dos botones y no un checkbox suelto:
 * «ninguna franja marcada» y «toda mi disponibilidad» son lo MISMO en la base
 * de datos, y dejar que se llegue ahí sin decirlo es cómo un tutor acaba
 * ofreciendo cálculo el lunes creyendo que lo había limitado al jueves.
 */
export type AvailabilityScope = "all" | "blocks";

/**
 * N-04 (SCR-TU04) — a qué bloques de disponibilidad pertenece esta mentoría.
 *
 * El orden que pidió el cliente es «primero la disponibilidad, luego la
 * oferta», así que este módulo no ofrece crear franjas: las lee. Si no hay
 * ninguna lo dice y manda al sitio donde se crean, que es la otra mitad del
 * mismo problema — una mentoría publicada sin un solo horario detrás no la
 * puede reservar nadie, y hoy eso no se avisa en ninguna parte.
 */
export function AvailabilityBlocks({
  rules,
  scope,
  onScopeChange,
  selected,
  onToggle,
  disabled,
}: {
  rules: AvailabilityRule[];
  scope: AvailabilityScope;
  onScopeChange: (scope: AvailabilityScope) => void;
  selected: Set<string>;
  onToggle: (ruleId: string) => void;
  disabled?: boolean;
}) {
  // Sin franjas no hay nada que elegir: el selector sobra y lo que hace falta
  // es el aviso. Ojo, se enseña SIEMPRE que no haya reglas, aunque la mentoría
  // sea un borrador: es justo antes de publicar cuando importa.
  if (rules.length === 0) {
    return (
      <div className="flex gap-3 rounded-[12px] border border-[#f5d9a8] bg-[#fdf4e3] p-4">
        <CalendarClockIcon className="mt-0.5 size-5 shrink-0 text-[#a67314]" />
        <div>
          <p className="text-sm font-semibold text-[#19191f]">
            Todavía no tienes disponibilidad
          </p>
          <p className="mt-1 text-[12.5px] text-[#6b5327]">
            Puedes guardar esta mentoría igualmente, pero mientras no tengas
            horarios nadie podrá reservarla: el calendario le saldrá vacío.
          </p>
          <Link
            href="/tutor/availability"
            className="mt-2 inline-block text-[13px] font-semibold text-brand underline underline-offset-2"
          >
            Configurar mi disponibilidad
          </Link>
        </div>
      </div>
    );
  }

  const byDay = new Map<number, AvailabilityRule[]>();
  for (const r of rules) {
    const list = byDay.get(r.weekday);
    if (list) list.push(r);
    else byDay.set(r.weekday, [r]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label="Horarios de esta mentoría"
      >
        {(
          [
            { id: "all", label: "Toda mi disponibilidad" },
            { id: "blocks", label: "Solo estas franjas" },
          ] as const
        ).map((opt) => {
          const on = scope === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onScopeChange(opt.id)}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
                on
                  ? "border-brand bg-brand font-semibold text-white"
                  : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {scope === "all" ? (
        <p className="text-[12.5px] text-[#6b6b6b]">
          Esta mentoría se ofrece en cualquiera de tus franjas, y las que añadas
          más adelante entran solas.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-[#6b6b6b]">
            Marca las franjas en las que das ESTA mentoría. Las demás quedan
            libres para tus otras ofertas.
          </p>
          <div className="flex flex-col divide-y divide-[#e0e0e0]">
            {DISPLAY_ORDER.filter((d) => byDay.has(d)).map((day) => (
              <div
                key={day}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0"
              >
                <span className="w-24 shrink-0 text-sm font-medium text-[#333333]">
                  {WEEKDAYS[day]}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {byDay.get(day)!.map((r) => {
                    const on = selected.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className={cn(
                          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
                          on
                            ? "border-brand bg-brand text-white"
                            : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                          disabled && "pointer-events-none opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          disabled={disabled}
                          onChange={() => onToggle(r.id)}
                        />
                        {hhmm(r.start_time)}–{hhmm(r.end_time)}
                        {/* Una franja pausada no genera horarios (la función de
                            slots exige `is_active`). Se lista igualmente para
                            no perder en silencio un enlace ya guardado al
                            reconciliar, pero se dice que no cuenta. */}
                        {!r.is_active ? (
                          <span
                            className={cn(
                              "text-[10px] uppercase",
                              on ? "text-white/80" : "text-[#9c9c9c]",
                            )}
                          >
                            pausada
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
