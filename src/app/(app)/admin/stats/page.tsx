import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import { PanelCard } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";

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

type WeekRow = { week_start: string; currency: string; gmv: number };
type CatRow = { name: string; bookings: number };

/** Un mismo `YYYY-MM-DD` inválido no debe llegar a la RPC como fecha rota. */
function asDay(v?: string): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? undefined : v;
}

/** Presets del Figma (228:51): días hacia atrás desde hoy. */
const PRESETS = [
  { id: "7", label: "7 días", days: 7 },
  { id: "30", label: "30 días", days: 30 },
  { id: "90", label: "90 días", days: 90 },
  { id: "365", label: "Año", days: 365 },
] as const;

function fromFor(days: number): string {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  return from.toISOString().slice(0, 10);
}

/**
 * US-1105 (SCR-AD13) — KPIs globales con chips de período y los dos gráficos
 * del Figma: GMV por semana (barras) y reservas por categoría (progresos).
 * Todo lo agregan RPCs con guard de admin dentro; nada de miles de filas a JS.
 */
export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; from?: string; to?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const preset = PRESETS.find((x) => x.id === sp.p);
  const from = preset ? fromFor(preset.days) : asDay(sp.from);
  const to = preset ? undefined : asDay(sp.to);

  const supabase = await createClient();
  const [{ data: statsData }, { data: weeklyData }, { data: catData }] =
    await Promise.all([
      supabase.rpc("admin_stats", { p_from: from, p_to: to }),
      supabase.rpc("admin_gmv_weekly", { p_weeks: 12 }),
      supabase.rpc("admin_bookings_by_category", { p_from: from, p_to: to }),
    ]);

  const stats = statsData as unknown as Stats;
  const weekly = (weeklyData ?? []) as unknown as WeekRow[];
  const cats = (catData ?? []) as unknown as CatRow[];

  // Barras por semana: una moneda a la vez (RN-13). Con varias, la primera.
  const weekCurrency = weekly[0]?.currency;
  const weeks = weekly.filter((w) => w.currency === weekCurrency);
  const maxGmv = Math.max(...weeks.map((w) => w.gmv), 1);
  const maxCat = Math.max(...cats.map((c) => c.bookings), 1);

  const money = stats.money;

  return (
    <AdminShell title="Estadísticas globales" description="KPIs de la plataforma.">
      {/* Chips de período (228:51). */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((x) => {
          const on = sp.p === x.id;
          return (
            <Link
              key={x.id}
              href={`/admin/stats?p=${x.id}`}
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
        <Link
          href="/admin/stats"
          className={cn(
            "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
            !sp.p && !from
              ? "border-brand bg-brand font-semibold text-white"
              : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
          )}
        >
          Todo
        </Link>
      </div>

      {/* KPIs (228:60): actividad + dinero por moneda (RN-13). */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="GMV"
          value={money[0] ? formatMoney(money[0].gmv, money[0].currency) : "—"}
        />
        <Stat
          label="Comisiones"
          value={
            money[0] ? formatMoney(money[0].commission, money[0].currency) : "—"
          }
        />
        <Stat label="Reservas" value={String(stats.bookings_total)} />
        <Stat label="Tutores activos" value={String(stats.active_tutors)} />
        <Stat label="Conversión" value={`${stats.conversion_pct}%`} />
      </div>

      {money.length > 1 ? (
        <PanelCard className="p-5">
          <p className="text-[13px] text-[#6b6b6b]">
            Hay {money.length} monedas; arriba se muestra {money[0].currency}.
            Resto:{" "}
            {money
              .slice(1)
              .map((m) => `${m.currency} · GMV ${formatMoney(m.gmv, m.currency)}`)
              .join(" · ")}
          </p>
        </PanelCard>
      ) : null}

      {/* GMV por semana (228:76): barras server-rendered, sin librería. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          GMV por semana{weekCurrency ? ` (${weekCurrency})` : ""}
        </h2>
        {weeks.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#6b6b6b]">
            Aún no hay cobros que graficar.
          </p>
        ) : (
          <div className="mt-5 flex h-[200px] items-end gap-3 overflow-x-auto">
            {weeks.map((w, i) => {
              const last = i === weeks.length - 1;
              return (
                <div
                  key={w.week_start}
                  className="flex h-full min-w-9 flex-1 flex-col items-center justify-end gap-2"
                >
                  <span
                    className={cn(
                      "w-full max-w-9 rounded-[6px]",
                      last ? "bg-primary" : "bg-brand",
                    )}
                    style={{ height: `${Math.max((w.gmv / maxGmv) * 100, 4)}%` }}
                    title={formatMoney(w.gmv, w.currency)}
                  />
                  <span className="text-xs text-[#6b6b6b]">
                    {new Date(w.week_start).toLocaleDateString("es", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </PanelCard>

      {/* Reservas por categoría (228:115): barras de progreso. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Reservas por categoría
        </h2>
        {cats.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#6b6b6b]">
            Sin reservas en este período.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {cats.map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-[#4d4d4d]">{c.name}</span>
                  <span className="text-xs text-[#6b6b6b]">
                    {c.bookings} {c.bookings === 1 ? "reserva" : "reservas"}
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 rounded-full bg-muted">
                  <div
                    className="h-2.5 rounded-full bg-brand"
                    style={{ width: `${(c.bookings / maxCat) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelCard>
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
