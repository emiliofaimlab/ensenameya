import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { listPayments, listPaymentProviders } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/catalog/pager";
import { PAYMENT_BADGE } from "../badges";
import { AdminFilters } from "./filters";

export const metadata = { title: "Pagos · Enséñame Ya" };

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "authorized", label: "Autorizado" },
  { value: "paid", label: "Pagado" },
  { value: "failed", label: "Fallido" },
  { value: "partially_refunded", label: "Reembolso parcial" },
  { value: "refunded", label: "Reembolsado" },
];

/** Píldoras del Figma (219:90/103/116/129). */
const PAYMENT_PILL: Record<string, PillTone> = {
  pending: "amber",
  authorized: "blue",
  paid: "green",
  failed: "red",
  partially_refunded: "red",
  refunded: "red",
};

/**
 * US-1104 · SCR-AD06 (en proceso) + SCR-AD07 (histórico) — una sola pantalla
 * con chips, como el propio Figma la dibuja (219:51). Solo lectura: el
 * reembolso manual es US-704 y vive en el detalle.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    provider?: string;
    country?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ payments, hasMore, totals }, providers] = await Promise.all([
    listPayments({ ...sp, page }),
    listPaymentProviders(),
  ]);

  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") p.set(k, v);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/admin/payments?${q}` : "/admin/payments";
  };

  // Sumar monedas distintas daría un número sin sentido (RN-13).
  const single = totals.currencies.length === 1 ? totals.currencies[0] : null;
  const inProcess = sp.status === "pending" || sp.status === "authorized";

  return (
    <AdminShell
      title="Pagos"
      description="En proceso e histórico (misma vista, AD06/AD07)."
    >
      {/* Chips (219:51): "En proceso" filtra pendientes; "Histórico", todo. */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/payments?status=pending"
          className={cn(
            "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
            inProcess
              ? "border-brand bg-brand font-semibold text-white"
              : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
          )}
        >
          En proceso
        </Link>
        <Link
          href="/admin/payments"
          className={cn(
            "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
            !inProcess && !sp.status
              ? "border-brand bg-brand font-semibold text-white"
              : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
          )}
        >
          Histórico
        </Link>
      </div>

      <AdminFilters
        basePath="/admin/payments"
        fields={[
          { name: "status", label: "Estado", type: "select", options: STATUS_OPTIONS },
          {
            name: "provider",
            label: "Proveedor",
            type: "select",
            options: providers.map((p) => ({ value: p, label: p })),
          },
          {
            name: "country",
            label: "Corredor (país de cobro)",
            type: "select",
            options: [{ value: "VE", label: "VE" }],
          },
          { name: "from", label: "Desde", type: "date" },
          { name: "to", label: "Hasta", type: "date" },
        ]}
      />

      {/* Totales del conjunto filtrado (219:71), no solo de esta página. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pagos" value={String(totals.count)} />
        {single ? (
          <>
            <Stat label="Bruto" value={formatMoney(totals.gross, single)} />
            <Stat label="Comisión" value={formatMoney(totals.fee, single)} />
            <Stat
              label={totals.refunded > 0 ? "Reembolsado" : "Neto tutores"}
              value={
                totals.refunded > 0
                  ? formatMoney(totals.refunded, single)
                  : formatMoney(totals.net, single)
              }
            />
          </>
        ) : (
          <PanelCard className="p-5 sm:col-span-3">
            <p className="text-[13px] text-[#6b6b6b]">
              {totals.currencies.length === 0
                ? "Sin pagos que sumar."
                : `Hay ${totals.currencies.length} monedas (${totals.currencies.join(", ")}): filtra por una para ver totales.`}
            </p>
          </PanelCard>
        )}
      </div>

      {payments.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay pagos con estos filtros.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {payments.map((p) => {
              const b = PAYMENT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 sm:w-80">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      #{p.id.slice(0, 8)} · {formatMoney(p.grossAmount, p.currency)}
                    </p>
                    <p className="truncate text-xs text-[#6b6b6b]">
                      {p.productTitle}
                      {p.refundedAmount > 0
                        ? ` · reembolsado ${formatMoney(p.refundedAmount, p.currency)}`
                        : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11.5px] text-[#6b6b6b]">Proveedor</p>
                    <p className="text-[13px] font-medium text-[#404040]">
                      {p.provider ?? "—"}
                      {p.payeeCountry ? ` · ${p.payeeCountry}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill
                      tone={PAYMENT_PILL[p.status] ?? "neutral"}
                      className="h-7"
                    >
                      {b.label}
                    </StatusPill>
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/admin/payments/${p.id}`}>Ver</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}

      <Pager page={page} hasMore={hasMore} hrefFor={pageHref} />
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
        {value}
      </p>
    </PanelCard>
  );
}
