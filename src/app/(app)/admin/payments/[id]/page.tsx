import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { getPaymentDetail } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { AdminShell } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PAYMENT_BADGE } from "../../badges";
import { Timeline, type TimelineEntry } from "../../timeline";
import { RefundForm } from "./refund-form";

export const metadata = { title: "Detalle de pago · Enséñame Ya" };

/** US-1104 · SCR-AD08 — detalle de pago. El reembolso llega con US-704. */
export default async function AdminPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  const detail = await getPaymentDetail(id);
  if (!detail) notFound();

  const { payment: p, productTitle, webhookEvents } = detail;
  const badge = PAYMENT_BADGE[p.status];

  // "Logs básicos" (AC) sin tabla de auditoría: la traza se deriva de los
  // timestamps que el propio pago ya guarda + los eventos del proveedor.
  const timeline: TimelineEntry[] = [
    { at: p.createdAt, label: "Pago creado", detail: "Reserva iniciada, a la espera de cobro." },
    ...(p.paidAt ? [{ at: p.paidAt, label: "Cobrado", detail: "El proveedor confirmó el pago." }] : []),
    ...(p.failedAt ? [{ at: p.failedAt, label: "Fallido", detail: "El cobro no prosperó." }] : []),
    ...webhookEvents.map((e) => ({
      at: e.processedAt,
      label: "Webhook procesado",
      detail: e.eventId,
    })),
  ].sort((a, z) => a.at.localeCompare(z.at));

  return (
    <AdminShell
          title={productTitle}
          description={`Pago ${p.id.slice(0, 8)}…`}
          actions={
            <Button asChild variant="outline">
              <Link href="/admin/payments">Volver a pagos</Link>
            </Button>
          }
    >

        <div className="flex flex-wrap gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {p.provider ? <Badge variant="secondary">{p.provider}</Badge> : null}
          <Badge variant="outline">
            corredor {p.payerCountry ?? "—"} → {p.payeeCountry ?? "—"}
          </Badge>
        </div>

        {/* El desglose con el split que se congeló al reservar (S-08). */}
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
          <Field label="Bruto (alumno)" value={formatMoney(p.grossAmount, p.currency)} />
          <Field
            label={`Comisión (${(100 - p.tierSplitPct).toFixed(2)}%)`}
            value={formatMoney(p.platformFeeAmount, p.currency)}
          />
          <Field
            label={`Neto tutor (${p.tierSplitPct.toFixed(2)}%)`}
            value={formatMoney(p.tutorNetAmount, p.currency)}
          />
          <Field
            label="Reembolsado"
            value={p.refundedAmount > 0 ? formatMoney(p.refundedAmount, p.currency) : "—"}
          />
        </div>

        {/* US-704 — reembolso manual (total/parcial), solo si el pago está cobrado. */}
        {p.status === "paid" || p.status === "partially_refunded" ? (
          <RefundForm
            paymentId={p.id}
            currency={p.currency}
            remaining={p.grossAmount - p.refundedAmount}
          />
        ) : null}

        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Field label="Referencia del proveedor" value={p.providerPaymentId ?? "—"} />
          <Field label="Split congelado" value={`${p.tierSplitPct}%`} />
          <Field label="Reserva" value={p.bookingId.slice(0, 8) + "…"} />
          <div>
            <p className="text-xs text-muted-foreground">Ver reserva</p>
            <Link
              href={`/admin/bookings/${p.bookingId}`}
              className="text-sm underline underline-offset-4"
            >
              Abrir detalle de la reserva
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Traza</h2>
          <Timeline entries={timeline} />
          {p.status === "pending" && webhookEvents.length === 0 ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              Pendiente y sin ningún webhook registrado: el proveedor no ha
              confirmado nada todavía. Si el alumno dice que pagó, empieza por aquí.
            </p>
          ) : null}
        </div>
    </AdminShell>
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
