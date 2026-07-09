"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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

export type Rule = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

const selectClasses =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

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
    toast.success("Horario agregado.");
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

  async function toggleRule(id: string, next: boolean) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("availability_rules")
      .update({ is_active: next })
      .eq("id", id);
    setBusy(false);
    if (error) return toast.error("No se pudo actualizar.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Alta */}
      <form onSubmit={addRule} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="weekday">Día</Label>
          <select id="weekday" className={selectClasses} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {WEEKDAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="start">Desde</Label>
          <Input id="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="end">Hasta</Label>
          <Input id="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <Button type="submit" disabled={busy}>Agregar</Button>
      </form>

      {/* Lista agrupada por día */}
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aún no defines horarios. Agrega tu primer bloque arriba.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className={r.is_active ? "" : "text-muted-foreground line-through"}>
                <span className="font-medium">{WEEKDAYS[r.weekday]}</span>{" "}
                {hhmm(r.start_time)}–{hhmm(r.end_time)}
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => toggleRule(r.id, !r.is_active)}>
                  {r.is_active ? "Pausar" : "Activar"}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => removeRule(r.id)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
