"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/catalog/format";
import { HOLD_POLICY } from "@/lib/policy";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";

export type Slot = { slot_start: string; slot_end: string };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * ⚠️ N-32 · ESTE CALENDARIO Y EL DE LA FICHA PÚBLICA (`BookingPanel`) TIENEN
 * QUE CONTAR LO MISMO, y hasta hoy no lo hacían. Agrupaban los huecos por
 * criterios distintos:
 *
 *   · `BookingPanel` usa `Intl` con la zona del visitante EXPLÍCITA;
 *   · este usaba `Date` local del navegador (`getFullYear`/`getMonth`/`getDate`).
 *
 * Se unifica en el primero, que es el bueno por dos motivos, no uno:
 *
 *   1. Este componente es de cliente pero TAMBIÉN se renderiza en el servidor
 *      (SSR de la primera carga). Allí `new Date(iso).getDate()` da el día en la
 *      zona del SERVIDOR —UTC en Vercel—, así que el HTML llegaba con una
 *      rejilla y el navegador la repintaba con otra. Es el bug R24-12/RV-03 otra
 *      vez, y en un calendario se ve como un hueco que salta de día.
 *   2. La zona del usuario NO es siempre la del navegador: `getUserTimezone()`
 *      prefiere `profiles.timezone`. Quien tenga guardado Lima y esté de viaje
 *      en Madrid veía la ficha en Lima y esta pantalla en Madrid.
 *
 * Regla para quien toque esto: aquí NO se usa `new Date(...).getDate()`,
 * `getMonth()` ni `getDay()` sobre un instante. Los días se calculan como texto
 * con `timeZone` explícita, y la rejilla del mes con aritmética UTC sobre
 * números, que no depende de ninguna zona.
 */
const dayKey = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** "(GMT-5) America/Lima" — el offset sale del propio Intl, sin tabla fija. */
function tzLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("es", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date());
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return off ? `(${off}) ${timeZone}` : timeZone;
}

const timeLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

const chipLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

