import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import {
  BOOKING_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  formatSessionTime,
  tutorNames,
} from "@/lib/booking";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import {
  PanelCard,
  PanelCardTitle,
  PanelRow,
  PanelShell,
  StatusPill,
} from "@/components/layout/panel-shell";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { RecordingLink } from "@/components/room/recording-link";
import { SessionRef } from "@/components/room/session-ref";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { roomOpen } from "@/lib/room-window";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/**
 * MN-05 · Reservas cuya sala puede abrirse. `completed` entra porque el cron
 * cierra la reserva a los 10 min de acabar la clase y la sala sigue viva 7 días:
 * sin ella, el botón desaparecería justo cuando MN-05 dice que tiene que estar.
 * Misma lista, palabra por palabra, que la guarda de `join_session`.
 */
const ROOM_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);
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
 * SCR-AL03 — detalle de una reserva del alumno: sus sesiones, el pago, la
 * política y el chat con el tutor (columna derecha, como el Figma). RLS hace de
 * guardia: `bookings_select_own` filtra por `student_id`, así que la reserva de
 * otro devuelve 404, no 403.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      // N-27 · `session_ref` es el "N.º de sesión" visible (`7K3M9Q-2`). Se pide
      // aquí y no se deriva: se calcula en la BD al insertar la sesión
      // (`20260817140000`) y componerlo otra vez en el cliente es la forma de
      // que un día deje de coincidir con el que el alumno tiene apuntado.
      // MN-05 · `access_opens_at`/`access_closes_at` vienen de la fila, no de
      // una fórmula repetida aquí: son la ventana de acceso a la sala (7 días
      // a cada lado desde `20260820190000`) y quien decide si el botón sirve.
      "id, status, total_amount, currency, num_sessions, session_duration_min, created_at, products(title, tutor_id), sessions(id, start_at, end_at, status, session_ref, access_opens_at, access_closes_at), payments(status, gross_amount, currency, paid_at, refunded_amount)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const done = sessions.filter((s) => s.status === "completed").length;
  const payment = booking.payments;
  const chatOpen = CHAT_BOOKING.has(booking.status);

  const names = await tutorNames(supabase, [booking.products?.tutor_id]);
  const tutor = names.get(booking.products?.tutor_id ?? "");

  // El hilo solo se carga si el chat aplica: para una reserva cancelada sería
  // una consulta a cambio de nada.
  const { data: msgs } = chatOpen
    ? await supabase
        .from("messages")
        .select(
          "id, sender_id, body, created_at, attachment_path, attachment_name, attachment_size",
        )
        .eq("booking_id", id)
        .order("created_at")
    : { data: null };

  const initial: ChatMessage[] = (msgs ?? []).map((m) => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at,
    attachment: m.attachment_path
      ? {
          path: m.attachment_path,
          name: m.attachment_name ?? "documento",
          size: m.attachment_size ?? 0,
        }
      : null,
  }));

  return (
    <PanelShell back={{ href: "/app", label: "Volver al panel" }}>
      <div className="flex flex-col gap-1.5">
        {tutor ? <p className="text-[13px] text-[#6b6b6b]">con {tutor}</p> : null}
        <h1 className="text-[26px] font-bold tracking-tight text-[#19191f]">
          {booking.products?.title ?? "Mentoría"}
        </h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusPill>{BOOKING_STATUS_LABEL[booking.status]}</StatusPill>
          <p className="text-[13px] text-[#6b6b6b]">
            {booking.num_sessions === 1
              ? "Sesión suelta"
              : `Paquete de ${booking.num_sessions} sesiones`}
            {booking.session_duration_min
              ? ` · ${booking.session_duration_min} min`
              : ""}
            {done > 0 ? ` · ${done} completada${done === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <PanelCard>
            <PanelCardTitle>Sesiones</PanelCardTitle>
            {sessions.length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                Las sesiones se agendan cuando el tutor acepta la reserva.
              </p>
            ) : (
              <ul className="mt-3.5 divide-y divide-[#e0e0e0]">
                {sessions.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#19191f]">
                        Sesión {i + 1}
                      </p>
                      <p className="text-[13px] text-[#6b6b6b] first-letter:uppercase">
                        {formatSessionTime(s.start_at, tz)} · tu hora local
                      </p>
                      {/* N-27 · el número que se dicta por teléfono. NO es un
                          código interno de los que barre M-06: los `RN-xx` y
                          `US-xx` no significan nada para un alumno, este lo pidió
                          el cliente para poder seguir una clase y su cobro. El
                          "Sesión 1 · 2 · 3" de arriba se queda porque es el
                          ordinal dentro del paquete y sigue valiendo para las
                          reservas anteriores a la migración, que no tienen
                          número (`SessionRef` devuelve null y no pinta nada). */}
                      <SessionRef nro={s.session_ref} className="mt-1" />
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <StatusPill>
                        {SESSION_STATUS_LABEL[s.status] ?? s.status}
                      </StatusPill>
                      {/* El gate real de la ventana (RN-18) lo pone el server;
                          la sala muestra la cuenta regresiva. Aquí solo se
                          decide si enseñar el botón. */}
                      {ROOM_BOOKING.has(booking.status) && roomOpen(s) ? (
                        <Button
                          asChild
                          className="h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
                        >
                          <Link href={`/room/${s.id}`}>Entrar a sala</Link>
                        </Button>
                      ) : null}
                      {/* US-1802 · la grabación vive 30 días desde la clase. El
                          nº de sesión viaja con el botón: una grabación se
                          reclama por correo ("la de la 7K3M9Q-2") y el uuid de
                          la URL no sirve para eso. */}
                      {s.status === "completed" ? (
                        <RecordingLink sessionId={s.id} nroSesion={s.session_ref} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard>
            <PanelCardTitle>Pago</PanelCardTitle>
            <dl className="mt-3.5 flex flex-col gap-3">
              <PanelRow
                label="Total"
                value={formatMoney(booking.total_amount, booking.currency)}
              />
              {payment?.paid_at ? (
                <PanelRow
                  label="Pagado el"
                  value={new Date(payment.paid_at).toLocaleDateString("es", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: tz,
                  })}
                />
              ) : null}
              {payment && payment.refunded_amount > 0 ? (
                <PanelRow
                  label="Reembolsado"
                  value={formatMoney(payment.refunded_amount, payment.currency)}
                />
              ) : null}
            </dl>
            {/* El Figma muestra "Visa ···· 4242" y "Ver recibo": la tarjeta
                usada no se guarda en `payments` (card-on-file es opcional,
                US-607) y no hay recibo que enlazar hasta que EP-20 conecte un
                PSP real. */}
          </PanelCard>

          {/* La reserva existe pero nunca se cobró: sin esto el horario se
              quedaba retenido y lo único ofrecido era cancelarla (12-ago).

              N-37 · el formulario de Stripe ya NO se monta aquí dentro. Cobrar
              en mitad de la ficha —con cabecera, menú lateral, pie y chat
              alrededor— era la segunda experiencia de pago del producto, y el
              cliente pidió justo lo contrario: «el checkout tiene que estar lo
              más aislado posible». El botón lleva a `/reservas/<id>/pagar`, que
              comparte layout con el checkout de una reserva nueva. */}
          {booking.status === "pending_payment" ? (
            <PanelCard>
              <PanelCardTitle>Termina tu pago</PanelCardTitle>
              <p className="mt-3.5 text-sm text-[#6b6b6b]">
                Tu horario está reservado, pero el pago quedó a medias. La
                reserva se libera sola si no se completa.
              </p>
              <Button
                asChild
                className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
              >
                <Link href={`/reservas/${booking.id}/pagar`}>Pagar ahora</Link>
              </Button>
            </PanelCard>
          ) : null}

          <PanelCard>
            <PanelCardTitle>Política de cancelación</PanelCardTitle>
            <p className="mt-3.5 text-sm text-[#6b6b6b]">
              Cancela con {P.cutoffHours} h o más de anticipación y recibe{" "}
              {P.refundPct.studentEarly} % de reembolso. Con menos de{" "}
              {P.cutoffHours} h, el reembolso es del {P.refundPct.studentLate} %.
              Si cancela el tutor, {P.refundPct.tutorCancels} %.
            </p>
            {CANCELLABLE.has(booking.status) ? (
              <Button
                asChild
                variant="outline"
                className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] text-[#262626]"
              >
                <Link href={`/reservas/${booking.id}/cancelar`}>
                  Cancelar reserva
                </Link>
              </Button>
            ) : null}
          </PanelCard>

          {booking.status === "completed" ? (
            <PanelCard>
              <PanelCardTitle>Tu reseña</PanelCardTitle>
              <p className="mt-3.5 text-sm text-[#6b6b6b]">
                Cuenta cómo te fue: ayuda a otros alumnos a elegir.
              </p>
              <Button
                asChild
                className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
              >
                <Link href={`/reservas/${booking.id}/resena`}>Dejar reseña</Link>
              </Button>
            </PanelCard>
          ) : null}
        </div>

        <PanelCard className="flex flex-col gap-3">
          <PanelCardTitle className="text-base">
            {tutor ? `Chat con ${tutor}` : "Chat con el tutor"}
          </PanelCardTitle>
          <p className="text-xs text-[#6b6b6b]">
            Disponible desde 2 días antes de tu 1ª sesión.
          </p>
          {chatOpen ? (
            <ChatThread
              bookingId={booking.id}
              currentUserId={user.id}
              firstSessionAt={sessions[0]?.start_at ?? null}
              initialMessages={initial}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-[13px] text-[#6b6b6b]">
              El chat se habilita cuando la reserva esté confirmada.
            </p>
          )}
          {/* "Descargar conversación" del Figma depende de US-1703 (`EY-76`),
              reabierta el 17-jul: la retención del chat sigue sin decidirse. */}
        </PanelCard>
      </div>
    </PanelShell>
  );
}
