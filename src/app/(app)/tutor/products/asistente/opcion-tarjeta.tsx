"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Una opción grande de las dos primeras preguntas del asistente (tipo y
 * formato). Es un `radio` dentro de un `radiogroup` que pone quien la usa:
 * tarjeta y no `<select>` porque la línea de explicación es lo que hace que el
 * tutor elija bien, y un desplegable no la enseña.
 */
export function OpcionTarjeta({
  icon: Icon,
  titulo,
  descripcion,
  selected,
  onSelect,
  disabled,
}: {
  icon: LucideIcon;
  titulo: string;
  descripcion: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-[12px] border-2 p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-brand bg-brand-muted/40"
          : "border-[#e0e0e0] bg-card",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:border-brand/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full",
          selected ? "bg-brand text-white" : "bg-brand-muted text-brand",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-[#19191f]">
          {titulo}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[#6b6b6b]">
          {descripcion}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2",
          selected ? "border-brand" : "border-[#c4c4c4]",
        )}
      >
        {selected ? <span className="size-2.5 rounded-full bg-brand" /> : null}
      </span>
    </button>
  );
}

/** Mensaje de error de un campo, debajo de él y anunciado al lector. */
export function ErrorCampo({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
      {msg}
    </p>
  );
}
