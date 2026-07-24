import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { PAYOUT_BADGE } from "@/lib/payouts";
import type { Database } from "@/lib/database.types";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { AdminFilters } from "../payments/filters";
import { PayoutActions } from "./payout-actions";

export const metadata = { title: "Payouts · Enséñame Ya" };

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

const STATUSES: PayoutStatus[] = [
  "pending",
  "scheduled",
  "processing",
  "paid",
  "failed",
  "on_hold",
];
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: PAYOUT_BADGE[s].label }));

const PAYOUT_PILL: Record<string, PillTone> = {
  paid: "green",
  processing: "blue",
  scheduled: "blue",
  pending: "amber",
  failed: "red",
  on_hold: "red",
};

function asStatus(v?: string): PayoutStatus | undefined {
  return STATUSES.find((s) => s === v);
}

/** Suma por moneda de un subconjunto; "—" si no hay nada. */
function sumLine(rows: { amount: number; currency: string }[]): string {
  if (rows.length === 0) return "—";
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
  return [...by.entries()].map(([c, a]) => formatMoney(a, c)).join(" · ");
}

/**
 * US-1003 (SCR-AD15) — el admin supervisa payouts y ejecuta hold/release/retry.
 * Lectura por RLS (`payouts_select_admin`); las acciones por RPC `manage_payout`.
 */
export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const status = asStatus(sp.status);

  const supabase = await createClient();
  let q = supabase
    .from("payouts")
    .select(
      "id, status, currency, amount, provider, scheduled_for, paid_at, failed_at, failure_reason, created_at, profiles(full_name)",
    )
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);

  const { data } = await q;
  const payouts = data ?? [];

  return (
    <AdminShell
      title="Payouts a tutores"
      description="Lote semanal, en la moneda del tutor (RN-15). Retén, libera o reintenta según su estado (M7)."
    >
      {/* Cifras (232:65) sobre el conjunto visible. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Programados"
          value={sumLine(
            payouts.filter(
              (p) => p.status === "scheduled" || p.status === "processing",
            ),
          )}
        />
        <Stat
          label="En retención"
          value={sumLine(payouts.filter((p) => p.status === "pending"))}
        />
        <Stat
          label="Fallidos / retenidos"
          value={sumLine(
            payouts.filter((p) => p.status === "failed" || p.status === "on_hold"),
          )}
        />
      </div>

      <AdminFilters
        basePath="/admin/payouts"
        fields={[
          { name: "status", label: "Estado", type: "select", options: STATUS_OPTIONS },
        ]}
      />

      {payouts.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay payouts con estos filtros.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {payouts.map((p) => {
              const b = PAYOUT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 sm:w-72">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      #{p.id.slice(0, 8)} ·{" "}
                      <span className="tabular-nums">
                        {formatMoney(p.amount, p.currency)}
                      </span>
                    </p>
                    <p className="truncate text-xs text-[#6b6b6b]">
                      {p.profiles?.full_name ?? "Tutor"}
                      {p.provider ? ` · ${p.provider}` : ""}
                      {p.failure_reason ? ` · ${p.failure_reason}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#6b6b6b]">Estado (M7)</p>
                    <StatusPill
                      tone={PAYOUT_PILL[p.status] ?? "neutral"}
                      className="mt-1 h-7"
                    >
                      {b.label}
                    </StatusPill>
                  </div>
                  <PayoutActions payoutId={p.id} status={p.status} />
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p className="mt-1.5 truncate text-[22px] font-bold text-[#19191f] tabular-nums">
        {value}
      </p>
    </PanelCard>
  );
}
