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

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Clave de día "YYYY-MM-DD" **en la zona del visitante** (R24-22): un hueco de
 * las 23:00 en México es del día siguiente en Madrid, y el calendario tiene que
 * agruparlo donde el visitante lo vive — no donde está el servidor.
 * `en-CA` da exactamente ese formato.
 */
const slotDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** Hora del hueco en la zona del visitante. */
const slotTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

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
  timeZone,
}: {
  products: ProductCardData[];
  selectedId?: string;
  selectedDay?: string;
  /** Zona del visitante (`getViewerTimezone`): con sesión, la suya; sin sesión,
   *  la del navegador. Sin ella el SSR pintaría la hora del servidor (R24-22). */
  timeZone: string;
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

  /** día → ids de las clases que tienen hueco ese día (en la zona del visitante). */
  const productsByDay = new Map<string, Set<string>>();
  for (const [pid, starts] of slotsByProduct) {
    for (const iso of starts) {
      const key = slotDay(iso, timeZone);
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
      : (allDays[0] ?? slotDay(new Date().toISOString(), timeZone));

  /** Clases con hueco el día elegido (las que ofrece el selector). */
  const dayProducts = products.filter((p) => productsByDay.get(day)?.has(p.id));
  /** Horarios de la clase elegida ESE día. */
  const times = chosen
    ? (slotsByProduct.get(chosen.id) ?? []).filter(
        (iso) => slotDay(iso, timeZone) === day,
      )
    : [];

  // Rejilla del mes del día elegido. Se construye con NÚMEROS de calendario y
  // claves de texto, sin objetos Date locales: así la rejilla no se desplaza
  // por la zona del servidor (R24-22).
  const [year, month] = day.split("-").map(Number) as [number, number, number];
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "es",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)] lg:sticky lg:top-24">
      {/* R29-01: arriba del calendario va el TÍTULO de la clase; el precio baja
          junto al CTA. Sigue valiendo R24-14 (nada de importe fijo por delante):
          sin clase elegida no hay precio en ninguna de las dos posiciones. */}
      {chosen ? (
        <>
          <p className="text-[22px] font-bold text-balance text-[#19191f]">
            {chosen.title}
          </p>
          {details && chosen.sessionDurationMin ? (
            <p className="mt-1.5 text-sm text-[#595959]">
              En vivo 1 a 1 · {chosen.sessionDurationMin} min por sesión
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-[22px] font-bold text-[#19191f]">
            Reserva con este tutor
          </p>
          <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
            Elige el día y la sesión; el precio depende de la mentoría que
            escojas.
          </p>
        </>
      )}

      <hr className="my-5 border-[#e0e0e0]" />

      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-[#212121]">{monthLabel}</p>
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
              const key = `${year}-${pad(month)}-${pad(d)}`;
              const free = productsByDay.has(key);
              const isSelected = key === day;
              if (!free) {
                return (
                  <span
                    key={i}
                    className="grid h-[38px] place-items-center text-[13px] text-[#bfbfbf]"
                  >
                    {d}
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
                  {d}
                </Link>
              );
            })}
          </div>

          {/* Paso 2 (R24-13): elegir la clase de ESE día. Con una sola mentoría
              (P08) no hay nada que elegir y se salta. */}
          {single ? null : (
            <div className="mt-5">
              <p className="text-[13px] font-medium">Elige la sesión</p>
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
                Horarios disponibles{" "}
                <span className="font-normal text-[#6b6b6b]">
                  · en tu hora local
                </span>
              </p>
              {times.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Esta sesión no tiene horarios ese día. Prueba con otro día.
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
                      {slotTime(iso, timeZone)}
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Elige una sesión para ver sus horarios y su precio.
            </p>
          )}
        </>
      )}

      {/* R29-01 — el precio, al final: lo último antes de decidir, no lo primero
          que tapa el calendario. Sale del `chosen` de la URL, así que cambiar de
          clase lo cambia sin estado de cliente. */}
      {chosen ? (
        <>
          <hr className="mt-5 border-[#e0e0e0]" />
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[15px] text-[#6b6b6b]">Precio</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[30px] font-bold text-[#19191f]">
                {formatMoney(chosen.priceAmount, chosen.currency)}
              </span>
              <span className="text-[15px] text-[#6b6b6b]">
                / {priceUnitLabel(chosen)}
              </span>
            </span>
          </div>
          {/* El desglose por sesión solo en P08, donde hay sitio para detalle. */}
          {details && perSessionLabel(chosen) ? (
            <p className="mt-1 text-[13px] text-[#6b6b6b]">
              {perSessionLabel(chosen)}
            </p>
          ) : null}
        </>
      ) : null}

      {chosen ? (
        <Button asChild className="mt-4 h-[51px] w-full text-[15px]">
          <Link href={`/reservar/${chosen.id}`}>{ctaLabel}</Link>
        </Button>
      ) : (
        <Button
          disabled
          className="mt-5 h-[51px] w-full text-[15px]"
          title="Elige primero una sesión"
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
