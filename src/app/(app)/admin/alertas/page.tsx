import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Alertas · Enséñame Ya" };

type Severity = "alta" | "media" | "baja";
type Alert = {
  kind: "pago" | "payout" | "cancelacion";
  severity: Severity;
  title: string;
  detail: string;
  href: string;
  at: string;
};

const SEVERITY_PILL: Record<Severity, { label: string; tone: PillTone }> = {
  alta: { label: "Alta", tone: "red" },
  media: { label: "Media", tone: "amber" },
  baja: { label: "Baja", tone: "neutral" },
};

const FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "pago", label: "Pagos" },
  { id: "payout", label: "Payouts" },
  { id: "cancelacion", label: "Cancelaciones" },
] as const;

/**
 * SCR-AD14 — alertas/incidencias, DERIVADAS de los datos reales: pagos
 * fallidos, payouts en problema y cancelaciones recientes. No hay tabla de
 * incidencias, así que el "Marcar atendida" del Figma no existe todavía — la
 * alerta desaparece cuando el dato subyacente se resuelve (reintento, release,
 * etc.). Las "disputas" del Figma llegan con el PSP real (EP-20).
 */
export default async function AdminAlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  await requireRole("admin");
  const { f } = await searchParams;
  const filter = FILTERS.find((x) => x.id === f)?.id ?? "todas";

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceIso = since.toISOString();

  const supabase = await createClient();
  const [{ data: failedPayments }, { data: problemPayouts }, { data: cancelled }] =
    await Promise.all([
      supabase
        .from("payments")
        .select("id, gross_amount, currency, failed_at, created_at")
        .eq("status", "failed")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("payouts")
        .select("id, amount, currency, status, failure_reason, created_at, profiles(full_name)")
        .in("status", ["failed", "on_hold"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("bookings")
        .select("id, total_amount, currency, cancelled_at, products(title)")
        .eq("status", "cancelled")
        .gte("cancelled_at", sinceIso)
        .order("cancelled_at", { ascending: false })
        .limit(20),
    ]);

  const alerts: Alert[] = [
    ...(failedPayments ?? []).map(
      (p): Alert => ({
        kind: "pago",
        severity: "alta",
        title: `Falla de pago en #${p.id.slice(0, 8)}`,
        detail: `El cobro de ${formatMoney(p.gross_amount, p.currency)} no prosperó`,
        href: `/admin/payments/${p.id}`,
        at: p.failed_at ?? p.created_at,
      }),
    ),
    ...(problemPayouts ?? []).map(
      (p): Alert => ({
        kind: "payout",
        severity: p.status === "on_hold" ? "alta" : "media",
        title: `Payout ${p.status === "on_hold" ? "en on_hold" : "fallido"} #${p.id.slice(0, 8)}`,
        detail:
          p.failure_reason ??
          `${p.profiles?.full_name ?? "Tutor"} · ${formatMoney(p.amount, p.currency)}`,
        href: "/admin/payouts",
        at: p.created_at,
      }),
    ),
    ...(cancelled ?? []).map(
      (b): Alert => ({
        kind: "cancelacion",
        severity: "baja",
        title: `Cancelación #${b.id.slice(0, 8)}`,
        detail: `${b.products?.title ?? "Clase"} · ${formatMoney(b.total_amount, b.currency)}`,
        href: `/admin/bookings/${b.id}`,
        at: b.cancelled_at ?? "",
      }),
    ),
  ]
    .sort((a, z) => z.at.localeCompare(a.at))
    .filter((a) => filter === "todas" || a.kind === filter);

  return (
    <AdminShell
      title="Alertas / Incidencias"
      description="Fallas de pago, cancelaciones y payouts en problema (últimos 30 días), derivadas de los datos reales."
    >
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((x) => {
          const on = x.id === filter;
          return (
            <Link
              key={x.id}
              href={x.id === "todas" ? "/admin/alertas" : `/admin/alertas?f=${x.id}`}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
                on
                  ? "border-brand bg-brand font-semibold text-white"
                  : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
              )}
            >
              {x.label}
            </Link>
          );
        })}
      </div>

      {alerts.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Sin incidencias {filter === "todas" ? "" : "de este tipo "}en los
            últimos 30 días. 🎉
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {alerts.map((a, i) => {
              const pill = SEVERITY_PILL[a.severity];
              return (
                <li
                  key={`${a.href}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <StatusPill tone={pill.tone} className="h-7 shrink-0">
                      {pill.label}
                    </StatusPill>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                        {a.title}
                      </p>
                      <p className="truncate text-xs text-[#6b6b6b]">
                        {a.detail}
                        {a.at
                          ? ` · ${new Date(a.at).toLocaleDateString("es", {
                              day: "numeric",
                              month: "short",
                            })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                  >
                    <Link href={a.href}>Abrir</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}
    </AdminShell>
  );
}
