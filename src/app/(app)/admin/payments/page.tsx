import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { listPayments, listPaymentProviders } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { AdminShell } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
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

/**
 * US-1104 · SCR-AD06 (pendientes) + SCR-AD07 (historial) — una sola pantalla:
 * "pendientes" es este listado con el filtro de estado puesto, que es como el
 * propio Doc 5 los agrupa (misma ruta `/admin/payments`).
 * Solo lectura: el reembolso manual es US-704.
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

  // Sumar monedas distintas daría un número sin sentido (RN-13). Con una sola
  // se muestran los totales; con varias se avisa en vez de mentir.
  const single = totals.currencies.length === 1 ? totals.currencies[0] : null;

  return (
    <AdminShell
          title="Pagos"
          description="Cobros, comisiones y reembolsos. Filtra por estado, proveedor, corredor o fecha."
    >

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

        {/* Totales del conjunto filtrado, no solo de esta página. */}
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
          <Total label="Pagos" value={String(totals.count)} />
          {single ? (
            <>
              <Total label="Bruto" value={formatMoney(totals.gross, single)} />
              <Total label="Comisión" value={formatMoney(totals.fee, single)} />
              <Total label="Neto tutores" value={formatMoney(totals.net, single)} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground sm:col-span-3">
              {totals.currencies.length === 0
                ? "Sin pagos que sumar."
                : `Hay ${totals.currencies.length} monedas (${totals.currencies.join(", ")}): filtra por una para ver totales.`}
            </p>
          )}
          {single && totals.refunded > 0 ? (
            <Total label="Reembolsado" value={formatMoney(totals.refunded, single)} />
          ) : null}
        </div>

        {payments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No hay pagos con estos filtros.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payments.map((p) => {
              const b = PAYMENT_BADGE[p.status];
              return (
                <li key={p.id} className="rounded-lg border p-4">
                  <Link
                    href={`/admin/payments/${p.id}`}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.productTitle}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {formatMoney(p.grossAmount, p.currency)} · comisión{" "}
                        {formatMoney(p.platformFeeAmount, p.currency)} · tutor{" "}
                        {formatMoney(p.tutorNetAmount, p.currency)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant={b.variant}>{b.label}</Badge>
                        {p.provider ? <Badge variant="secondary">{p.provider}</Badge> : null}
                        {p.payeeCountry ? <Badge variant="outline">{p.payeeCountry}</Badge> : null}
                        {p.refundedAmount > 0 ? (
                          <Badge variant="outline">
                            −{formatMoney(p.refundedAmount, p.currency)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <time
                      className="shrink-0 text-sm text-muted-foreground"
                      dateTime={p.createdAt}
                    >
                      {new Date(p.createdAt).toLocaleString("es")}
                    </time>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Pager page={page} hasMore={hasMore} hrefFor={pageHref} />
    </AdminShell>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
