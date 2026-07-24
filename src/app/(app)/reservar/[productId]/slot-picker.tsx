"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/catalog/format";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
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
  productTitle,
  tutorName,
  slots,
  required,
  total,
  currency,
  durationMin,
}: {
  productId: string;
  productTitle: string;
  tutorName?: string;
  slots: Slot[];
  required: number;
  /** Total de la reserva (fijo): paquete completo o sesión suelta. */
  total: number;
  currency: string;
  durationMin: number | null;
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
      <PanelCard>
        <p className="text-[13px] text-[#6b6b6b]">
          Este tutor no tiene horarios disponibles por ahora. Vuelve a intentarlo
          más tarde.
        </p>
      </PanelCard>
    );
  }

  const openSlots = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-5">
        <PanelCard>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[17px] font-bold text-[#19191f] first-letter:uppercase">
              {month.toLocaleDateString("es", { month: "long", year: "numeric" })}
            </h2>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Mes anterior"
                onClick={() =>
                  setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
                }
              >
                <ChevronLeftIcon className="size-4 text-[#6b6b6b]" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Mes siguiente"
                onClick={() =>
                  setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
                }
              >
                <ChevronRightIcon className="size-4 text-[#6b6b6b]" />
              </Button>
            </div>
          </div>

          {/* El Figma pone la zona horaria aquí, no en el panel lateral. */}
          <p className="mt-2 text-xs text-[#6b6b6b]">Hora local: {tzLabel()}</p>

          <div className="mt-3.5 grid grid-cols-7 gap-2 text-center">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="flex h-10 items-center justify-center text-[13px] font-medium text-[#6b6b6b]"
              >
                {d}
              </div>
            ))}
            {grid.map((d, i) => {
              if (!d) return <div key={`x${i}`} className="h-10" />;
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
                    "h-10 rounded-[10px] text-sm font-medium transition-colors",
                    // Sin huecos: número apagado y sin caja, como el Figma.
                    !has && "text-[#c4c4c4]",
                    has && "border-[1.5px] border-[#e0e0e0] text-[#19191f]",
                    has && !isOpen && !chosen && "hover:border-brand",
                    // Azul sólido = día con sesión elegida (168:8) o día abierto.
                    (chosen || isOpen) &&
                      "border-brand bg-brand text-white hover:border-brand",
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </PanelCard>

        {openSlots.length > 0 ? (
          <PanelCard>
            <PanelCardTitle className="text-[17px] first-letter:uppercase">
              Horarios ·{" "}
              {new Date(openSlots[0]!).toLocaleDateString("es", {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}
              {durationMin ? ` · ${durationMin} min` : ""}
            </PanelCardTitle>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {openSlots.map((iso) => {
                const on = selected.has(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => toggle(iso)}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border-[1.5px] px-3.5 text-[13px] font-medium transition-colors",
                      on
                        ? "border-brand bg-brand text-white"
                        : "border-[#e0e0e0] bg-card text-[#19191f] hover:border-brand",
                    )}
                  >
                    {timeLabel(iso)}
                  </button>
                );
              })}
            </div>
            {/* El Figma pinta además los horarios OCUPADOS en gris.
                `get_available_slots` solo devuelve los libres —los ocupados no
                salen de la BD—, así que aquí solo hay huecos reservables. */}
          </PanelCard>
        ) : null}
      </div>

      <PanelCard className="lg:sticky lg:top-24">
        <PanelCardTitle className="text-[17px]">Tu selección</PanelCardTitle>
        <p className="mt-2.5 text-[13px] text-[#6b6b6b]">
          {productTitle}
          {tutorName ? ` · con ${tutorName}` : ""}
        </p>

        <p className="mt-2.5 text-sm font-medium text-[#19191f]">
          {selected.size} de {required}{" "}
          {required === 1 ? "sesión seleccionada" : "sesiones seleccionadas"}
        </p>

        <hr className="my-3 border-[#e0e0e0]" />

        {selected.size === 0 ? (
          <p className="text-[13px] text-[#6b6b6b]">
            Elige un día en el calendario y luego su horario.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {[...selected].sort().map((iso) => (
              <li
                key={iso}
                className="flex items-center justify-between gap-2 text-[13px] text-[#19191f]"
              >
                <span className="first-letter:uppercase">{chipLabel(iso)}</span>
                <button
                  type="button"
                  onClick={() => toggle(iso)}
                  aria-label={`Quitar ${chipLabel(iso)}`}
                  className="text-[#6b6b6b] transition-colors hover:text-destructive"
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <hr className="my-3 border-[#e0e0e0]" />

        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-[#6b6b6b]">Total</span>
          <span className="text-base font-bold text-[#19191f]">
            {formatMoney(total, currency)}
          </span>
        </div>

        {/* El Figma promete "reserva tentativa: tienes 20 min para pagar"; en
            nuestro flujo `create_booking` no corre hasta confirmar el pago, así
            que el horario no se bloquea antes. Se cuenta lo que pasa de verdad. */}
        <p className="mt-3 text-xs text-[#6b6b6b]">
          El horario queda reservado al confirmar el pago.
        </p>

        <Button
          type="button"
          className="mt-4 h-[45px] w-full rounded-[10px] text-sm font-semibold"
          disabled={selected.size !== required}
          onClick={onContinue}
        >
          Continuar al pago
        </Button>
      </PanelCard>
    </div>
  );
}
