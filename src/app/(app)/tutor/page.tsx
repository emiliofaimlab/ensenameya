import Link from "next/link";
import { ArrowRightIcon, CheckIcon, TicketIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import {
  formatSessionTime,
  formatShortDate,
  BOOKING_STATUS_LABEL,
} from "@/lib/booking";
import type { TutorBalance } from "@/lib/payouts";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelCard,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Panel del tutor · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Píldoras de reserva del Figma (196:34/41/48). */
const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  pending_acceptance: "blue",
  completed: "neutral",
  cancelled: "red",
  refunded: "red",
  pending_payment: "neutral",
};

const APPROVAL_PILL: Record<string, { label: string; tone: PillTone }> = {
  approved: { label: "Aprobado", tone: "green" },
  pending: { label: "En revisión", tone: "blue" },
  rejected: { label: "Rechazado", tone: "red" },
  suspended: { label: "Suspendido", tone: "red" },
};

function moneyLine(list: { currency: string; amount: number }[]): string {
  return list.length === 0
    ? "—"
    : list.map((m) => formatMoney(m.amount, m.currency)).join(" · ");
}

/**
 * SCR-TU06 — hub del tutor. Es el destino de `pickHome` tras entrar (Doc 3),
 * así que debe existir para cualquiera con perfil de tutor: se usa
 * `requireTutorProfile` (no `requireRole`) porque un tutor **pendiente** aún no
 * tiene el rol y justo necesita ver su estado de aprobación.
 */
