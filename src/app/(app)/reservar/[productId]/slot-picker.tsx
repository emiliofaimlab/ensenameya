"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type Slot = { slot_start: string; slot_end: string };

const localTz = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? "tu zona horaria";

/** "(GMT-5) America/Lima" — el offset sale del propio Intl, sin tabla fija. */
function tzLabel(): string {
  const parts = new Intl.DateTimeFormat("es", {
    timeZoneName: "shortOffset",
  }).formatToParts(new Date());
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return off ? `(${off}) ${localTz()}` : localTz();
}

/** Clave de día LOCAL (no UTC): dos slots del mismo día deben caer en la misma. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

const chipLabel = (iso: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * US-601 (SCR-AL04) — selección de horario. Los `slot_start` llegan en UTC desde
 * get_available_slots (ya descontadas reglas/excepciones/ocupados) y se pintan en
 * la hora local del alumno. Para paquetes se eligen N horarios (RN-12).
 *
 * ponytail: calendario a mano con `Date` — react-day-picker (lo que usa el
 * calendar de shadcn) sería una dependencia nueva para pintar una rejilla de
 * 42 celdas y marcar los días con hueco.
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

  // Slots por día local. El orden dentro de cada día ya viene por slot_start.
  const byDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of slots) {
      const key = dayKey(new Date(s.slot_start));
      const bucket = groups.get(key);
      if (bucket) bucket.push(s.slot_start);
      else groups.set(key, [s.slot_start]);
    }
    return groups;
  }, [slots]);

  const first = slots.length > 0 ? new Date(slots[0]!.slot_start) : new Date();
  const [month, setMonth] = useState(
    () => new Date(first.getFullYear(), first.getMonth(), 1),
  );
  const [openDay, setOpenDay] = useState<string | null>(
    slots.length > 0 ? dayKey(first) : null,
  );

  // Rejilla del mes empezando en lunes. `getDay()` da 0=domingo.
  const grid = useMemo(() => {
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (firstOfMonth.getDay() + 6) % 7;
    const days: (Date | null)[] = Array.from({ length: offset }, () => null);
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= total; d++) {
      days.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    return days;
  }, [month]);

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
      <p className="text-sm text-muted-foreground">
        Este tutor no tiene horarios disponibles por ahora. Vuelve a intentarlo
        más tarde.
      </p>
    );
  }

  const openSlots = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
      <section className="rounded-2xl bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold first-letter:uppercase">
            {month.toLocaleDateString("es", { month: "long", year: "numeric" })}
          </h2>
          <div className="flex gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Mes anterior"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Mes siguiente"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-1 text-center text-[13px] text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1 font-medium">
              {d}
            </div>
          ))}
          {grid.map((d, i) => {
            if (!d) return <div key={`x${i}`} />;
            const key = dayKey(d);
            const has = byDay.has(key);
            const isOpen = key === openDay;
            const chosen = (byDay.get(key) ?? []).some((iso) =>
              selected.has(iso),
            );
            return (
              <button
                key={key}
                type="button"
                disabled={!has}
                onClick={() => setOpenDay(key)}
                aria-pressed={isOpen}
                className={cn(
                  "aspect-square rounded-lg text-sm transition-colors",
                  !has && "text-muted-foreground/40",
                  has && !isOpen && "font-medium hover:bg-muted",
                  chosen && !isOpen && "bg-brand-muted text-brand",
                  isOpen && "bg-brand font-semibold text-white",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        {openSlots.length > 0 ? (
          <div className="mt-6 border-t pt-5">
            <h3 className="text-sm font-semibold first-letter:uppercase">
              {new Date(openSlots[0]!).toLocaleDateString("es", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {openSlots.map((iso) => (
                <Button
                  key={iso}
                  type="button"
                  size="sm"
                  variant={selected.has(iso) ? "default" : "outline"}
                  onClick={() => toggle(iso)}
                >
                  {timeLabel(iso)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <aside className="rounded-2xl bg-card p-6 lg:sticky lg:top-24">
        <h2 className="text-lg font-bold">Tu selección</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Hora local: {tzLabel()}
        </p>

        <p className="mt-4 text-sm font-semibold">
          {selected.size} de {required}{" "}
          {required === 1 ? "sesión seleccionada" : "sesiones seleccionadas"}
        </p>

        {selected.size === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Elige un día en el calendario y luego su horario.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {[...selected].sort().map((iso) => (
              <li
                key={iso}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-[13px]"
              >
                <span className="first-letter:uppercase">{chipLabel(iso)}</span>
                <button
                  type="button"
                  onClick={() => toggle(iso)}
                  aria-label={`Quitar ${chipLabel(iso)}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          className="mt-5 h-11 w-full"
          disabled={selected.size !== required}
          onClick={onContinue}
        >
          Continuar
        </Button>
      </aside>
    </div>
  );
}
