import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { getBookingDetail } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOOKING_BADGE, PAYMENT_BADGE } from "../../badges";
import { Timeline, type TimelineEntry } from "../../timeline";

export const metadata = { title: "Detalle de reserva · Enséñame Ya" };

const SESSION_LABEL: Record<string, string> = {
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No-show",
};

/** US-1104 · SCR-AD10 — detalle de reserva con pago, sesiones y traza. */
export default async function AdminBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  const detail = await getBookingDetail(id);
  if (!detail) notFound();

  const { booking: b, productTitle, studentName, tutorName, payment, sessions } = detail;
  const badge = BOOKING_BADGE[b.status];

  const timeline: TimelineEntry[] = [
    { at: b.createdAt, label: "Reserva creada" },
    ...(b.completedAt ? [{ at: b.completedAt, label: "Completada" }] : []),
    ...(b.cancelledAt ? [{ at: b.cancelledAt, label: "Cancelada" }] : []),
  ].sort((a, z) => a.at.localeCompare(z.at));

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title={productTitle}
          description={`${studentName} → ${tutorName}`}
          actions={
            <Button asChild variant="outline">
              <Link href="/admin/bookings">Volver a reservas</Link>
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <Badge variant="outline">
            {b.numSessions} {b.numSessions === 1 ? "sesión" : "sesiones"} de{" "}
            {b.sessionDurationMin} min
          </Badge>
        </div>

        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
          <Field label="Total" value={formatMoney(b.totalAmount, b.currency)} />
          <Field label="Split congelado" value={`${b.tierSplitPct}%`} />
          <Field label="Creada" value={new Date(b.createdAt).toLocaleString("es")} />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Pago asociado</h2>
          {payment ? (
            <Link
              href={`/admin/payments/${payment.id}`}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {formatMoney(payment.grossAmount, b.currency)}
                  {payment.refundedAmount > 0
                    ? ` · reembolsado ${formatMoney(payment.refundedAmount, b.currency)}`
                    : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={PAYMENT_BADGE[payment.status].variant}>
                    {PAYMENT_BADGE[payment.status].label}
                  </Badge>
                  {payment.provider ? (
                    <Badge variant="secondary">{payment.provider}</Badge>
                  ) : null}
                </div>
              </div>
              <span className="shrink-0 text-sm underline underline-offset-4">Ver pago</span>
            </Link>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Esta reserva no tiene pago asociado.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Sesiones ({sessions.length})</h2>
          {sessions.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin sesiones.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {s.sequenceNo ? `#${s.sequenceNo} · ` : ""}
                      {/* UTC en BD → hora local del admin (RN-02). */}
                      {new Date(s.startAt).toLocaleString("es")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      hasta {new Date(s.endAt).toLocaleTimeString("es")}
                    </p>
                  </div>
                  <Badge variant="outline">{SESSION_LABEL[s.status] ?? s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Traza</h2>
          <Timeline entries={timeline} />
        </div>
      </Section>
    </Container>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
