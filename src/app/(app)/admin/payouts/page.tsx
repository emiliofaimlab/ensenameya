import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { PAYOUT_BADGE } from "@/lib/payouts";
import type { Database } from "@/lib/database.types";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "../admin-nav";
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

function asStatus(v?: string): PayoutStatus | undefined {
  return STATUSES.find((s) => s === v);
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
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Payouts"
          description="Liquidaciones a tutores. Retén, libera o reintenta según su estado (M7)."
        />
        <AdminNav />

        <AdminFilters
          basePath="/admin/payouts"
          fields={[{ name: "status", label: "Estado", type: "select", options: STATUS_OPTIONS }]}
        />

        {payouts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No hay payouts con estos filtros.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payouts.map((p) => {
              const b = PAYOUT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {p.profiles?.full_name ?? "Tutor"} ·{" "}
                      <span className="tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={b.variant}>{b.label}</Badge>
                      {p.provider ? <Badge variant="secondary">{p.provider}</Badge> : null}
                      {p.failure_reason ? (
                        <span className="text-xs text-destructive">{p.failure_reason}</span>
                      ) : null}
                    </div>
                  </div>
                  <PayoutActions payoutId={p.id} status={p.status} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Container>
  );
}
