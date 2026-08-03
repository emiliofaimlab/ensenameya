import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { getPaymentDetail } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import {
  PanelCard,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { ADMIN_ITEMS } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { PAYMENT_BADGE } from "../../badges";
import { RefundForm } from "./refund-form";

export const metadata = { title: "Detalle de pago · Enséñame Ya" };

const PAYMENT_PILL: Record<string, PillTone> = {
  pending: "amber",
  authorized: "blue",
  paid: "green",
  failed: "red",
  partially_refunded: "red",
  refunded: "red",
};

/** US-1104 · SCR-AD08 — detalle de pago en dos columnas (220:51). */
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
  const logs: { label: string; at: string | null; detail?: string }[] = [
    { at: p.createdAt, label: "Pago creado (pending)" },
    ...(p.paidAt ? [{ at: p.paidAt, label: "Cobrado por el proveedor" }] : []),
    ...(p.failedAt ? [{ at: p.failedAt, label: "Fallido" }] : []),
    ...webhookEvents.map((e) => ({
      at: e.processedAt,
      label: "Webhook procesado",
      detail: e.eventId,
    })),
  ].sort((a, z) => (a.at ?? "").localeCompare(z.at ?? ""));

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <PanelShell
      items={ADMIN_ITEMS}
      back={{ href: "/admin/payments", label: "Volver a pagos" }}
      eyebrow="Pagos / Detalle"
      title={`Pago #${p.id.slice(0, 8)}`}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          {/* Detalle del pago (220:53). */}
          <PanelCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#19191f]">
                Detalle del pago
              </h2>
              <StatusPill
                tone={PAYMENT_PILL[p.status] ?? "neutral"}
                className="h-7"
              >
                {badge.label}
              </StatusPill>
            </div>

            <hr className="my-4 border-[#e0e0e0]" />

            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <Field
                label="Monto bruto"
                value={formatMoney(p.grossAmount, p.currency)}
              />
              <Field
                label={`Comisión (${(100 - p.tierSplitPct).toFixed(0)}%)`}
                value={formatMoney(p.platformFeeAmount, p.currency)}
              />
              <Field
                label="Neto al tutor"
                value={formatMoney(p.tutorNetAmount, p.currency)}
              />
              <Field label="tier_split_pct" value={`${p.tierSplitPct}%`} />
              <Field label="Proveedor" value={p.provider ?? "—"} />
              <Field label="Referencia" value={p.providerPaymentId ?? "—"} />
              <Field
                label="Corredor"
                value={`${p.payerCountry ?? "—"} → ${p.payeeCountry ?? "—"}`}
              />
              <Field label="Producto" value={productTitle} />
              {p.refundedAmount > 0 ? (
                <Field
                  label="Reembolsado"
                  value={formatMoney(p.refundedAmount, p.currency)}
                />
              ) : null}
            </div>
          </PanelCard>

          {/* Logs (220:84). */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">Logs</h2>
            <dl className="mt-2 divide-y divide-[#e0e0e0]">
              {logs.map((l, i) => (
                <div key={`${l.at}-${i}`} className="py-2.5 last:pb-0">
                  <dt className="text-[13px] font-medium text-[#404040]">
                    {l.label}
                  </dt>
                  <dd className="text-xs break-all text-[#6b6b6b]">
                    {l.at ? fmtTime(l.at) : "—"}
                    {l.detail ? ` · ${l.detail}` : ""}
                  </dd>
                </div>
              ))}
              {p.status === "pending" && webhookEvents.length === 0 ? (
                <div className="py-2.5 last:pb-0">
                  <dt className="text-[13px] font-medium text-[#a67314]">
                    Sin webhooks del proveedor
                  </dt>
                  <dd className="text-xs text-[#6b6b6b]">
                    Si el alumno dice que pagó, empieza por aquí.
                  </dd>
                </div>
              ) : null}
            </dl>
          </PanelCard>
        </div>

        <div className="flex flex-col gap-5">
          {/* Acciones (220:102): reembolso manual US-704. */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">Acciones</h2>
            <p className="mt-2 text-xs text-[#6b6b6b]">
              El reembolso lo ejecuta el servidor (US-704) y notifica al alumno
              (NTF-10).
            </p>
            {p.status === "paid" || p.status === "partially_refunded" ? (
              <div className="mt-4">
                <RefundForm
                  paymentId={p.id}
                  currency={p.currency}
                  remaining={p.grossAmount - p.refundedAmount}
                />
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                Este pago no admite reembolso en su estado actual.
              </p>
            )}
          </PanelCard>

          {/* Reserva asociada (220:109). */}
          <PanelCard className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-[#333333]">
                Reserva asociada
              </p>
              <p className="text-xs text-[#6b6b6b]">#{p.bookingId.slice(0, 8)}</p>
            </div>
            <Button
              asChild
              variant="outline"
              className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
            >
              <Link href={`/admin/bookings/${p.bookingId}`}>Ver reserva</Link>
            </Button>
          </PanelCard>
        </div>
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
