import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CalendarPlusIcon,
  TicketIcon,
  WalletIcon,
} from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, formatShortDate, BOOKING_STATUS_LABEL } from "@/lib/booking";
import type { TutorBalance } from "@/lib/payouts";
import { Container } from "@/components/layout/container";
import { AppSidebar, TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { Section } from "@/components/layout/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { APPROVAL_BADGE } from "../admin/badges";

export const metadata = { title: "Panel del tutor · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

// El chat cuelga de la reserva (EP-17), no de la sesión.
const CHAT_BOOKING = new Set<BookingStatus>(["confirmed", "in_progress", "completed"]);

function moneyLine(list: { currency: string; amount: number }[]): string {
  return list.length === 0 ? "—" : list.map((m) => formatMoney(m.amount, m.currency)).join(" · ");
}

/**
 * SCR-TU06 — hub del tutor. Es el destino de `pickHome` tras entrar (Doc 3),
 * así que debe existir para cualquiera con perfil de tutor: se usa
 * `requireTutorProfile` (no `requireRole`) porque un tutor **pendiente** aún no
 * tiene el rol y justo necesita ver su estado de aprobación.
 */
export default async function TutorHomePage() {
  const { userId, approvalStatus } = await requireTutorProfile();
  const supabase = await createClient();

  const [
    { data: profile },
    { data: balanceData },
    { data: nextSessions },
    { count: pendingCount },
    { data: bookings },
  ] = await Promise.all([
      supabase
        .from("tutor_profiles")
        .select("headline, approval_notes, identity_verification_status, profiles(full_name)")
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
        .limit(4),
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
        .limit(4),
    ]);

  const balance = balanceData as unknown as TutorBalance;
  const approval = APPROVAL_BADGE[approvalStatus];
  const firstName = profile?.profiles?.full_name?.split(" ")[0];

  return (
    <div className="bg-muted">
      <Container>
        <Section className="grid gap-6 lg:grid-cols-[232px_1fr]">
          <AppSidebar items={TUTOR_ITEMS} />

          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h1 className="text-[28px] font-bold tracking-tight">
                  {firstName ? `Hola, ${firstName}` : "Tu panel"}
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {profile?.headline ?? "Resumen de tu actividad como tutor."}
                </p>
              </div>
              <Badge variant={approval.variant} className="ml-auto">
                {approval.label}
              </Badge>
            </div>

        {/* Estado de aprobación: lo primero que necesita saber (M1/M2). */}
        {approvalStatus === "pending" ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            Tu perfil está <strong>en revisión</strong>. Te avisaremos cuando lo
            aprobemos; mientras tanto puedes preparar tus clases como borrador.
            {profile?.identity_verification_status === "not_submitted" ? (
              <>
                {" "}
                Falta que subas tus{" "}
                <Link href="/tutor/verification" className="underline underline-offset-4">
                  documentos de identidad
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : approvalStatus === "rejected" || approvalStatus === "suspended" ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Tu perfil está {approval.label.toLowerCase()}.
            {profile?.approval_notes ? ` Motivo: ${profile.approval_notes}` : ""}{" "}
            Puedes actualizar tus datos y volver a enviarlo.
          </p>
        ) : null}

        {/* Ganancias (EP-10). El detalle vive en /tutor/payouts. */}
            {/* El Figma pide además "Total ganado" (bruto, antes de comisión):
                `tutor_balance` solo devuelve NETOS (tutor_net_amount), así que
                habría que agregar payments.gross_amount aparte. Se deja fuera
                antes que enseñar una cifra de dinero que no sé qué mide. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Saldo disponible"
                value={moneyLine(balance.available)}
                strong
              />
              <Stat label="En retención" value={moneyLine(balance.in_retention)} />
              <Stat label="Ya pagado" value={moneyLine(balance.paid_out)} />
              <Stat
                label="Reservas por aceptar"
                value={String(pendingCount ?? 0)}
                strong={(pendingCount ?? 0) > 0}
              />
            </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Próximas sesiones, con acceso directo a la sala (RN-18 la gobierna). */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Próximas clases</h2>
            {(nextSessions ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No tienes clases agendadas.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(nextSessions ?? []).map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.bookings?.products?.title ?? "Clase"}
                      </p>
                      <p className="text-xs text-muted-foreground first-letter:uppercase">
                        {formatSessionTime(s.start_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/chat/${s.booking_id}`}>Chat</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/room/${s.id}`}>Ir a la sala</Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Reservas recientes. */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Reservas recientes</h2>
            {(bookings ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Aún no tienes reservas.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(bookings ?? []).map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {b.products?.title ?? "Clase"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatMoney(b.total_amount, b.currency)} ·{" "}
                        {formatShortDate(b.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {CHAT_BOOKING.has(b.status) ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/chat/${b.id}`}>Chat</Link>
                        </Button>
                      ) : null}
                      <Badge variant="outline">{BOOKING_STATUS_LABEL[b.status]}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

            {/* Accesos rápidos (TU06). El sidebar ya navega; estas tarjetas
                son el atajo visual del diseño. */}
            <div>
              <h2 className="text-[22px] font-bold tracking-tight">
                Accesos rápidos
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { href: "/tutor/products", label: "Mis mentorías", icon: BookOpenIcon },
                  { href: "/tutor/availability", label: "Disponibilidad", icon: CalendarPlusIcon },
                  { href: "/tutor/reservas", label: "Reservas", icon: TicketIcon },
                  { href: "/tutor/payouts", label: "Payouts", icon: WalletIcon },
                ].map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 rounded-2xl bg-card p-5 transition-colors hover:bg-brand-muted"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-muted text-brand">
                      <Icon className="size-5" />
                    </span>
                    <span className="font-semibold">{label}</span>
                    <ArrowRightIcon className="ml-auto size-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </Container>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? "text-2xl font-semibold" : "text-lg"}`}>
        {value}
      </p>
    </div>
  );
}
