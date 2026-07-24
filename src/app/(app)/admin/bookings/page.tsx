import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { listBookings } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
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

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  completed: "neutral",
  pending_acceptance: "blue",
  pending_payment: "neutral",
  cancelled: "red",
  refunded: "red",
};

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
      description={`Todas las reservas de la plataforma · ${count} con los filtros actuales.`}
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
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay reservas con estos filtros.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {bookings.map((b) => {
              const badge = BOOKING_BADGE[b.status];
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 sm:w-96">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      #{b.id.slice(0, 8)} · {b.studentName} → {b.tutorName}
                    </p>
                    <p className="truncate text-xs text-[#6b6b6b]">
                      {b.productTitle} · {formatMoney(b.totalAmount, b.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11.5px] text-[#6b6b6b]">Fecha</p>
                    <p className="text-[13px] font-medium text-[#404040]">
                      {new Date(b.createdAt).toLocaleDateString("es", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      ·{" "}
                      {new Date(b.createdAt).toLocaleTimeString("es", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill
                      tone={BOOKING_PILL[b.status] ?? "neutral"}
                      className="h-7"
                    >
                      {badge.label}
                    </StatusPill>
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/admin/bookings/${b.id}`}>Ver</Link>
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
