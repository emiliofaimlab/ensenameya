import { notFound, redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, tutorNames } from "@/lib/booking";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { PanelShell } from "@/components/layout/panel-shell";
import { CancelForm } from "./cancel-form";
import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

const CANCELLABLE = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
]);

export const metadata = { title: "Cancelar reserva · Enséñame Ya" };

/** Días/horas hasta un instante, redondeado hacia abajo, nunca negativo. */
function timeUntil(iso: string): { ms: number; label: string } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { ms: 0, label: "Ya empezó" };
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return { ms, label: `Faltan ${days} día${days === 1 ? "" : "s"}` };
  const hours = Math.floor(ms / 3_600_000);
  return { ms, label: `Faltan ${hours} h` };
}

/**
 * SCR-AL07 — cancelar reserva, como página (antes era un `window.confirm()`).
 * Muestra la política, la estimación de reembolso (RN-37) y el motivo. El
 * cálculo es informativo: `cancel_booking` lo recalcula server-side y manda.
 */
export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, num_sessions, products(title, tutor_id), sessions(start_at, status)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();
  // Ya no cancelable → al detalle (no tiene sentido esta pantalla).
  if (!CANCELLABLE.has(booking.status)) redirect(`/reservas/${id}`);

  const names = await tutorNames(supabase, [booking.products?.tutor_id]);
  const tutor = names.get(booking.products?.tutor_id ?? "");

  // RN-37 sobre la sesión agendada más próxima (igual que `cancel_booking`).
  const next = [...(booking.sessions ?? [])]
    .filter((s) => s.status === "scheduled")
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const until = next ? timeUntil(next.start_at) : null;
  const early = !until || until.ms >= P.cutoffHours * 3_600_000;
  const pct = early ? P.refundPct.studentEarly : P.refundPct.studentLate;
  const refund = Math.round((booking.total_amount * pct) / 100);
  const remaining = (booking.sessions ?? []).filter(
    (s) => s.status === "scheduled",
  ).length;

  return (
    <PanelShell back={{ href: `/reservas/${id}`, label: "Volver al detalle" }}>
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#19191f]">
          Cancelar reserva
        </h1>
        <p className="mt-1 text-sm text-[#6b6b6b]">
          {tutor ? `${booking.products?.title} · con ${tutor}. ` : ""}
          Revisa la política antes de confirmar. El reembolso depende de cuánto
          falte para tu próxima sesión.
        </p>
      </div>

      <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-5">
        <h2 className="text-base font-semibold text-[#19191f]">
          Política de cancelación
        </h2>
        <div className="mt-3.5 flex items-center justify-between gap-4">
          <p className="text-[13px] text-[#4d4d4d]">
            Cancelas con {P.cutoffHours} h o más de anticipación
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#333333]">
              Reembolso {P.refundPct.studentEarly} %
            </span>
            {early ? (
              <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white">
                Tu caso
              </span>
            ) : null}
          </div>
        </div>
        <hr className="my-3.5 border-[#e0e0e0]" />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-[#6b6b6b]">Cancelas con menos de {P.cutoffHours} h</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#6b6b6b]">
              Reembolso {P.refundPct.studentLate} %
            </span>
            {!early ? (
              <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white">
                Tu caso
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-5">
        <h2 className="text-base font-semibold text-[#19191f]">
          Resultado estimado
        </h2>
        <dl className="mt-3.5 flex flex-col gap-2.5 text-[13px]">
          {next ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[#6b6b6b]">Próxima sesión</dt>
              <dd className="font-medium text-[#333333] first-letter:uppercase">
                {formatSessionTime(next.start_at, tz)}
              </dd>
            </div>
          ) : null}
          {until ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[#6b6b6b]">Tiempo restante</dt>
              <dd className="font-medium text-[#333333]">{until.label}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-[#6b6b6b]">Sesiones a cancelar</dt>
            <dd className="font-medium text-[#333333]">
              {remaining} de {booking.num_sessions}
              {remaining === booking.num_sessions && booking.num_sessions > 1
                ? " (paquete completo)"
                : ""}
            </dd>
          </div>
        </dl>
        <div className="mt-3.5 flex items-baseline justify-between border-t border-[#e0e0e0] pt-3.5">
          <span className="text-sm text-[#6b6b6b]">Total a reembolsar</span>
          <span className="text-lg font-bold text-brand">
            {formatMoney(refund, booking.currency)}
          </span>
        </div>
        <p className="mt-2 text-xs text-[#6b6b6b]">
          Estimación según la política. El importe final lo confirma el sistema
          al cancelar.
        </p>
      </section>

      <CancelForm bookingId={booking.id} />

      <p className="flex items-center gap-2 text-xs text-[#bf3333]">
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        Esta acción no se puede deshacer.
      </p>
    </PanelShell>
  );
}
