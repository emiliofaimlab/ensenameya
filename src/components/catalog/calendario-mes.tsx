import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/**
 * El calendario mensual de la reserva, sacado TAL CUAL de `booking-panel.tsx`
 * (27-nov) para que la postulación a un clasificado elija el día igual que el
 * resto del sitio. Sin hooks ni `"use client"`: lo pinta un Server Component
 * (`BookingPanel`) y uno de cliente (`clasificados/[id]/postular.tsx`).
 *
 * Todo va por enlaces: el estado (día y mes) vive en la URL de quien lo monta,
 * que es quien sabe construirla (`hrefDia`, `hrefMes`).
 */

/**
 * G-04a · cabeceras de DOS letras. Con una sola («D L M M J V S») martes y
 * miércoles quedaban los dos en «M», así que para saber en qué columna caía un
 * día había que contarlas desde el domingo. La semana sigue empezando en
 * DOMINGO, igual que `slot-picker.tsx`: los dos calendarios de la reserva no
 * pueden empezar la semana en días distintos (§N-32).
 */
const WEEKDAYS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];

export const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" de una clave de día "YYYY-MM-DD". */
export const mesDe = (dia: string) => dia.slice(0, 7);

/**
 * Mes ± n. Con aritmética de meses y no con `Date`: un `setMonth()` sobre una
 * fecha local vuelve a meter la zona del SERVIDOR en la rejilla, que es justo
 * lo que R24-22 prohíbe.
 */
export const mesDesplazado = (mes: string, delta: number) => {
  const [y, m] = mes.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};

/** `m=` llega de la barra de direcciones: texto sin validar, igual que `?h=`. */
export const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Clave de día "YYYY-MM-DD" **en la zona del visitante** (R24-22): un hueco de
 * las 23:00 en México es del día siguiente en Madrid, y el calendario tiene que
 * agruparlo donde el visitante lo vive — no donde está el servidor.
 * `en-CA` da exactamente ese formato.
 */
export const slotDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/**
 * G-04b · una flecha de mes.
 *
 * ⚠️ SIN DESTINO SE PINTA APAGADA, NO SE OCULTA. La fila está centrada sobre la
 * rejilla, así que quitar una flecha desplaza el rótulo del mes y la rejilla
 * «salta» de sitio justo al cambiar de mes, que es el momento en el que el ojo
 * está pegado a ella. Apagada ocupa lo mismo y además dice que ahí se acaba el
 * horizonte, en vez de dejar creer que la flecha nunca existió.
 */
function FlechaMes({
  href,
  etiqueta,
  children,
}: {
  href?: string;
  etiqueta: string;
  children: ReactNode;
}) {
  const base = "grid size-[30px] place-items-center rounded-lg border lg:size-7";
  return href ? (
    <Link
      href={href}
      scroll={false}
      aria-label={etiqueta}
      title={etiqueta}
      className={`${base} border-[#e0e0e0] text-[#404040] transition-colors hover:border-brand hover:text-brand`}
    >
      {children}
    </Link>
  ) : (
    // `aria-hidden`: sin destino no es un control, y anunciar «mes anterior» a
    // algo que no lleva a ningún sitio es peor que no anunciarlo.
    <span aria-hidden className={`${base} border-[#f0f0f0] text-[#c4c4c4]`}>
      {children}
    </span>
  );
}

export function CalendarioMes({
  mes,
  mesMinimo,
  mesTope,
  diasLibres,
  seleccionado,
  hrefDia,
  hrefMes,
  compacto = false,
}: {
  /** Mes pintado, "YYYY-MM". */
  mes: string;
  /** Sin flecha atrás antes de este mes, ni adelante después de `mesTope`. */
  mesMinimo: string;
  mesTope: string;
  /** Claves "YYYY-MM-DD" con algún hueco: solo esas son pulsables. */
  diasLibres: { has: (dia: string) => boolean };
  /** Día elegido ("YYYY-MM-DD"), si lo hay. */
  seleccionado?: string;
  hrefDia: (dia: string) => string;
  hrefMes: (mes: string) => string;
  /** El panel compacto de `BookingPanel` (celdas de 27 px desde `lg`). */
  compacto?: boolean;
}) {
  const siCompacto = (clases: string) => (compacto ? clases : "");
  const mesAtras = mesDesplazado(mes, -1);
  const mesAdelante = mesDesplazado(mes, 1);

  // Rejilla del mes pintado. Se construye con NÚMEROS de calendario y claves de
  // texto, sin objetos Date locales: así la rejilla no se desplaza por la zona
  // del servidor (R24-22).
  const [anio, mesNum] = mes.split("-").map(Number) as [number, number];
  const offset = new Date(Date.UTC(anio, mesNum - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const monthLabel = new Date(Date.UTC(anio, mesNum - 1, 1)).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <div className="flex items-center justify-center gap-3.5">
        <FlechaMes
          href={mesAtras >= mesMinimo ? hrefMes(mesAtras) : undefined}
          etiqueta="Mes anterior"
        >
          <ChevronLeftIcon className="size-4" />
        </FlechaMes>
        <p className="text-[15px] font-semibold text-[#212121]">{monthLabel}</p>
        <FlechaMes
          href={mesAdelante <= mesTope ? hrefMes(mesAdelante) : undefined}
          etiqueta="Mes siguiente"
        >
          <ChevronRightIcon className="size-4" />
        </FlechaMes>
      </div>

      <div
        className={`mt-4 grid grid-cols-7 text-center text-xs font-medium text-[#808080] ${siCompacto("lg:mt-2")}`}
      >
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-1 text-center">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const key = `${anio}-${pad(mesNum)}-${pad(d)}`;
          // La clave lleva el mes dentro, así que un día elegido en OTRO mes no
          // marca ninguna casilla del que se está mirando — y vuelve a marcarse
          // solo al volver a su mes.
          const isSelected = key === seleccionado;
          if (!diasLibres.has(key)) {
            return (
              <span
                key={i}
                // Mismo alto que los días pulsables: si no, la rejilla del mes
                // cambia de altura según cuántos días haya libres.
                className={`grid h-10 place-items-center text-[13px] text-[#bfbfbf] ${siCompacto("lg:h-[27px] lg:text-[11.5px]")}`}
              >
                {d}
              </span>
            );
          }
          return (
            <Link
              key={i}
              href={hrefDia(key)}
              scroll={false}
              aria-current={isSelected ? "date" : undefined}
              // 40 px de alto: los días del calendario son el control que más se
              // toca y se quedaban por debajo del mínimo táctil del proyecto.
              // ⚠️ Los 27 px del panel compacto son SOLO desde `lg`, donde se
              // pulsa con un ratón: en móvil los 40 se quedan.
              className={`grid h-10 place-items-center rounded-full text-[13px] transition-colors ${siCompacto(
                "lg:h-[27px] lg:text-[11.5px]",
              )} ${isSelected ? "bg-brand font-bold text-white" : "text-[#212121] hover:bg-muted"}`}
            >
              {d}
            </Link>
          );
        })}
      </div>
    </>
  );
}
