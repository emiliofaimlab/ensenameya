import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { BOOKING_STATUS_LABEL, formatSessionTime } from "@/lib/booking";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CancelBookingButton } from "./cancel-booking-button";
import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

const SESSION_LABEL: Record<string, string> = {
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};

const ROOM_BOOKING = new Set<BookingStatus>(["confirmed", "in_progress"]);
const CHAT_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);
const CANCELLABLE = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
]);

export const metadata = { title: "Detalle de reserva · Enséñame Ya" };

/**
 * SCR-AL03 — detalle de una reserva del alumno: sus sesiones, el pago y la
 * política. RLS hace de guardia: `bookings_select_own` filtra por
 * `student_id`, así que la reserva de otro devuelve 404, no 403.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, num_sessions, session_duration_min, created_at, products(title), sessions(id, start_at, status), payments(status, gross_amount, currency, paid_at, refunded_amount)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const done = sessions.filter((s) => s.status === "completed").length;
  const payment = booking.payments;

  return (
    <div className="bg-muted">
      <Container>
        <Section className="grid gap-6 lg:grid-cols-[232px_1fr]">
          <AppSidebar />

          <div className="flex flex-col gap-6">
            <Link
              href="/app"
              className="flex w-fit items-center gap-1.5 text-sm font-medium text-brand hover:underline"
            >
              <ArrowLeftIcon className="size-4" />
              Volver al panel
            </Link>

            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[26px] font-bold tracking-tight">
                  {booking.products?.title ?? "Clase"}
                </h1>
                <Badge variant="outline">
                  {BOOKING_STATUS_LABEL[booking.status]}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {booking.num_sessions === 1
                  ? "Sesión suelta"
                  : `Paquete de ${booking.num_sessions} sesiones`}
                {booking.session_duration_min
                  ? ` · ${booking.session_duration_min} min`
                  : ""}
                {done > 0 ? ` · ${done} completada${done === 1 ? "" : "s"}` : ""}
              </p>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
              <section className="rounded-2xl bg-card p-6">
                <h2 className="text-lg font-bold">Sesiones</h2>
                {sessions.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Las sesiones se agendan cuando el tutor acepta la reserva.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y">
                    {sessions.map((s, i) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold">Sesión {i + 1}</p>
                          <p className="text-[13px] text-muted-foreground first-letter:uppercase">
                            {formatSessionTime(s.start_at)} · tu hora local
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {SESSION_LABEL[s.status] ?? s.status}
                          </Badge>
                          {/* El gate real de la ventana (RN-18) lo pone el
                              server; la sala muestra la cuenta regresiva. */}
                          {ROOM_BOOKING.has(booking.status) &&
                          (s.status === "scheduled" ||
                            s.status === "in_progress") ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/room/${s.id}`}>Entrar a sala</Link>
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {CHAT_BOOKING.has(booking.status) ? (
                  <Button asChild variant="outline" className="mt-5">
                    <Link href={`/chat/${booking.id}`}>
                      Chat con el tutor
                    </Link>
                  </Button>
                ) : null}
              </section>

              <aside className="flex flex-col gap-6">
                <section className="rounded-2xl bg-card p-6">
                  <h2 className="text-lg font-bold">Pago</h2>
                  <dl className="mt-4 flex flex-col gap-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Total</dt>
                      <dd className="font-semibold">
                        {formatMoney(booking.total_amount, booking.currency)}
                      </dd>
                    </div>
                    {payment?.paid_at ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Pagado el</dt>
                        <dd>
                          {new Date(payment.paid_at).toLocaleDateString("es", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </dd>
                      </div>
                    ) : null}
                    {payment && payment.refunded_amount > 0 ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Reembolsado</dt>
                        <dd className="font-semibold text-success">
                          {formatMoney(
                            payment.refunded_amount,
                            payment.currency,
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {/* El Figma muestra "Visa ···· 4242" y "Ver recibo": la
                      tarjeta usada no se guarda en `payments` (card-on-file es
                      opcional, US-607) y no hay recibo que enlazar hasta que
                      EP-20 conecte un PSP real. */}
                </section>

                {/* `CancellationPolicy` ya trae su propio encabezado: envolverla
                    en otra sección titulada lo duplicaba en pantalla. */}
                <div className="flex flex-col gap-4">
                  <CancellationPolicy className="bg-card p-6" />
                  {CANCELLABLE.has(booking.status) ? (
                    <CancelBookingButton bookingId={booking.id} />
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </Section>
      </Container>
    </div>
  );
}
