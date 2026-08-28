import Link from "next/link";
import { ArrowRightIcon, CalendarDaysIcon } from "lucide-react";

import {
  PanelCard,
  PanelCardTitle,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { ScrollCarousel } from "@/components/ui/scroll-carousel";
import { Button } from "@/components/ui/button";
import { BOOKING_STATUS_LABEL, formatSessionTime } from "@/lib/booking";
import { formatMoney } from "@/lib/catalog/format";
import type { PanelHistorial } from "./historial";
import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/**
 * El color de la píldora. `/reservas` las pinta todas grises porque allí van en
 * una lista con la etiqueta bien visible; aquí son ocho tarjetas de un vistazo
 * y el color es lo que deja distinguir «terminó bien» de «no llegó a darse»
 * sin leer. Los tonos son los del sistema (`PILL_TONE`), no inventados.
 */
function tono(status: BookingStatus): PillTone {
  switch (status) {
    case "completed":
      return "green";
    case "refunded":
      // Ámbar y no rojo: un reembolso no es un error, es dinero devuelto.
      return "amber";
    default:
      // `cancelled` y cualquier estado que un día entre en el historial.
      return "neutral";
  }
}

/**
 * La tercera tarjeta del panel del alumno: su historial de reservas, con el
 * mismo lenguaje visual que `TutoresCard` y `SugerenciasCard` — que es lo que
 * pidió el cliente: «uno nuevo que va a replicar el historial de reservas, pero
 * con el diseño que tienen tutores favoritos y empieza aquí».
 *
 * O sea, la misma receta que las otras dos, y a propósito: `PanelCard`, título
 * de 22, un subtítulo que dice de dónde sale la lista, «Ver todas» a la
 * derecha y un `ScrollCarousel` de tarjetas de ancho fijo. Nada nuevo.
 *
 * ⚠️ **NO SE LLAMA «MIS RESERVAS», Y ES DELIBERADO.** «Mis reservas» ya es una
 * cosa en esta app: la entrada del menú y la pantalla `/reservas`, que enseña
 * las reservas VIVAS **y** el historial. Esta tarjeta solo tiene la segunda
 * mitad, así que con ese título estaría escondiendo las mentorías que el alumno
 * tiene agendadas bajo un rótulo que promete todas — justo la confusión que se
 * quiere quitar. Se dice lo que es, como en `TutoresCard` con «favoritos».
 *
 * Las tarjetas son 248 y no los 224 de `TutoresCard` porque aquí hay una línea
 * más (el importe) y el título de una mentoría es bastante más largo que el
 * nombre de un tutor.
 */
export function HistorialCard({
  data,
  timeZone,
}: {
  data: PanelHistorial;
  /** tz IANA del usuario: es server component, sin ella saldría la del servidor (R24-12). */
  timeZone: string;
}) {
  return (
    <PanelCard>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <PanelCardTitle className="text-[22px]">
            Tu historial de reservas
          </PanelCardTitle>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            Lo que ya pasó: mentorías completadas, canceladas y reembolsadas.
            Vuelve a reservar la que te sirvió.
          </p>
        </div>
        <Link
          href="/reservas"
          className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
        >
          Ver todas
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>

      <ScrollCarousel label="Tu historial de reservas" className="mt-4">
        {data.reservas.map((r) => {
          // Reseñar solo tiene sentido si la mentoría se dio y no la reseñó ya
          // (RN-17: una por compra). En lo demás la salida es el detalle, que
          // es donde vive todo lo que se puede hacer con una reserva.
          const puedeResenar = r.status === "completed" && !r.resenada;
          return (
            <li
              key={r.id}
              // Ancho fijo: es lo que crea el recorrido del carrusel.
              className="w-[248px] shrink-0 snap-start"
            >
              <article className="flex h-full flex-col gap-3 rounded-[12px] border border-[#ebebeb] bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  {/* El mismo redondel azul de `BookingRow`: esto sigue siendo
                      una reserva, aunque aquí se pinte como tarjeta. */}
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e0eeff] text-brand">
                    <CalendarDaysIcon className="size-[18px]" />
                  </span>
                  <StatusPill tone={tono(r.status)}>
                    {BOOKING_STATUS_LABEL[r.status]}
                  </StatusPill>
                </div>

                <div className="min-w-0">
                  <Link
                    href={`/reservas/${r.id}`}
                    className="line-clamp-2 text-[13.5px] font-semibold text-[#333333] hover:underline"
                  >
                    {r.titulo}
                  </Link>
                  {r.tutor?.displayName ? (
                    <p className="mt-0.5 truncate text-xs text-[#6b6b6b]">
                      con{" "}
                      {/* V-6 · solo se enlaza si su ficha es legible: a un tutor
                          desaprobado, `/tutors/<id>` le daría un 404 al alumno
                          desde su propio panel. Ver `tutorCards`. */}
                      <Link
                        href={`/tutors/${r.tutor.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {r.tutor.displayName}
                      </Link>
                    </p>
                  ) : null}
                </div>

                <div className="text-xs text-[#6b6b6b]">
                  <p className="first-letter:uppercase">
                    {r.cuando
                      ? formatSessionTime(r.cuando, timeZone)
                      : "Sin horario"}
                  </p>
                  <p className="mt-0.5 font-medium text-[#4d4d4d]">
                    {formatMoney(r.importe, r.moneda)}
                  </p>
                  {r.resenada ? (
                    // Se dice, en vez de una segunda píldora al lado de la del
                    // estado: en 248 px dos píldoras juntas se parten.
                    <p className="mt-0.5">Ya dejaste tu reseña</p>
                  ) : null}
                </div>

                <div className="mt-auto">
                  {puedeResenar ? (
                    <Button
                      asChild
                      className="h-[38px] w-full rounded-[8px] px-4 text-[13px] font-semibold"
                    >
                      <Link href={`/reservas/${r.id}/resena`}>Dejar reseña</Link>
                    </Button>
                  ) : (
                    <Button
                      asChild
                      variant="outline"
                      className="h-[38px] w-full rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
                    >
                      <Link href={`/reservas/${r.id}`}>Ver detalle</Link>
                    </Button>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ScrollCarousel>
    </PanelCard>
  );
}
