import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { PAYOUT_BADGE, type TutorBalance } from "@/lib/payouts";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WithdrawButton } from "./withdraw-button";

export const metadata = { title: "Cobros · Enséñame Ya" };

function moneyLine(list: { currency: string; amount: number }[]): string {
  if (list.length === 0) return "—";
  return list.map((m) => formatMoney(m.amount, m.currency)).join(" · ");
}

/**
 * US-1001 (SCR-TU09) — el tutor ve sus ganancias y payouts. `tutor_balance`
 * agrega disponible / en retención / pagado (misma elegibilidad que el lote).
 * US-1004: botón de retiro self-service (RN-40).
 */
export default async function TutorPayoutsPage() {
  await requireRole("tutor");

  const supabase = await createClient();
  const [{ data: balanceData }, { data: payouts }] = await Promise.all([
    supabase.rpc("tutor_balance"),
    supabase
      .from("payouts")
      .select("id, status, currency, amount, scheduled_for, paid_at, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const balance = balanceData as unknown as TutorBalance;
  const hasAvailable = balance.available.length > 0;

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Cobros"
          description="Tus ganancias, la retención y el historial de liquidaciones."
          actions={
            <Button asChild variant="outline">
              <Link href="/tutor/reservas">Mis reservas</Link>
            </Button>
          }
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Balance label="Disponible para retirar" value={moneyLine(balance.available)} strong />
          <Balance label="En retención" value={moneyLine(balance.in_retention)} />
          <Balance label="Ya pagado" value={moneyLine(balance.paid_out)} />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            El retiro adelanta la liquidación de tu saldo disponible (tras el
            período de retención). Si no, se liquida solo en el lote semanal.
          </p>
          <WithdrawButton disabled={!hasAvailable} />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Historial de liquidaciones</h2>
          {(payouts ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Aún no tienes liquidaciones.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(payouts ?? []).map((p) => {
                const b = PAYOUT_BADGE[p.status];
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4"
                  >
                    <div>
                      <p className="font-medium tabular-nums">
                        {formatMoney(p.amount, p.currency)}
                      </p>
                      <Badge variant={b.variant} className="mt-1">
                        {b.label}
                      </Badge>
                    </div>
                    <time
                      className="text-sm text-muted-foreground"
                      dateTime={p.paid_at ?? p.created_at}
                    >
                      {p.paid_at
                        ? `Pagado ${new Date(p.paid_at).toLocaleDateString("es")}`
                        : `Creado ${new Date(p.created_at).toLocaleDateString("es")}`}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>
    </Container>
  );
}

function Balance({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? "text-2xl font-semibold" : "text-lg"}`}>
        {value}
      </p>
    </div>
  );
}
