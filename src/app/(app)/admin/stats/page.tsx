import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { AdminNav } from "../admin-nav";
import { AdminFilters } from "../payments/filters";

export const metadata = { title: "Estadísticas · Enséñame Ya" };

type Stats = {
  bookings_total: number;
  bookings_paid: number;
  conversion_pct: number;
  active_tutors: number;
  money: {
    currency: string;
    gmv: number;
    commission: number;
    tutor_net: number;
    refunded: number;
  }[];
};

/** Un mismo `YYYY-MM-DD` inválido no debe llegar a la RPC como fecha rota. */
function asDay(v?: string): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? undefined : v;
}

/** Presets de período: se calculan en el servidor sobre "hoy". */
function presetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * US-1105 (SCR-AD13) — KPIs globales filtrables por período.
 * Los agrega la RPC `admin_stats` (una consulta, no miles de filas a JS);
 * la RPC verifica `has_role('admin')` dentro.
 */
export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const from = asDay(sp.from);
  const to = asDay(sp.to);

  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_stats", {
    p_from: from,
    p_to: to,
  });
  const stats = data as unknown as Stats;

  const presets: { label: string; days: number }[] = [
    { label: "7 días", days: 7 },
    { label: "30 días", days: 30 },
    { label: "90 días", days: 90 },
  ];
  const presetHref = (days: number) => {
    const { from, to } = presetRange(days);
    return `/admin/stats?from=${from}&to=${to}`;
  };

  const periodLabel =
    from || to ? `${from ?? "inicio"} → ${to ?? "hoy"}` : "todo el histórico";

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Estadísticas globales"
          description={`KPIs de la plataforma · ${periodLabel}`}
        />
        <AdminNav />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Período rápido:</span>
          {presets.map((p) => (
            <Link
              key={p.days}
              href={presetHref(p.days)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {p.label}
            </Link>
          ))}
          <Link
            href="/admin/stats"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Todo
          </Link>
        </div>

        <AdminFilters
          basePath="/admin/stats"
          fields={[
            { name: "from", label: "Desde", type: "date" },
            { name: "to", label: "Hasta", type: "date" },
          ]}
        />

        {/* KPIs de actividad (sin moneda). */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Reservas creadas" value={String(stats.bookings_total)} />
          <Kpi label="Reservas pagadas" value={String(stats.bookings_paid)} />
          <Kpi label="Conversión" value={`${stats.conversion_pct}%`} />
          <Kpi label="Tutores activos" value={String(stats.active_tutors)} />
        </div>

        {/* Dinero, por moneda (RN-13: no se suman monedas distintas). */}
        {stats.money.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Sin ingresos en este período.
          </p>
        ) : (
          stats.money.map((m) => (
            <div key={m.currency} className="flex flex-col gap-3">
              {stats.money.length > 1 ? (
                <h2 className="text-sm font-medium">{m.currency}</h2>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-4">
                <Kpi label="GMV (cobrado)" value={formatMoney(m.gmv, m.currency)} />
                <Kpi label="Comisión" value={formatMoney(m.commission, m.currency)} />
                <Kpi label="Neto tutores" value={formatMoney(m.tutor_net, m.currency)} />
                <Kpi
                  label="Reembolsado"
                  value={m.refunded > 0 ? `−${formatMoney(m.refunded, m.currency)}` : "—"}
                />
              </div>
            </div>
          ))
        )}
      </Section>
    </Container>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