export default async function TutorHomePage() {
  const { userId, approvalStatus } = await requireTutorProfile();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const [
    { data: profile },
    { data: balanceData },
    { data: nextSessions },
    { count: pendingCount },
    { data: bookings },
    { count: deliveredCount },
  ] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select(
        "headline, approval_notes, identity_verification_status, profiles(full_name)",
      )
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase.rpc("tutor_balance"),
    supabase
      .from("sessions")
      .select("id, start_at, status, booking_id, bookings(products(title))")
      .eq("tutor_id", userId)
      .in("status", ["scheduled", "in_progress"])
      // Se filtra por el FIN, no por el inicio: una clase que empezó hace un
      // rato sigue entrable (la ventana cierra 10 min después de acabar), y
      // desaparecer del panel dejaría al tutor creyendo que no tiene clase
      // mientras el alumno espera en la sala.
      .gte("end_at", new Date().toISOString())
      .order("start_at")
      .limit(3),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", userId)
      .eq("status", "pending_acceptance"),
    supabase
      .from("bookings")
      // Sin fecha, varias clases del mismo producto se ven como una fila
      // repetida. El nombre del alumno distinguiría mejor, pero `profiles`
      // es RLS own-only: el tutor no puede leer el perfil de su alumno.
      .select("id, status, total_amount, currency, created_at, products(title)")
      .eq("tutor_id", userId)
      .order("created_at", { ascending: false })
      .limit(3),
    // Sesiones ya dictadas (completadas): el banner de bienvenida vive hasta 5.
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", userId)
      .eq("status", "completed"),
  ]);

  const balance = balanceData as unknown as TutorBalance;
  const approval = APPROVAL_PILL[approvalStatus] ?? {
    label: approvalStatus,
    tone: "neutral" as const,
  };
  const firstName = profile?.profiles?.full_name?.split(" ")[0];

  return (
    <PanelShell items={TUTOR_ITEMS}>
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#19191f]">
          {firstName ? `Hola, ${firstName}` : "Tu panel"}
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Resumen de tu actividad como tutor.
        </p>
      </div>

      {/* Estado de aprobación (195:42): lo primero que necesita saber. */}
      {approvalStatus === "pending" ? (
        <PanelCard className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              Tu cuenta está en revisión
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              Algunas acciones (publicar mentorías) estarán disponibles cuando
              se apruebe tu perfil.
              {profile?.identity_verification_status === "not_submitted" ? (
                <>
                  {" "}
                  Falta que subas tus{" "}
                  <Link
                    href="/tutor/verification"
                    className="text-brand underline underline-offset-2"
                  >
                    documentos de identidad
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </div>
          <StatusPill tone="blue" className="h-7">
            En revisión
          </StatusPill>
        </PanelCard>
      ) : approvalStatus === "rejected" || approvalStatus === "suspended" ? (
        <PanelCard className="flex flex-wrap items-center justify-between gap-3 border-[#f0bfbf]">
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              Tu perfil está {approval.label.toLowerCase()}
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              {profile?.approval_notes
                ? `Motivo: ${profile.approval_notes}. `
                : ""}
              Puedes actualizar tus datos y volver a enviarlo.
            </p>
          </div>
          <StatusPill tone={approval.tone} className="h-7">
            {approval.label}
          </StatusPill>
        </PanelCard>
      ) : approvalStatus === "approved" && (deliveredCount ?? 0) < 5 ? (
        /* Bienvenida al recién aprobado (24-jul): se mantiene hasta que dicte
           sus primeras 5 sesiones, luego desaparece sola. */
        <PanelCard className="flex flex-wrap items-center justify-between gap-3 border-[#b7e0c4] bg-[#eaf7ef]">
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              ¡Bienvenido! Tu perfil ha sido aprobado
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              Ya puedes publicar tus mentorías y recibir reservas. Este aviso
              desaparece cuando dictes tus primeras 5 sesiones.
            </p>
          </div>
          <StatusPill tone="green" className="h-7">
            Aprobado
          </StatusPill>
        </PanelCard>
      ) : null}

      {/* Ganancias (EP-10, 195:49). El detalle vive en /tutor/payouts.
          El Figma pide además "Total ganado" (bruto): `tutor_balance` solo
          devuelve NETOS — no se enseña una cifra que no se sabe qué mide. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Saldo disponible"
          value={moneyLine(balance.available)}
          icon="check"
        />
        <Stat label="En retención" value={moneyLine(balance.in_retention)} />
        <Stat label="Ya pagado" value={moneyLine(balance.paid_out)} />
        <Stat
          label="Reservas por aceptar"
          value={String(pendingCount ?? 0)}
          icon={(pendingCount ?? 0) > 0 ? "ticket" : undefined}
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_364px]">
        {/* Próximas sesiones (196:3), con acceso a la sala (RN-18 gobierna). */}
        <PanelCard>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[#19191f]">
              Próximas sesiones
            </h2>
            <Link
              href="/tutor/reservas"
              className="text-[12.5px] font-medium text-brand hover:underline"
            >
              Ver todas
            </Link>
          </div>
          {(nextSessions ?? []).length === 0 ? (
            <p className="mt-4 text-[13px] text-[#6b6b6b]">
              No tienes clases agendadas.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[#e0e0e0]">
              {(nextSessions ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      {s.bookings?.products?.title ?? "Clase"}
                    </p>
                    <p className="text-xs text-[#6b6b6b] first-letter:uppercase">
                      {formatSessionTime(s.start_at, tz)} · tu hora local
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      asChild
                      variant="ghost"
                      className="h-9 rounded-[8px] px-3 text-[13px] text-[#595959]"
                    >
                      <Link href={`/chat/${s.booking_id}`}>Chat</Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/room/${s.id}`}>Ir a la sala</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>

        <div className="flex flex-col gap-5">
          {/* Reservas recientes (196:28). */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">
              Reservas recientes
            </h2>
            {(bookings ?? []).length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                Aún no tienes reservas.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[#e0e0e0]">
                {(bookings ?? []).map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                        {b.products?.title ?? "Clase"}
                      </p>
                      <p className="text-xs text-[#6b6b6b]">
                        {formatMoney(b.total_amount, b.currency)} ·{" "}
                        {formatShortDate(b.created_at, tz)}
                      </p>
                    </div>
                    <StatusPill
                      tone={BOOKING_PILL[b.status] ?? "neutral"}
                      className="h-7"
                    >
                      {BOOKING_STATUS_LABEL[b.status as BookingStatus]}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          {/* Accesos rápidos (196:50): filas con flecha azul, no tarjetas. */}
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">
              Accesos rápidos
            </h2>
            <ul className="mt-2 divide-y divide-[#e0e0e0]">
              {[
                { href: "/tutor/products", label: "Mis mentorías" },
                { href: "/tutor/availability", label: "Disponibilidad" },
                { href: "/tutor/reservas", label: "Reservas" },
                { href: "/tutor/payouts", label: "Payouts" },
                { href: "/tutor/verification", label: "Mis documentos" },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center justify-between py-3 text-sm text-[#333333] transition-colors last:pb-0 hover:text-brand"
                  >
                    {label}
                    <ArrowRightIcon className="size-4 text-brand" />
                  </Link>
                </li>
              ))}
            </ul>
          </PanelCard>
        </div>
      </div>
    </PanelShell>
  );
}

/** Tarjeta de cifra del Figma (195:50): label 12 gris + valor 24/700. */
function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: "check" | "ticket";
}) {
  return (
    <PanelCard className="flex items-start justify-between gap-2 p-5">
      <div className="min-w-0">
        <p className="text-xs text-[#6b6b6b]">{label}</p>
        <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
          {value}
        </p>
      </div>
      {icon ? (
        <span className="grid size-9 shrink-0 place-items-center self-end rounded-full bg-brand text-white">
          {icon === "check" ? (
            <CheckIcon className="size-4" />
          ) : (
            <TicketIcon className="size-4" />
          )}
        </span>
      ) : null}
    </PanelCard>
  );
}
