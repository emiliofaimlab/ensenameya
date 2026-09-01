import { CheckIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { payoutCountries } from "@/lib/payments";
import { PAYOUT_BADGE, nombrePais, type TutorBalance } from "@/lib/payouts";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { WithdrawButton } from "./withdraw-button";
import { PayoutCountryForm } from "./payout-country-form";
import { formatPct, tutorTier } from "../tier";

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
 * ⚠️ AQUÍ DECÍA QUE NO HABRÍA COLUMNA DE CUENTA DE COBRO, Y ERA FALSO. El texto
 * anterior daba por hecho que «el tutor la registrará en el onboarding del
 * proveedor, no en nuestra BD, así que no hay columna ni la va a haber». Esa
 * premisa era de Stripe Connect, donde el beneficiario efectivamente vive en el
 * proveedor. Con dLocal Go —que es quien de verdad puede pagar en LATAM— NO:
 * `POST /v1/payouts` no guarda beneficiarios, los datos bancarios viajan
 * enteros en CADA llamada, así que esa PII va a tener que vivir en nuestra base
 * de datos. Es B1, otra fase, y cuando llegue necesita **tabla propia**: no
 * puede ir en `tutor_profiles`, que tiene `grant select` a `anon` y publica la
 * fila entera de cualquier tutor aprobado (ver la nota de `20260901140000`).
 *
 * Lo que sí llega hoy es la mitad que no es PII y que hace falta antes que
 * ninguna otra cosa: **el país de cobro** (A0, `tutor_profiles.payout_country`).
 * Es la clave con la que `create_booking_line` elige pasarela, y hasta esta
 * migración estaba clavada a 'VE' — el único país que ni dLocal Go ni Stripe
 * pueden pagar. R29-03b sigue en pie para el resto: se dice en qué estado está
 * el cobro, sin pintar un "Banco BBVA ····1234" que no existe.
 */
export default async function TutorPayoutsPage() {
  // Mismo guard que el resto del panel: fila en `tutor_profiles`. Con
  // `requireRole("tutor")` un tutor aprobado sin el rol concedido (o uno
  // pendiente, al que el menú ya le ofrece Payouts) rebotaba a /app. La RPC
  // `tutor_balance` y la RLS de `payouts` ya limitan a lo propio.
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const [{ data: balanceData }, { data: payouts }, tier, { data: perfil }, servibles] =
    await Promise.all([
      supabase.rpc("tutor_balance"),
      supabase
        .from("payouts")
        .select("id, status, currency, amount, scheduled_for, paid_at, created_at")
        .order("created_at", { ascending: false }),
      // N-16: aquí es donde el tutor viene a mirar cuánto cobra, así que aquí es
      // donde tiene que estar el reparto que produjo esas cifras.
      tutorTier(supabase, userId),
      // A0 · dónde cobra (`null` = no lo ha declarado). Con el cliente del
      // propio tutor: `tutor_profiles_select_own` ya le deja ver su fila y
      // `service_role` no tiene grant sobre esta tabla (regla de oro 9).
      supabase
        .from("tutor_profiles")
        .select("payout_country")
        .eq("profile_id", userId)
        .maybeSingle(),
      // Y a dónde podemos transferir de verdad, según `payment_routing_rules`.
      payoutCountries(),
    ]);

  const balance = balanceData as unknown as TutorBalance;
  const hasAvailable = balance.available.length > 0;
  const upcoming = (payouts ?? []).filter((p) => UPCOMING.has(p.status));
  const history = (payouts ?? []).filter((p) => !UPCOMING.has(p.status));

  const paisDeCobro = perfil?.payout_country ?? null;
  /**
   * Lo que ofrece el desplegable. Si el tutor tiene declarado un país que hoy ya
   * no es servible —porque alguien desactivó su regla—, se conserva en la lista:
   * quitarlo dejaría el `<select>` en blanco y le diría «no has declarado nada»
   * a quien sí declaró. Que siga viéndolo es también la única pista de que sus
   * mentorías han dejado de poder venderse.
   */
  const paisesOfrecidos = (
    paisDeCobro && !servibles.includes(paisDeCobro)
      ? [...servibles, paisDeCobro]
      : servibles
  ).map((code) => ({ code, label: nombrePais(code) }));

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
          {/* A0 · el dato que decide quién paga. Va junto a los otros dos
              porque es de la misma naturaleza: condiciones del cobro, no una
              acción. El control para cambiarlo está debajo. */}
          <div>
            <dt className="text-xs text-[#6b6b6b]">País de cobro</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-[#19191f]">
              {paisDeCobro ? (
                nombrePais(paisDeCobro)
              ) : (
                <StatusPill tone="amber">Sin declarar</StatusPill>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Cuenta de cobro</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-[#19191f]">
              <StatusPill tone="amber">Pendiente</StatusPill>
            </dd>
          </div>
          {/* N-16 — el tutor no veía su comisión por ningún lado, y estas
              cifras ya son NETAS de ella: sin el reparto, los importes no
              cuadran con lo que cobró el alumno. Etiqueta, no control: el nivel
              lo asigna el admin (`assign_tutor_tier`) y el tutor no tiene grant
              sobre `tier_id`. */}
          {tier ? (
            <div>
              <dt className="text-xs text-[#6b6b6b]">Tu nivel</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#19191f]">
                <StatusPill tone="blue">{tier.name}</StatusPill>
                Te quedas con el {formatPct(tier.splitPct)} · comisión{" "}
                {formatPct(tier.commissionPct)}
              </dd>
            </div>
          ) : null}
        </dl>
        {/* A0 · la parte de la "cuenta de cobro" que hoy SÍ se puede pedir. Los
            datos bancarios son B1 y no caben en esta tabla (ver la cabecera). */}
        <div className="mt-4 border-t border-[#e0e0e0] pt-4">
          <h3 className="text-sm font-semibold text-[#19191f]">
            ¿En qué país cobras?
          </h3>
          <p className="mt-1 max-w-[620px] text-[13px] text-[#6b6b6b]">
            De esto depende quién te paga, así que conviene tenerlo puesto antes
            de la primera liquidación. La lista son los países a los que hoy
            podemos transferir. Si el tuyo no está —Venezuela y Colombia, entre
            otros— déjalo sin declarar: sigues vendiendo igual y tu saldo se
            sigue acumulando.
          </p>
          <PayoutCountryForm
            userId={userId}
            current={paisDeCobro}
            options={paisesOfrecidos}
          />
          <p className="mt-3 max-w-[620px] text-[13px] text-[#6b6b6b]">
            Los datos de tu cuenta bancaria todavía no se piden en ninguna
            parte: llegan cuando el proveedor de pagos quede activo y te
            avisaremos para completarlos.
          </p>
        </div>
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
