"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type ExcType = Database["public"]["Enums"]["availability_exception_type"];

export type Exception = {
  id: string;
  date: string;
  type: ExcType;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

const selectClasses =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const hhmm = (t: string) => t.slice(0, 5);
const today = () => new Date().toISOString().slice(0, 10);

// Fecha 'YYYY-MM-DD' → texto legible sin desfase de timezone (no usar new Date()).
function formatDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ExceptionsManager({
  userId,
  exceptions,
}: {
  userId: string;
  exceptions: Exception[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [type, setType] = useState<ExcType>("block");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  async function addException(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!date) return toast.error("Elige una fecha.");
    // Rango: ambos o ninguno; si hay rango, fin > inicio (espeja el check de BD).
    if (!!start !== !!end)
      return toast.error("Indica hora de inicio y fin, o deja ambas vacías.");
    if (start && end && end <= start)
      return toast.error("La hora de fin debe ser mayor a la de inicio.");

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_exceptions").insert({
      tutor_id: userId,
      date,
      type,
      start_time: start || null,
      end_time: end || null,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "No se pudo guardar la excepción.");
    toast.success("Excepción agregada.");
    setDate("");
    setStart("");
    setEnd("");
    setReason("");
    router.refresh();
  }

  async function removeException(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_exceptions").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error("No se pudo eliminar.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {exceptions.length === 0 ? (
        <p className="text-xs text-[#6b6b6b]">
          Sin excepciones. Bloquea un día libre o abre un horario extra puntual.
        </p>
      ) : (
        <ul className="divide-y divide-[#e0e0e0]">
          {exceptions.map((x) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[#404040]">
                  {formatDate(x.date)}
                </span>
                <span className="block text-xs text-[#6b6b6b]">
                  {x.type === "block" ? "Bloqueado" : "Abierto extra"} ·{" "}
                  {x.start_time && x.end_time
                    ? `${hhmm(x.start_time)}–${hhmm(x.end_time)}`
                    : "todo el día"}
                  {x.reason ? ` · ${x.reason}` : ""}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => removeException(x.id)}
                className="h-[34px] rounded-[8px] px-3 text-[13px] text-[#595959]"
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* "+ Añadir excepción" (194:218): el alta, plegada en un details nativo. */}
      <details className="group">
        <summary className="inline-flex h-[34px] cursor-pointer list-none items-center rounded-[8px] border border-[#e0e0e0] px-3 text-[13px] text-[#595959] transition-colors group-open:hidden hover:border-brand hover:text-brand marker:hidden">
          + Añadir excepción
        </summary>
        <form onSubmit={addException} className="grid gap-3 rounded-[12px] border border-[#e0e0e0] p-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="exc-date">Fecha</Label>
          <Input id="exc-date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="exc-type">Tipo</Label>
          <select id="exc-type" className={selectClasses} value={type} onChange={(e) => setType(e.target.value as ExcType)}>
            <option value="block">Bloquear</option>
            <option value="open">Abrir extra</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="exc-start">Desde (opcional)</Label>
          <Input id="exc-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="exc-end">Hasta (opcional)</Label>
          <Input id="exc-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="exc-reason">Motivo (opcional)</Label>
          <Input id="exc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Ej. Vacaciones" />
        </div>
        <Button type="submit" disabled={busy} className="sm:col-span-2">Agregar excepción</Button>
        </form>
      </details>
    </div>
  );
}
