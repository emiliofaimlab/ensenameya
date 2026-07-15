"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type Slot = { slot_start: string; slot_end: string };

const localTz = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? "tu zona horaria";

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

/**
 * US-601 (SCR-AL04) — selección de horario. Los `slot_start` llegan en UTC desde
 * get_available_slots (ya descontadas reglas/excepciones/ocupados) y se pintan en
 * la hora local del alumno. Para paquetes se eligen N horarios (RN-12).
 */
export function SlotPicker({
  productId,
  slots,
  required,
}: {
  productId: string;
  slots: Slot[];
  required: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Agrupar por día local (el orden ya viene por slot_start).
  const byDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of slots) {
      const key = dayLabel(s.slot_start);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s.slot_start);
    }
    return [...groups.entries()];
  }, [slots]);

  function toggle(iso: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) {
        next.delete(iso);
        return next;
      }
      if (required === 1) return new Set([iso]); // sesión única: reemplaza
      if (next.size >= required) {
        toast.error(`Elige exactamente ${required} horarios.`);
        return prev;
      }
      next.add(iso);
      return next;
    });
  }

  function onContinue() {
    const chosen = [...selected].sort();
    router.push(
      `/reservar/${productId}/checkout?slots=${encodeURIComponent(chosen.join(","))}`,
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Este tutor no tiene horarios disponibles por ahora. Vuelve a intentarlo
        más tarde.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Horarios en tu hora local ({localTz()}).
        {required > 1
          ? ` Elige ${required} horarios para tu paquete.`
          : ""}
      </p>

      <div className="flex flex-col gap-5">
        {byDay.map(([day, isos]) => (
          <div key={day} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium first-letter:uppercase">{day}</h3>
            <div className="flex flex-wrap gap-2">
              {isos.map((iso) => {
                const on = selected.has(iso);
                return (
                  <Button
                    key={iso}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() => toggle(iso)}
                  >
                    {timeLabel(iso)}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" disabled={selected.size !== required} onClick={onContinue}>
          Continuar
        </Button>
        <span className="text-muted-foreground text-sm">
          {selected.size}/{required} elegidos
        </span>
      </div>
    </div>
  );
}
