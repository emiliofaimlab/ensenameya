import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { getBookingDetail } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { SESSION_STATUS_LABEL } from "@/lib/booking";
import {
  PanelCard,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { BOOKING_BADGE, PAYMENT_BADGE } from "../../badges";

export const metadata = { title: "Detalle de reserva · Enséñame Ya" };

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  completed: "neutral",
  pending_acceptance: "blue",
  pending_payment: "neutral",
  cancelled: "red",
  refunded: "red",
};

/**
 * US-1104 · SCR-AD10 — detalle de reserva en dos columnas (224:51).
 * La tarjeta "Soporte / Cancelar reserva" del Figma pide una cancelación
 * ejecutada por el admin: no existe RPC para eso (cancel_booking exige ser
 * parte de la reserva) — el camino de soporte hoy es el reembolso manual del
 * pago (US-704, en el detalle del pago). No se pinta un botón muerto.
 */
export default async function AdminBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  const detail = await getBookingDetail(id);
  if (!detail) notFound();

  const { booking: b, productTitle, studentName, tutorName, payment, sessions } =
    detail;
  const badge = BOOKING_BADGE[b.status];

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const logs = [
    { at: b.createdAt, label: "Reserva creada" },
    ...(payment?.status === "paid" || payment?.status === "partially_refunded"
      ? [{ at: b.createdAt, label: "Pago capturado" }]
      : []),
    ...(b.completedAt ? [{ at: b.completedAt, label: "Completada" }] : []),
    ...(b.cancelledAt
      ? [
          {
            at: b.cancelledAt,
            // El motivo (decisión 23) es lo primero que pregunta soporte, así
            // que va en la propia línea del log, no escondido en otra tarjeta.
            label: b.cancelReason
              ? `Cancelada — ${b.cancelReason}`
              : "Cancelada",
          },
        ]
      : []),
  ].sort((a, z) => a.at.localeCompare(z.at));

  return (
    <PanelShell
      items={ADMIN_ITEMS}
      back={{ href: "/admin/bookings", label: "Volver a reservas" }}
      eyebrow="Reservas / Detalle"
      title={`Reserva #${b.id.slice(0, 8)}`}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          {/* Detalle de la reserva (224:53). */}
          <PanelCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#19191f]">
                Detalle de la reserva
              </h2>
              <StatusPill
                tone={BOOKING_PILL[b.status] ?? "neutral"}
                className="h-7"
              >
                {badge.label}
              </StatusPill>
            </div>

            <hr className="my-4 border-[#e0e0e0]" />

            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <Field label="Alumno" value={studentName} />
              <Field label="Tutor" value={tutorName} />
              <Field label="Producto" value={productTitle} />
              <Field label="Total" value={formatMoney(b.totalAmount, b.currency)} />
              <Field
                label="Sesiones"
                value={`${sessions.length} de ${b.numSessions} · ${b.sessionDurationMin} min`}
              />
              <Field label="Split congelado" value={`${b.tierSplitPct}%`} />
            </div>

            {sessions.length > 0 ? (
              <>
                <hr className="my-4 border-[#e0e0e0]" />
                <ul className="flex flex-col gap-2.5">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <p className="text-[13px] font-medium text-[#404040] first-letter:uppercase">
                        {s.sequenceNo ? `#${s.sequenceNo} · ` : ""}
                        {fmtTime(s.startAt)}
                      </p>
                      <StatusPill className="h-7">
                        {SESSION_STATUS_LABEL[s.status] ?? s.status}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </PanelCard>

          {/* Pago asociado (224:78). */}
          {payment ? (
            <PanelCard className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-[#333333]">
                  Pago asociado · #{payment.id.slice(0, 8)}
                </p>
                <p className="text-xs text-[#6b6b6b]">
                  {formatMoney(payment.grossAmount, b.currency)}
                  {payment.provider ? ` · ${payment.provider}` : ""} ·{" "}
                  {PAYMENT_BADGE[payment.status].label}
                  {payment.refundedAmount > 0
                    ? ` · reembolsado ${formatMoney(payment.refundedAmount, b.currency)}`
                    : ""}
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
              >
                <Link href={`/admin/payments/${payment.id}`}>Ir al pago</Link>
              </Button>
            </PanelCard>
          ) : (
            <PanelCard>
              <p className="text-[13px] text-[#6b6b6b]">
                Esta reserva no tiene pago asociado.
              </p>
            </PanelCard>
          )}

          {/* Trazas (224:85), derivadas de los timestamps reales. */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">
              Trazas / Logs
            </h2>
            <dl className="mt-2 divide-y divide-[#e0e0e0]">
              {logs.map((l, i) => (
                <div key={`${l.at}-${i}`} className="py-2.5 last:pb-0">
                  <dt className="text-[13px] font-medium text-[#404040]">
                    {l.label}
                  </dt>
                  <dd className="text-xs text-[#6b6b6b]">{fmtTime(l.at)}</dd>
                </div>
              ))}
            </dl>
          </PanelCard>
        </div>

        {/* Soporte (224:103): el camino real es el reembolso del pago. */}
        <PanelCard>
          <h2 className="text-base font-semibold text-[#19191f]">Soporte</h2>
          <p className="mt-2 text-xs text-[#6b6b6b]">
            La intervención de soporte sobre el dinero va por el pago: el
            reembolso manual (total o parcial, US-704) vive en su detalle y
            notifica al alumno (NTF-10).
          </p>
          {payment ? (
            <Button
              asChild
              className="mt-4 h-10 w-full rounded-[8px] font-semibold"
            >
              <Link href={`/admin/payments/${payment.id}`}>
                Gestionar reembolso
              </Link>
            </Button>
          ) : null}
        </PanelCard>
      </div>
    </PanelShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-[#404040] tabular-nums">
        {value}
      </p>
    </div>
  );
}
