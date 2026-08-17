import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { listBookings } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { BOOKING_BADGE } from "./badges";

export const metadata = { title: "Panel admin · Enséñame Ya" };

type Stats = {
  bookings_total: number;
  bookings_paid: number;
  conversion_pct: number;
  active_tutors: number;
  money: { currency: string; gmv: number; commission: number }[];
};

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  completed: "neutral",
  pending_acceptance: "blue",
  pending_payment: "neutral",
  cancelled: "red",
  refunded: "red",
};

/** Últimos 30 días, que es el corte que enseña el Figma ("GMV (mes)"). */
function last30(): { from: string } {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);
  return { from: from.toISOString().slice(0, 10) };
}

/**
 * SCR-AD02 — dashboard del admin: cifras del mes, las colas que piden acción
 * y las reservas recientes. Es la nueva home de `/admin`; la cola de tutores
 * vive en /admin/tutores y las estadísticas completas en /admin/stats.
 */
export default async function AdminDashboardPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [
    { data: statsData },
    { count: pendingTutors },
    { count: pendingPayments },
    { count: pendingEmails },
    { count: pendingRefunds },
    recent,
  ] = await Promise.all([
    supabase.rpc("admin_stats", { p_from: last30().from }),
    supabase
      .from("tutor_profiles")
      .select("profile_id", { count: "exact", head: true })
      .eq("approval_status", "pending"),
    supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "authorized"]),
    // RV-04b · las dos colas que hasta hoy solo se veían por SQL. Van aquí
    // porque el dashboard es la única puerta que tienen: sus entradas de menú
    // viven en `components/layout/app-sidebar.tsx`, que no es de este carril.
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("refund_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    listBookings({ page: 1 }),
  ]);

  const stats = statsData as unknown as Stats;
  // Una sola moneda en el MVP; con varias se enseña la primera y el resto
  // vive en /admin/stats, que ya separa por moneda (RN-13).
  const money = stats.money[0];

  const queues = [
    {
      label: "Tutores por aprobar",
      value: pendingTutors ?? 0,
      href: "/admin/tutores",
      cta: "Revisar",
    },
    {
      label: "Pagos en proceso",
      value: pendingPayments ?? 0,
      href: "/admin/payments?status=pending",
      cta: "Ver pagos",
    },
    {
      label: "Incidencias abiertas",
      value: null, // se derivan en /admin/alertas; aquí solo el acceso
      href: "/admin/alertas",
      cta: "Ver alertas",
    },
    {
      // Dinero ya prometido al alumno que todavía no ha salido de la cuenta
      // (X-01). Es la cola más urgente de las cinco: las demás retrasan trabajo,
      // esta incumple los Términos §13 mientras siga sin bajar.
      label: "Reembolsos sin ejecutar",
      value: pendingRefunds ?? 0,
      href: "/admin/reembolsos?status=pending",
      cta: "Ver reembolsos",
    },
    {
      label: "Correos en cola",
      value: pendingEmails ?? 0,
      href: "/admin/notificaciones?status=pending",
      cta: "Ver la cola",
    },
  ];

  return (
    <AdminShell title="Dashboard" description="Resumen general de la plataforma.">
      {/* Cifras del mes (218:1773). */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="GMV (mes)"
          value={money ? formatMoney(money.gmv, money.currency) : "—"}
        />
        <Stat
          label="Comisiones"
          value={money ? formatMoney(money.commission, money.currency) : "—"}
        />
        <Stat label="Reservas" value={String(stats.bookings_total)} />
        <Stat label="Tutores activos" value={String(stats.active_tutors)} />
      </div>

      {/* Colas de trabajo (218:1786): lo que espera una acción del admin.
          Eran tres; con las dos de operaciones (reembolsos y correos) la
          rejilla pasa a 2/3 columnas para que no quede una fila coja. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {queues.map((q) => (
          <PanelCard key={q.label} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-[#6b6b6b]">{q.label}</p>
                <p className="mt-1 text-[22px] font-bold text-[#19191f]">
                  {q.value ?? "→"}
                </p>
              </div>
              {q.value ? (
                <StatusPill tone="amber">
                  Cola
                </StatusPill>
              ) : null}
            </div>
            <Button
              asChild
              className="mt-3 h-[38px] rounded-[8px] bg-brand px-4 text-[13.5px] font-semibold hover:bg-brand/90"
            >
              <Link href={q.href}>{q.cta}</Link>
            </Button>
          </PanelCard>
        ))}
      </div>

      {/* RV-20: no es una cola, es una herramienta, y no tiene entrada de menú
          propia. Sin este enlace no se llega a ella desde ninguna parte. */}
      <p className="text-[13px] text-[#6b6b6b]">
        ¿Comprobando el vencimiento de las 24 h de aceptación?{" "}
        <Link
          href="/admin/operaciones"
          className="font-semibold text-brand hover:underline"
        >
          Vencer reservas caducadas
        </Link>{" "}
        lo dispara a mano, sin esperar al cron.
      </p>

      {/* Reservas recientes (218:1814). */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Reservas recientes
        </h2>
        {recent.bookings.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#6b6b6b]">Aún no hay reservas.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {recent.bookings.slice(0, 4).map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3.5 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-[#333333]">
                    {b.studentName} → {b.tutorName}
                  </p>
                  <p className="text-xs text-[#6b6b6b]">
                    {b.productTitle} ·{" "}
                    {new Date(b.createdAt).toLocaleDateString("es", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3.5">
                  <StatusPill
                    tone={BOOKING_PILL[b.status] ?? "neutral"}
                  >
                    {BOOKING_BADGE[b.status].label}
                  </StatusPill>
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="text-[13px] font-medium text-brand hover:underline"
                  >
                    Ver →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </AdminShell>
  );
}

/** Tarjeta de cifra (218:1774): label 12 gris + valor 24/700. */
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
