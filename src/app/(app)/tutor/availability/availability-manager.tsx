"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
]; // 0=domingo (Doc 1 §1.4.8)

/** Orden de lectura del Figma (194:48): Lunes…Domingo. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type Rule = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

const selectClasses =
  "h-[45px] w-full rounded-[8px] border border-input bg-transparent px-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

/**
 * US-501 (SCR-TU05) — reglas semanales agrupadas por día, como el Figma
 * (194:48): una fila por día con sus franjas como chips. El chip lleva su ✕
 * (el "Editar" del Figma en nuestro CRUD es quitar y volver a añadir).
 */
export function AvailabilityManager({
  userId,
  rules,
}: {
  userId: string;
  rules: Rule[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [weekday, setWeekday] = useState("1"); // Lunes por defecto
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");

  async function addRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (end <= start) return toast.error("La hora de fin debe ser mayor a la de inicio.");

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert({
      tutor_id: userId,
      weekday: Number(weekday),
      start_time: start,
      end_time: end,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "No se pudo guardar el horario.");
    toast.success("Franja agregada.");
    router.refresh();
  }

  async function removeRule(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error("No se pudo eliminar.");
    router.refresh();
  }

  const byDay = new Map<number, Rule[]>();
  for (const r of rules) {
    const list = byDay.get(r.weekday);
    if (list) list.push(r);
    else byDay.set(r.weekday, [r]);
  }

  return (
    <div className="flex flex-col">
      <div className="divide-y divide-[#e0e0e0]">
        {DISPLAY_ORDER.map((day) => {
          const list = byDay.get(day) ?? [];
          return (
            <div
              key={day}
              className="flex flex-wrap items-center gap-2.5 py-2.5 first:pt-0"
            >
              <span className="w-20 text-sm font-medium text-[#404040]">
                {WEEKDAYS[day]}
              </span>
              {list.length === 0 ? (
                <span className="text-xs text-[#6b6b6b]">Sin disponibilidad</span>
              ) : (
                list.map((r) => (
                  <span
                    key={r.id}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-muted px-2.5 text-xs font-medium ${
                      r.is_active ? "text-[#4d4d4d]" : "text-[#9c9c9c] line-through"
                    }`}
                  >
                    {hhmm(r.start_time)}–{hhmm(r.end_time)}
                    <button
                      type="button"
                      aria-label={`Quitar ${WEEKDAYS[r.weekday]} ${hhmm(r.start_time)}`}
                      disabled={busy}
                      onClick={() => removeRule(r.id)}
                      className="text-[#8c8c8c] transition-colors hover:text-destructive"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* "+ Añadir franja" (194:105): el alta, plegada en un details nativo. */}
      <details className="group mt-3">
        <summary className="inline-flex h-[34px] cursor-pointer list-none items-center rounded-[8px] border border-[#e0e0e0] px-3 text-[13px] text-[#595959] transition-colors group-open:hidden hover:border-brand hover:text-brand marker:hidden">
          + Añadir franja
        </summary>
        <form
          onSubmit={addRule}
          className="grid gap-3 rounded-[12px] border border-[#e0e0e0] p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="weekday" className="text-xs font-normal text-[#6b6b6b]">
              Día
            </Label>
            <select
              id="weekday"
              className={selectClasses}
              value={weekday}
              onChange={(e) => setWeekday(e.target.value)}
            >
              {DISPLAY_ORDER.map((i) => (
                <option key={i} value={i}>
                  {WEEKDAYS[i]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="start" className="text-xs font-normal text-[#6b6b6b]">
              Desde
            </Label>
            <Input
              id="start"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
              className="h-[45px] rounded-[8px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="end" className="text-xs font-normal text-[#6b6b6b]">
              Hasta
            </Label>
            <Input
              id="end"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
              className="h-[45px] rounded-[8px]"
            />
          </div>
          <Button type="submit" disabled={busy} className="h-[45px] rounded-[8px]">
            Agregar
          </Button>
        </form>
      </details>
    </div>
  );
}
