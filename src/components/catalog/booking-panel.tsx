import type { ReactNode } from "react";
import Link from "next/link";

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
 * Panel de reserva de P07/P08 — flujo **día → clase → horario** (R24-13).
 *
 * El calendario es GLOBAL del tutor: pinta los días con hueco de cualquiera de
 * sus mentorías. Al elegir día aparece el selector de clase (solo las que
 * tienen hueco ese día) y, al elegir clase, sus horarios. Así una reserva
 * siempre deja claro QUÉ clase se está pagando, que era el problema cuando el
 * tutor dicta varias.
 *
 * El **precio es dinámico** (R24-14): no se muestra un importe fijo por
 * adelantado; aparece cuando ya hay clase elegida (en P08 la clase viene dada,
 * así que se ve desde el principio).
 *
 * ponytail: todo por URL y renderizado en servidor — sin estado de cliente ni
 * calendario de librería. Los huecos salen de `get_available_slots`, la misma
 * función que usa el flujo de reserva, así que no hay dos verdades.
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

  // Huecos de TODAS las mentorías: el calendario es del tutor, no de una clase.
  const slotsByProduct = new Map<string, string[]>(
    await Promise.all(
      products.map(
        async (p) =>
          [p.id, (await listProductSlots(p.id)).map((s) => s.start)] as const,
      ),
    ),
  );

  /** día → ids de las clases que tienen hueco ese día. */
  const productsByDay = new Map<string, Set<string>>();
  for (const [pid, starts] of slotsByProduct) {
    for (const iso of starts) {
      const key = dayKey(new Date(iso));
      const set = productsByDay.get(key) ?? new Set<string>();
      set.add(pid);
      productsByDay.set(key, set);
    }
  }

  // Con una sola mentoría (P08) la clase viene dada; con varias hay que elegir.
  const single = products.length === 1 ? products[0] : undefined;
  const chosen =
    single ?? products.find((p) => p.id === selectedId) ?? undefined;

  const allDays = [...productsByDay.keys()].sort();
  const day =
    selectedDay && productsByDay.has(selectedDay)
      ? selectedDay
      : (allDays[0] ?? dayKey(new Date()));

  /** Clases con hueco el día elegido (las que ofrece el selector). */
  const dayProducts = products.filter((p) => productsByDay.get(day)?.has(p.id));
  /** Horarios de la clase elegida ESE día. */
  const times = chosen
    ? (slotsByProduct.get(chosen.id) ?? []).filter(
        (iso) => dayKey(new Date(iso)) === day,
      )
    : [];

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
      {/* R24-14: sin precio fijo por delante. Con clase elegida se muestra su
          importe real; sin ella, el título de reserva. */}
      {chosen ? (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="text-[30px] font-bold text-[#19191f]">
              {formatMoney(chosen.priceAmount, chosen.currency)}
            </span>
            <span className="text-[15px] text-[#6b6b6b]">
              / {priceUnitLabel(chosen)}
            </span>
          </p>
          {details ? (
            <>
              {perSessionLabel(chosen) ? (
                <p className="mt-3 text-[13px] text-[#6b6b6b]">
                  {perSessionLabel(chosen)}
                </p>
              ) : null}
              {chosen.sessionDurationMin ? (
                <p className="mt-3 text-sm text-[#595959]">
                  En vivo 1 a 1 · {chosen.sessionDurationMin} min por sesión
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1.5 text-[13px] text-[#6b6b6b]">{chosen.title}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-[22px] font-bold text-[#19191f]">
            Reserva con este tutor
          </p>
          <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
            Elige el día y la clase; el precio depende de la mentoría que
            escojas.
          </p>
        </>
      )}

      <hr className="my-5 border-[#e0e0e0]" />

      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-[#212121]">
          {cursor.toLocaleDateString("es", { month: "long", year: "numeric" })}
        </p>
        <p className="text-xs text-[#808080]">Días disponibles</p>
      </div>

      {allDays.length === 0 ? (
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
              const free = productsByDay.has(key);
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
                  // Cambiar de día conserva la clase solo si sigue teniendo
                  // hueco; si no, se vuelve a elegir (evita un combo imposible).
                  href={hrefFor({
                    p:
                      chosen && productsByDay.get(key)?.has(chosen.id)
                        ? chosen.id
                        : undefined,
                    d: key,
                  })}
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

          {/* Paso 2 (R24-13): elegir la clase de ESE día. Con una sola mentoría
              (P08) no hay nada que elegir y se salta. */}
          {single ? null : (
            <div className="mt-5">
              <p className="text-[13px] font-medium">Elige la clase</p>
              <ul className="mt-2 flex flex-col gap-2">
                {dayProducts.map((p) => {
                  const on = p.id === chosen?.id;
                  return (
                    <li key={p.id}>
                      <Link
                        href={hrefFor({ p: p.id, d: day })}
                        aria-current={on ? "true" : undefined}
                        className={`flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${
                          on
                            ? "border-brand bg-brand-muted"
                            : "border-[#e0e0e0] hover:border-brand"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium text-[#212121]">
                            {p.title}
                          </span>
                          <span className="block text-xs text-[#6b6b6b]">
                            {formatMoney(p.priceAmount, p.currency)} ·{" "}
                            {priceUnitLabel(p)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Paso 3: horarios de la clase elegida ese día. */}
          {chosen ? (
            <>
              <p className="mt-5 text-[13px] font-medium">
                Horarios disponibles
              </p>
              {times.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Esta clase no tiene horarios ese día. Prueba con otro día.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {times.map((iso, i) => (
                    <Link
                      key={iso}
                      href={`/reservar/${chosen.id}?slot=${encodeURIComponent(iso)}`}
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
              )}
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Elige una clase para ver sus horarios y su precio.
            </p>
          )}
        </>
      )}

      {chosen ? (
        <Button asChild className="mt-5 h-[51px] w-full text-[15px]">
          <Link href={`/reservar/${chosen.id}`}>{ctaLabel}</Link>
        </Button>
      ) : (
        <Button
          disabled
          className="mt-5 h-[51px] w-full text-[15px]"
          title="Elige primero una clase"
        >
          {ctaLabel}
        </Button>
      )}

      {footer}

      {/* "Enviar mensaje" del Figma no se implementa: la bandeja alumno ↔ tutor
          es DD-07 (`EY-117`) y hoy el chat solo existe por reserva. */}

      <p className="mt-4 text-center text-xs text-[#6b6b6b]">{note}</p>
    </aside>
  );
}
