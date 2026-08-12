import { CheckIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { PAYOUT_BADGE, type TutorBalance } from "@/lib/payouts";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { WithdrawButton } from "./withdraw-button";

export const metadata = { title: "Payouts · Enséñame Ya" };

/** Píldoras del Figma (204:9/19/30): color por estado del payout. */
const PAYOUT_PILL: Record<string, PillTone> = {
  paid: "green",
  processing: "blue",
  scheduled: "blue",
  pending: "amber",
  failed: "red",
  on_hold: "red",
};

/** Estados que el Figma lista como "Próximos payouts" (204:2). */
const UPCOMING = new Set(["scheduled", "processing", "pending"]);

function moneyLine(list: { currency: string; amount: number }[]): string {
  if (list.length === 0) return "—";
  return list.map((m) => formatMoney(m.amount, m.currency)).join(" · ");
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * US-1001 (SCR-TU09) — payouts del tutor: cifras, próximos y el historial,
 * con el layout del Figma. `tutor_balance` agrega disponible / retención /
 * pagado. US-1004: retiro self-service (RN-40).
 *
 * "Cuenta de cobro" (204:54) depende del PSP (EP-20 / C-01): el tutor la
 * registrará en el onboarding del proveedor, no en nuestra BD, así que no hay
 * columna ni la va a haber. R29-03b: en su lugar se dice **en qué estado está
 * el cobro**, que es lo que el tutor viene a mirar — sin migración y sin pintar
 * un "Banco BBVA ····1234" que no existe.
 */
export default async function TutorPayoutsPage() {
  // Mismo guard que el resto del panel: fila en `tutor_profiles`. Con
  // `requireRole("tutor")` un tutor aprobado sin el rol concedido (o uno
  // pendiente, al que el menú ya le ofrece Payouts) rebotaba a /app. La RPC
  // `tutor_balance` y la RLS de `payouts` ya limitan a lo propio.
  await requireTutorProfile();

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
  const upcoming = (payouts ?? []).filter((p) => UPCOMING.has(p.status));
  const history = (payouts ?? []).filter((p) => !UPCOMING.has(p.status));

  return (
    <TutorShell
      title="Payouts"
      description="Tus cobros se pagan en lote semanal. Retención de 7 días antes de liberar el saldo."
    >
      {/* Cifras (203:42). */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PanelCard className="flex items-start justify-between gap-2 p-5">
          <div className="min-w-0">
            <p className="text-xs text-[#6b6b6b]">Saldo disponible (liberado)</p>
            <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
              {moneyLine(balance.available)}
            </p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center self-end rounded-full bg-brand text-white">
            <CheckIcon className="size-4" />
          </span>
        </PanelCard>
        <PanelCard className="p-5">
          <p className="text-xs text-[#6b6b6b]">En retención (7 días)</p>
          <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
            {moneyLine(balance.in_retention)}
          </p>
        </PanelCard>
        <PanelCard className="p-5">
          <p className="text-xs text-[#6b6b6b]">Ya pagado</p>
          <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
            {moneyLine(balance.paid_out)}
          </p>
        </PanelCard>
      </div>

      {/* Retiro self-service (US-1004, RN-40). */}
      <PanelCard className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[560px] text-[13px] text-[#6b6b6b]">
          El retiro adelanta la liquidación de tu saldo disponible (tras el
          período de retención). Si no, se liquida solo en el lote semanal.
        </p>
        <WithdrawButton disabled={!hasAvailable} />
      </PanelCard>

      {/* Información de pago (204:54) — R29-03b. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Información de pago
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[#6b6b6b]">Cómo se te paga</dt>
            <dd className="mt-1 text-sm text-[#19191f]">
              Lote semanal, los lunes
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Retención</dt>
            <dd className="mt-1 text-sm text-[#19191f]">
              7 días desde que la mentoría se completa
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Cuenta de cobro</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-[#19191f]">
              <StatusPill tone="amber">Pendiente</StatusPill>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] text-[#6b6b6b]">
          Todavía no hay cuenta de cobro que registrar: la pedirá el proveedor
          de pagos cuando quede activo, y te avisaremos para completarla. Tu
          saldo se sigue acumulando mientras tanto.
        </p>
      </PanelCard>

      {/* Próximos payouts (204:2). */}
      {upcoming.length > 0 ? (
        <PanelCard>
          <h2 className="text-base font-semibold text-[#19191f]">
            Próximos payouts
          </h2>
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {upcoming.map((p) => {
              const b = PAYOUT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#19191f] tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                    </p>
                    <p className="text-xs text-[#6b6b6b]">
                      {p.scheduled_for
                        ? `Programado para ${fmtDate(p.scheduled_for)}`
                        : `Creado ${fmtDate(p.created_at)}`}
                    </p>
                  </div>
                  <StatusPill
                    tone={PAYOUT_PILL[p.status] ?? "neutral"}
                    className="h-7"
                  >
                    {b.label}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      ) : null}

      {/* Historial (204:23). */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">Historial</h2>
        {history.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#6b6b6b]">
            Aún no tienes liquidaciones pagadas.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {history.map((p) => {
              const b = PAYOUT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#19191f] tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                      {p.paid_at ? ` · ${fmtDate(p.paid_at)}` : ""}
                    </p>
                    {/* El "Transferencia bancaria · DLocal" del Figma llega
                        con el PSP real (EP-20). */}
                  </div>
                  <StatusPill
                    tone={PAYOUT_PILL[p.status] ?? "neutral"}
                    className="h-7"
                  >
                    {b.label}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </PanelCard>
    </TutorShell>
  );
}