/**
 * Semana empezando en DOMINGO, como `BookingPanel`. Empezaba en lunes y era la
 * otra mitad de «el calendario salta en otra forma»: la misma fecha caía en una
 * columna distinta en cada pantalla. Manda la de la ficha pública porque es la
 * que se ve primero y la que sobrevive al flujo nuevo (N-33).
 */
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "YYYY-MM" ± n meses, con aritmética UTC (sin zonas de por medio). */
function moverMes(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * US-601 (SCR-AL04) — selección de horario. Los `slot_start` llegan en UTC desde
 * get_available_slots (ya descontadas reglas/excepciones/ocupados) y se pintan en
 * la hora local del alumno. Para paquetes se eligen N horarios (RN-12).
 *
 * ⚠️ N-33 · desde el 17-ago esta pantalla YA NO está en el camino normal de una
 * sesión suelta: la página la salta cuando llega una hora válida y solo hay una
 * que elegir. Lo que queda aquí es la selección MÚLTIPLE de los paquetes —que no
 * cabe en el panel lateral de la ficha— y el respaldo de quien llega sin hora.
 * Por eso no se borró: borrarla dejaba los paquetes sin forma de reservarse.
 *
 * ponytail: calendario a mano — react-day-picker (lo que usa el calendar de
 * shadcn) sería una dependencia nueva para pintar una rejilla de 42 celdas y
 * marcar los días con hueco.
 */
export function SlotPicker({
  productId,
  productTitle,
  tutorName,
  slots,
  preselected = null,
  required,
  total,
  currency,
  durationMin,
  timeZone,
}: {
  productId: string;
  productTitle: string;
  tutorName?: string;
  slots: Slot[];
  /**
   * M-10 · Horario que el alumno ya eligió en la ficha (`?slot=`), validado
   * contra los huecos reales por la página. Llega marcado y con su día abierto:
   * repetir la elección era justo lo que se sentía como "se perdió".
   */
  preselected?: string | null;
  required: number;
  /** Total de la reserva (fijo): paquete completo o sesión suelta. */
  total: number;
  currency: string;
  durationMin: number | null;
  /**
   * Zona del alumno (`getUserTimezone`), resuelta en el servidor. Obligatoria:
   * ver la nota de `dayKey`. Sin ella el SSR agrupa por la zona del servidor.
   */
  timeZone: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselected ? [preselected] : []),
  );

  // Slots por día del alumno. El orden dentro de cada día ya viene por slot_start.
  const byDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of slots) {
      const key = dayKey(s.slot_start, timeZone);
      const bucket = groups.get(key);
      if (bucket) bucket.push(s.slot_start);
      else groups.set(key, [s.slot_start]);
    }
    return groups;
  }, [slots, timeZone]);

  // El calendario arranca donde está el horario que traía el alumno; si no
  // trae ninguno, en el primer hueco libre, como siempre.
  const primerDia = preselected
    ? dayKey(preselected, timeZone)
    : slots.length > 0
      ? dayKey(slots[0]!.slot_start, timeZone)
      : dayKey(new Date().toISOString(), timeZone);

  const [ym, setYm] = useState(() => primerDia.slice(0, 7));
  const [openDay, setOpenDay] = useState<string | null>(
    preselected || slots.length > 0 ? primerDia : null,
  );

  // Rejilla del mes. Números de calendario y claves de texto, sin objetos `Date`
  // locales: así no se desplaza por la zona de quien la renderice (mismo patrón
  // que `BookingPanel`).
  const { year, month, cells } = useMemo(() => {
    const [y, m] = ym.split("-").map(Number) as [number, number];
    const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = domingo
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      year: y,
      month: m,
      cells: [
        ...Array.from({ length: offset }, () => null),
        ...Array.from({ length: total }, (_, i) => i + 1),
      ] as (number | null)[],
    };
  }, [ym]);

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "es",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

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

  /*
   * B3.5 · el `div` de fuera existe SOLO para que la barra de abajo tenga de
   * quién colgarse.
   *
   * `position: sticky` se mide contra el bloque contenedor, y en una rejilla el
   * bloque contenedor de un hijo es SU CELDA: metida dentro del `grid`, la
   * barra solo podría pegarse a lo alto de su propia fila —o sea, a nada—.
   * Colgando de un bloque normal que envuelve toda la pantalla, el recorrido
   * pegajoso es el alto entero del selector, que es lo que se busca.
   */
  return (
    <div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <PanelCard>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[17px] font-bold text-[#19191f] first-letter:uppercase">
                {monthLabel}
              </h2>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Mes anterior"
                  onClick={() => setYm(moverMes(ym, -1))}
                >
                  <ChevronLeftIcon className="size-4 text-[#6b6b6b]" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Mes siguiente"
                  onClick={() => setYm(moverMes(ym, 1))}
                >
                  <ChevronRightIcon className="size-4 text-[#6b6b6b]" />
                </Button>
              </div>
            </div>

            {/* El Figma pone la zona horaria aquí, no en el panel lateral. */}
            <p className="mt-2 text-xs text-[#6b6b6b]">
              Hora local: {tzLabel(timeZone)}
            </p>

            <div className="mt-3.5 grid grid-cols-7 gap-2 text-center">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="flex h-10 items-center justify-center text-[13px] font-medium text-[#6b6b6b]"
                >
                  {d}
                </div>
              ))}
              {cells.map((d, i) => {
                if (!d) return <div key={`x${i}`} className="h-10" />;
                const key = `${year}-${pad(month)}-${pad(d)}`;
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
                    {d}
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
                  timeZone,
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
                      {timeLabel(iso, timeZone)}
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
                  <span className="first-letter:uppercase">
                    {chipLabel(iso, timeZone)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(iso)}
                    aria-label={`Quitar ${chipLabel(iso, timeZone)}`}
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

          {/* ⚠️ ESTA FRASE PROMETÍA EXACTAMENTE LO CONTRARIO DE LO QUE PASA, y
              dejó de ser cierta con D-2 (§20.14) — el mismo cambio que trajo el
              formulario de pago montado al llegar. Decía «el horario queda
              reservado al confirmar el pago» porque hasta entonces
              `create_booking` no corría hasta pulsar pagar y el hueco seguía
              libre mientras tanto. Ahora la reserva se crea AL LLEGAR al
              checkout: el horario se retiene ANTES de pagar. La promesa que
              queda es la que el Figma ya traía, y que resultó ser la correcta.

              Y el número no se escribe a mano: sale de `HOLD_POLICY`, el mismo
              sitio del que lo saca el contador del checkout —y ese es la copia
              del `p_payment_cutoff` de `expire_stale_bookings`—. Tener el plazo
              tecleado en dos pantallas es justo como se llega a que una de las
              dos mienta. */}
          <p className="mt-3 text-xs text-[#6b6b6b]">
            Al continuar te guardamos el horario {HOLD_POLICY.minutes} minutos
            para que completes el pago.
          </p>

          {/* B3.5 · en móvil este botón se esconde y manda el de la barra de
              abajo. No es que sobre: es que aquí está al final de la tercera
              tarjeta, y tener DOS «Continuar al pago» a la vista —uno pegado
              abajo y otro dentro de la tarjeta— hace dudar de si son lo mismo.
              En escritorio no hay barra: la tarjeta ya es `sticky` y el botón
              se ve entero desde el primer momento. */}
          <Button
            type="button"
            className="mt-4 h-[45px] w-full rounded-[10px] text-sm font-semibold max-lg:hidden"
            disabled={selected.size !== required}
            onClick={onContinue}
          >
            Continuar al pago
          </Button>
        </PanelCard>
      </div>

      {/*
        B3.5 · LA BARRA DE MÓVIL. En una columna las tres tarjetas se apilan
        —calendario, horarios, «Tu selección»— y el botón acaba a una pantalla y
        media del calendario: se elige el día, se elige la hora, y no hay ni un
        indicio de que exista un paso siguiente. Peor en un paquete, donde hay
        que repetir la elección N veces antes de llegar abajo.

        Así que en móvil el botón se despega y baja al borde de la ventana, con
        el contador de «cuántas llevas» al lado — que es lo que explica por qué
        está bloqueado. En escritorio no hace falta: la tarjeta de la derecha ya
        es `sticky` y no se mueve.

        ⚠️ El hueco de la derecha (`pe-[84px]`) es para la burbuja de chat:
        `fixed right-5 bottom-5 z-50` (`chat-bubble.tsx`) se pinta encima de
        esta barra, y sin el hueco el final del botón abre el chat en lugar de
        llevar al pago.

        Y el número sale de una cuenta, no del ojo: la burbuja es `right-5`
        (20 px) + `size-14` (56 px) = **76 px de huella** desde el borde
        derecho de la VENTANA, que es hasta donde llega esta barra por el
        `-mx-4` de abajo. Empezó siendo `pe-[72px]` y se quedaba 4 px corta —
        justo la esquina del botón, que es donde cae el pulgar. 84 deja 8 px de
        aire. Ojo si alguien toca el tamaño de la burbuja: este número va detrás.

        ⚠️ El `-mx-4 sm:-mx-6` la lleva a los bordes de la ventana cancelando el
        aire lateral de `PanelShell`. Son SUS números: si allí cambia el
        padding, aquí también, o la barra deja de encajar.
      */}
      <div className="sticky bottom-0 z-30 mt-5 -mx-4 border-t border-[#e0e0e0] bg-card pt-3 pb-3 ps-4 pe-[84px] sm:-mx-6 sm:ps-6 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="shrink-0 leading-tight">
            <p className="text-[11px] text-[#6b6b6b]">
              {selected.size} de {required}
            </p>
            <p className="text-[13px] font-bold text-[#19191f]">
              {formatMoney(total, currency)}
            </p>
          </div>
          <Button
            type="button"
            className="h-[45px] flex-1 rounded-[10px] text-sm font-semibold"
            disabled={selected.size !== required}
            onClick={onContinue}
          >
            Continuar al pago
          </Button>
        </div>

        {/* La promesa del hold, solo cuando el botón ya se puede pulsar: es
            justo entonces cuando pasa a ser cierta, y así la barra no ocupa dos
            líneas durante toda la elección. El número sale de `HOLD_POLICY`
            como en la tarjeta — ver la nota larga de ahí arriba. */}
        {selected.size === required ? (
          <p className="mt-2 text-[11px] text-[#6b6b6b]">
            Al continuar te guardamos el horario {HOLD_POLICY.minutes} minutos
            para que completes el pago.
          </p>
        ) : null}
      </div>
    </div>
  );
}
