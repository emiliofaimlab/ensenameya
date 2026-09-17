"use client";

import Link from "next/link";

import type { BookingDetail } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { Bloque, Dato, FichaModal } from "../ficha-modal";
import { BOOKING_BADGE } from "../badges";

const TONO: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  completed: "neutral",
  pending_acceptance: "blue",
  pending_payment: "neutral",
  cancelled: "red",
  refunded: "red",
};

const TONO_SESION: Record<string, PillTone> = {
  completed: "green",
  scheduled: "blue",
  in_progress: "green",
  cancelled: "red",
  no_show: "amber",
};

/**
 * La ficha de una reserva, en un diálogo.
 *
 * ⚠️ ENSEÑA LO MISMO QUE `/admin/bookings/[id]` (SCR-AD10) porque sale de la
 * MISMA función, `getBookingDetail`. Y esa duplicación es CONSCIENTE: aquella
 * pantalla es de solo lectura —su propio comentario explica que no pinta el
 * botón de cancelar porque no hay RPC para que el admin cancele—, así que este
 * modal la hace redundante para quien llega desde la lista. No se ha borrado
 * porque su URL es enlazable y se llega a ella desde el dashboard; el día que
 * se retire, el enlace de abajo es lo único que hay que quitar.
 */
export function FichaReserva({ id, ref_ }: { id: string; ref_: string }) {
  const fecha = (iso: string | null, conHora = false) =>
    iso
      ? new Date(iso).toLocaleString("es", {
          day: "numeric",
          month: "short",
          year: "numeric",
          ...(conHora ? { hour: "2-digit", minute: "2-digit" } : {}),
        })
      : "—";

  return (
    <FichaModal<BookingDetail>
      titulo={`Reserva ${ref_}`}
      descripcion={
        <>
          Ficha interna de solo lectura.{" "}
          <Link
            href={`/admin/bookings/${id}`}
            className="text-brand hover:underline"
          >
            Abrirla en su propia página
          </Link>
          .
        </>
      }
      url={`/api/admin/detalle?tipo=reserva&id=${id}`}
    >
      {(d) => (
        <>
          <Bloque titulo="Qué se reservó">
            <Dato etiqueta="Mentoría" valor={d.productTitle} ancho />
            <Dato etiqueta="Alumno" valor={d.studentName} />
            <Dato etiqueta="Tutor" valor={d.tutorName} />
            <Dato
              etiqueta="Sesiones"
              valor={`${d.booking.numSessions} × ${d.booking.sessionDurationMin} min`}
            />
            <Dato etiqueta="Creada" valor={fecha(d.booking.createdAt, true)} />
          </Bloque>

          <Bloque titulo="Estado">
            <div className="col-span-full flex flex-wrap items-center gap-2">
              <StatusPill tone={TONO[d.booking.status] ?? "neutral"}>
                {BOOKING_BADGE[d.booking.status]?.label ?? d.booking.status}
              </StatusPill>
            </div>
            <Dato etiqueta="Completada" valor={fecha(d.booking.completedAt)} />
            <Dato etiqueta="Cancelada" valor={fecha(d.booking.cancelledAt)} />
            {d.booking.cancelReason ? (
              <Dato
                etiqueta="Motivo de cancelación"
                valor={d.booking.cancelReason}
                ancho
                // Solo lo hay si canceló una PERSONA desde AL07; si canceló el
                // cron o el tutor, la columna viene vacía y eso también informa.
                nota="Solo lo escriben quienes cancelan desde su panel."
              />
            ) : null}
          </Bloque>

          <Bloque titulo="Dinero">
            <Dato
              etiqueta="Total de la reserva"
              valor={formatMoney(d.booking.totalAmount, d.booking.currency)}
            />
            <Dato
              etiqueta="Reparto del tutor"
              valor={`${d.booking.tierSplitPct} %`}
              nota="El tier con el que nació esta reserva."
            />
            {d.payment ? (
              <>
                <Dato
                  etiqueta="Cobrado"
                  valor={formatMoney(d.payment.grossAmount, d.booking.currency)}
                />
                <Dato
                  etiqueta="Devuelto"
                  valor={
                    d.payment.refundedAmount
                      ? formatMoney(d.payment.refundedAmount, d.booking.currency)
                      : "—"
                  }
                />
                <Dato etiqueta="Pasarela" valor={d.payment.provider ?? "—"} />
                <div className="min-w-0">
                  <p className="text-[11.5px] text-[#6b6b6b]">Pago</p>
                  <Link
                    href={`/admin/payments/${d.payment.id}`}
                    className="truncate text-[13px] font-medium text-brand hover:underline"
                  >
                    {d.payment.status} · ver el pago
                  </Link>
                </div>
              </>
            ) : (
              <Dato
                etiqueta="Pago"
                valor="Sin pago asociado"
                ancho
                nota="Una reserva sin pago está en pending_payment o se canceló antes de cobrar."
              />
            )}
          </Bloque>

          <Bloque titulo={`Sesiones (${d.sessions.length})`}>
            {d.sessions.length === 0 ? (
              <p className="col-span-full text-[13px] text-[#6b6b6b]">
                Todavía no hay sesiones con horario.
              </p>
            ) : (
              <ul className="col-span-full flex flex-col gap-2">
                {d.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e0e0e0] px-3 py-2"
                  >
                    <span className="text-[13px] text-[#404040]">
                      {s.sequenceNo ? `#${s.sequenceNo} · ` : ""}
                      {fecha(s.startAt, true)}
                    </span>
                    <StatusPill tone={TONO_SESION[s.status] ?? "neutral"}>
                      {s.status}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>
        </>
      )}
    </FichaModal>
  );
}
