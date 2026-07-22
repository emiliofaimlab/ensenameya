import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { listBookings } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { AdminShell } from "@/components/layout/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/catalog/pager";
import { BOOKING_BADGE } from "../badges";
import { AdminFilters } from "../payments/filters";

export const metadata = { title: "Reservas · Enséñame Ya" };

const STATUS_OPTIONS = [
  { value: "pending_payment", label: "Esperando pago" },
  { value: "pending_acceptance", label: "Esperando al tutor" },
  { value: "confirmed", label: "Confirmada" },
  { value: "in_progress", label: "En curso" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
  { value: "refunded", label: "Reembolsada" },
];

/** US-1104 · SCR-AD09 — reservas con filtros. Solo lectura (soporte). */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; page?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const { bookings, hasMore, count } = await listBookings({ ...sp, page });

  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") p.set(k, v);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/admin/bookings?${q}` : "/admin/bookings";
  };

  return (
    <AdminShell
          title="Reservas"
          description={`${count} ${count === 1 ? "reserva" : "reservas"} con los filtros actuales.`}
    >

        <AdminFilters
          basePath="/admin/bookings"
          fields={[
            { name: "status", label: "Estado", type: "select", options: STATUS_OPTIONS },
            { name: "from", label: "Desde", type: "date" },
            { name: "to", label: "Hasta", type: "date" },
          ]}
        />

        {bookings.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No hay reservas con estos filtros.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {bookings.map((b) => {
              const badge = BOOKING_BADGE[b.status];
              return (
                <li key={b.id} className="rounded-lg border p-4">
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.productTitle}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {b.studentName} → {b.tutorName} ·{" "}
                        {formatMoney(b.totalAmount, b.currency)}
                      </p>
                      <Badge variant={badge.variant} className="mt-2">
                        {badge.label}
                      </Badge>
                    </div>
                    <time className="shrink-0 text-sm text-muted-foreground" dateTime={b.createdAt}>
                      {new Date(b.createdAt).toLocaleString("es")}
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
