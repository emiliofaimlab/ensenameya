"use client";

import Link from "next/link";

import type { PaymentDetail } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { Bloque, Dato, FichaModal } from "../ficha-modal";
import { PAYMENT_BADGE } from "../badges";

const TONO: Record<string, PillTone> = {
  paid: "green",
  pending: "amber",
  authorized: "blue",
  failed: "red",
  refunded: "red",
  partially_refunded: "amber",
};

/**
 * La ficha de un pago, en un diálogo.
 *
 * ⚠️ NO DUPLICA `/admin/payments/[id]` (SCR-AD08), al revés que su gemela de
 * reservas: aquella pantalla tiene el REEMBOLSO MANUAL (US-704) y la traza de
 * eventos del webhook. Esto es para mirar; para devolver dinero se va allí, que
 * es donde esa acción queda registrada. Por eso el enlace de la cabecera no es
 * un adorno: es la única vía.
 *
 * Los datos salen de `getPaymentDetail`, la misma función que pinta aquella
 * pantalla, así que las dos no pueden decir cosas distintas.
 */
export function FichaPago({ id, corto }: { id: string; corto: string }) {
  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("es", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  return (
    <FichaModal<PaymentDetail>
      titulo={`Pago #${corto}`}
      descripcion={
        <>
          Ficha interna de solo lectura. Para reembolsar o ver la traza del
          webhook,{" "}
          <Link
            href={`/admin/payments/${id}`}
            className="text-brand hover:underline"
          >
            abrir el pago
          </Link>
          .
        </>
      }
      url={`/api/admin/detalle?tipo=pago&id=${id}`}
    >
      {(d) => {
        const m = (v: number) => formatMoney(v, d.payment.currency);
        return (
          <>
            <Bloque titulo="Qué se pagó">
              <Dato etiqueta="Mentoría" valor={d.productTitle} ancho />
              <div className="col-span-full flex flex-wrap items-center gap-2">
                <StatusPill tone={TONO[d.payment.status] ?? "neutral"}>
                  {PAYMENT_BADGE[d.payment.status]?.label ?? d.payment.status}
                </StatusPill>
              </div>
              <div className="min-w-0">
                <p className="text-[11.5px] text-[#6b6b6b]">Reserva</p>
                <Link
                  href={`/admin/bookings/${d.payment.bookingId}`}
                  className="truncate text-[13px] font-medium text-brand hover:underline"
                >
                  ver la reserva
                </Link>
              </div>
            </Bloque>

            <Bloque titulo="El reparto">
              <Dato
                etiqueta="Bruto"
                valor={m(d.payment.grossAmount)}
                nota="Lo que pagó el alumno, cargo por servicio incluido."
              />
              <Dato etiqueta="Le toca al tutor" valor={m(d.payment.tutorNetAmount)} />
              <Dato etiqueta="Comisión" valor={m(d.payment.platformFeeAmount)} />
              {/* ⚠️ La cuarta cifra. Desde el 16-sep el invariante es
                  `bruto = comisión + neto + cargo`, no los tres primeros: quien
                  intente cuadrar sin esta columna se vuelve loco. */}
              <Dato
                etiqueta="Cargo por servicio"
                valor={`${m(d.payment.serviceFeeAmount)}${
                  d.payment.serviceFeePct ? ` · ${d.payment.serviceFeePct} %` : ""
                }`}
                nota={
                  d.payment.serviceFeePct
                    ? "Lo paga el alumno y va dentro del bruto."
                    : "En 0: este pago es anterior al 16-sep."
                }
              />
              <Dato etiqueta="Reparto del tier" valor={`${d.payment.tierSplitPct} %`} />
              <Dato
                etiqueta="Devuelto"
                valor={d.payment.refundedAmount ? m(d.payment.refundedAmount) : "—"}
              />
            </Bloque>

            <Bloque titulo="La pasarela">
              <Dato etiqueta="Proveedor" valor={d.payment.provider ?? "—"} />
              <Dato
                etiqueta="País del pagador"
                valor={d.payment.payerCountry ?? "—"}
                nota="Es lo que decidió por dónde se cobró."
              />
              <Dato etiqueta="País del cobro al tutor" valor={d.payment.payeeCountry ?? "—"} />
              <Dato
                etiqueta="Referencia del proveedor"
                valor={d.payment.providerPaymentId ?? "—"}
                copiable
                ancho
                nota="La que hay que buscar en el panel de la pasarela."
              />
            </Bloque>

            <Bloque titulo="Cuándo">
              <Dato etiqueta="Creado" valor={fecha(d.payment.createdAt)} />
              <Dato etiqueta="Pagado" valor={fecha(d.payment.paidAt)} />
              <Dato etiqueta="Fallido" valor={fecha(d.payment.failedAt)} />
              <Dato
                etiqueta="Eventos del webhook"
                valor={
                  d.webhookEvents.length
                    ? `${d.webhookEvents.length} procesados`
                    : "Ninguno"
                }
                nota="El detalle está en la página del pago."
              />
            </Bloque>
          </>
        );
      }}
    </FichaModal>
  );
}
