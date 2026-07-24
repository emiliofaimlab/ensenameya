import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatMoney,
  perSessionLabel,
  priceUnitLabel,
} from "@/lib/catalog/format";
import { listProductSlots } from "@/lib/catalog/queries";
import type { ProductCardData } from "@/lib/catalog/queries";

const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];

/** Clave de día LOCAL (no UTC): dos huecos del mismo día caen en la misma. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

/**
 * Panel de reserva de P07: precio, calendario con los días que tienen hueco,
 * horarios del día elegido y selector de tipo de clase.
 *
 * ponytail: todo por URL y renderizado en servidor — sin estado de cliente ni
 * calendario de librería. Los huecos salen de `get_available_slots`, la misma
 * función que usa el flujo de reserva, así que no hay dos verdades.
 *
 * Reservar sigue llevando a `/reservar/[productId]`, que exige sesión: aquí se
 * mira, allí se compra.
 */
export async function BookingPanel({
  products,
  selectedId,
  selectedDay,
  hrefFor,
  ctaLabel = "Reservar clase YA",
  note = "Pago protegido · Cancela con 24h y recibe el 100%.",
  details = false,
  footer,
}: {
  products: ProductCardData[];
  selectedId?: string;
  selectedDay?: string;
  hrefFor: (next: { p?: string; d?: string }) => string;
  ctaLabel?: string;
  note?: string;
  /** P08 añade equivalencia por sesión y duración bajo el precio. */
  details?: boolean;
  /** Contenido extra bajo el botón (P08: política de cancelación). */
  footer?: ReactNode;
}) {
  if (products.length === 0) {
    return (
      <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)]">
        <p className="text-sm text-muted-foreground">
          Este tutor aún no tiene mentorías disponibles para reservar.
        </p>
      </aside>
    );
  }

  const product =
    products.find((p) => p.id === selectedId) ??
    products.reduce((min, p) => (p.priceAmount < min.priceAmount ? p : min));
  const slots = await listProductSlots(product.id);

  // Días con hueco y horarios del día elegido, en la hora local del servidor.
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const key = dayKey(new Date(s.start));
    byDay.set(key, [...(byDay.get(key) ?? []), s.start]);
  }
  const firstDay = slots.length ? new Date(slots[0]!.start) : new Date();
  const day =
    selectedDay && byDay.has(selectedDay) ? selectedDay : dayKey(firstDay);
  const times = byDay.get(day) ?? [];

  // Rejilla del mes del día elegido, empezando en domingo como el Figma.
  const cursor = new Date(`${day}T12:00:00`);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const offset = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => new Date(year, month, i + 1)),
  ];

  return (
    <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)] lg:sticky lg:top-24">
      <p className="flex items-baseline gap-1.5">
        <span className="text-[30px] font-bold text-[#19191f]">
          {formatMoney(product.priceAmount, product.currency)}
        </span>
        <span className="text-[15px] text-[#6b6b6b]">
          / {priceUnitLabel(product)}
        </span>
      </p>
      {details ? (
        <>
          {perSessionLabel(product) ? (
            <p className="mt-3 text-[13px] text-[#6b6b6b]">
              {perSessionLabel(product)}
            </p>
          ) : null}
          {product.sessionDurationMin ? (
            <p className="mt-3 text-sm text-[#595959]">
              En vivo 1 a 1 · {product.sessionDurationMin} min por sesión
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[13px] text-[#6b6b6b]">
          Asegura tu sesión individual o elige un paquete enfocado en tu meta.
        </p>
      )}

      <hr className="my-5 border-[#e0e0e0]" />

      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-[#212121]">
          {cursor.toLocaleDateString("es", { month: "long", year: "numeric" })}
        </p>
        <p className="text-xs text-[#808080]">Días disponibles</p>
      </div>

      {slots.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Sin horarios publicados para las próximas semanas.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-7 text-center text-xs font-medium text-[#808080]">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1 text-center">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const key = dayKey(d);
              const free = byDay.has(key);
              const isSelected = key === day;
              if (!free) {
                return (
                  <span
                    key={i}
                    className="grid h-[38px] place-items-center text-[13px] text-[#bfbfbf]"
                  >
                    {d.getDate()}
                  </span>
                );
              }
              return (
                <Link
                  key={i}
                  href={hrefFor({ p: product.id, d: key })}
                  aria-current={isSelected ? "date" : undefined}
                  className={`grid h-[38px] place-items-center rounded-full text-[13px] transition-colors ${
                    isSelected
                      ? "bg-brand font-bold text-white"
                      : "text-[#212121] hover:bg-muted"
                  }`}
                >
                  {d.getDate()}
                </Link>
              );
            })}
          </div>

          <p className="mt-5 text-[13px] font-medium">Horarios disponibles</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {times.map((iso, i) => (
              <Link
                key={iso}
                href={`/reservar/${product.id}?slot=${encodeURIComponent(iso)}`}
                className={`rounded-[8px] px-3 py-2 text-[13px] transition-colors ${
                  i === 0
                    ? "bg-brand text-white hover:bg-brand-foreground"
                    : "border border-[#cccccc] text-[#333333] hover:bg-muted"
                }`}
              >
                {new Date(iso).toLocaleTimeString("es", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Link>
            ))}
          </div>
        </>
      )}

      {products.length > 1 ? (
        <div className="mt-5">
          <p className="text-[13px] font-medium text-[#6b6b6b]">
            Tipo de clase
          </p>
          <details className="group relative mt-1.5">
            <summary className="flex h-[43px] cursor-pointer list-none items-center justify-between gap-2 rounded-[8px] border border-[#d1d1d1] px-3.5 text-sm text-[#595959] marker:hidden">
              <span className="truncate">{product.title}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="absolute right-0 left-0 z-10 mt-1 rounded-[8px] border bg-card p-1 shadow-md">
              {products.map((p) => (
                <li key={p.id}>
                  <Link
                    href={hrefFor({ p: p.id })}
                    className="block truncate rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}

      <Button asChild className="mt-5 h-[51px] w-full text-[15px]">
        <Link href={`/reservar/${product.id}`}>{ctaLabel}</Link>
      </Button>

      {footer}

      {/* "Enviar mensaje" del Figma no se implementa: la bandeja alumno ↔ tutor
          es DD-07 (`EY-117`) y hoy el chat solo existe por reserva. */}

      <p className="mt-4 text-center text-xs text-[#6b6b6b]">{note}</p>
    </aside>
  );
}
