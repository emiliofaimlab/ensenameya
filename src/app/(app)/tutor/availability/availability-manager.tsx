"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

/**
 * US-501 (SCR-TU05) — reglas semanales agrupadas por día, como el Figma
 * (194:48): una fila por día con sus franjas como chips (cada chip con su ✕).
 * El alta vive **junto a cada día** (24-jul): un "+ Añadir" por fila abre un
 * mini-formulario de horas ahí mismo, con el día ya fijado (sin selector).
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

  async function addRule(weekday: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const start = String(data.get("start") ?? "");
    const end = String(data.get("end") ?? "");
    if (!start || !end || end <= start) {
      return toast.error("La hora de fin debe ser mayor a la de inicio.");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert({
      tutor_id: userId,
      weekday,
      start_time: start,
      end_time: end,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "No se pudo guardar el horario.");
    toast.success("Franja agregada.");
    form.reset();
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
    <div className="divide-y divide-[#e0e0e0]">
      {DISPLAY_ORDER.map((day) => {
        const list = byDay.get(day) ?? [];
        return (
          <div key={day} className="py-2.5 first:pt-0">
            <div className="flex flex-wrap items-center gap-2.5">
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

              {/* "+ Añadir" de ESTE día: el día ya está fijado por la fila. */}
              <details className="group/add ml-auto">
                <summary
                  aria-label={`Añadir franja el ${WEEKDAYS[day]}`}
                  className="inline-flex h-7 cursor-pointer list-none items-center gap-1 rounded-[6px] border border-[#e0e0e0] px-2 text-xs font-medium text-[#595959] transition-colors marker:hidden hover:border-brand hover:text-brand group-open/add:border-brand group-open/add:text-brand"
                >
                  <PlusIcon className="size-3" />
                  Añadir
                </summary>
                <form
                  onSubmit={(e) => addRule(day, e)}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input
                    name="start"
                    type="time"
                    defaultValue="09:00"
                    required
                    aria-label="Desde"
                    className="h-9 rounded-[8px] border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
                  />
                  <span className="text-sm text-[#6b6b6b]">–</span>
                  <input
                    name="end"
                    type="time"
                    defaultValue="10:00"
                    required
                    aria-label="Hasta"
                    className="h-9 rounded-[8px] border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
                  />
                  <Button
                    type="submit"
                    disabled={busy}
                    className="h-9 rounded-[8px] px-4 text-[13px]"
                  >
                    Agregar
                  </Button>
                </form>
              </details>
            </div>
          </div>
        );
      })}
    </div>
  );
}
