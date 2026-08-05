import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, BOOKING_STATUS_LABEL, SESSION_STATUS_LABEL } from "@/lib/booking";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelCard,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { RecordingLink } from "@/components/room/recording-link";
import { Button } from "@/components/ui/button";
import {
  CompleteSessionButton,
  TutorCancelButton,
} from "../booking-actions";
import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  pending_acceptance: "blue",
  completed: "neutral",
  cancelled: "red",
  refunded: "red",
  pending_payment: "neutral",
};

const LIVE = new Set<BookingStatus>(["confirmed", "in_progress"]);
const CHAT_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);
const CANCELLABLE = new Set<BookingStatus>(["pending_acceptance", "confirmed"]);

export const metadata = { title: "Detalle de la sesión · Enséñame Ya" };

/**
 * SCR-TU08 — detalle de una reserva/sesión del tutor: datos, acciones
 * (sala, marcar completada, cancelar) y el chat con el alumno en la columna
 * derecha (202:87). RLS filtra por `tutor_id`: la reserva de otro da 404.
 *
 * La tarjeta "Grabación" del Figma (202:72) es US-1802 y ya existe: cada sesión
 * completada lleva su "Ver grabación" (`RecordingLink`). El nombre del alumno
 * sigue sin pintarse: `profiles` es RLS own-only.
 */
export default async function TutorBookingDetailPage({
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
      "id, status, tutor_id, total_amount, currency, num_sessions, session_duration_min, products(title), sessions(id, start_at, status)",
    )
    .eq("id", id)
    .eq("tutor_id", user.id)
    .maybeSingle();

  if (!booking) notFound();

  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const chatOpen = CHAT_BOOKING.has(booking.status);

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
    <PanelShell
      items={TUTOR_ITEMS}
      back={{ href: "/tutor/reservas", label: "Volver a reservas" }}
      eyebrow="Reservas / Detalle"
      title="Detalle de la sesión"
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_364px]">
        <div className="flex flex-col gap-5">
          <PanelCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-base font-bold text-[#19191f]">
                {booking.products?.title ?? "Clase"}
              </p>
              <StatusPill
                tone={BOOKING_PILL[booking.status] ?? "neutral"}
                className="h-7"
              >
                {BOOKING_STATUS_LABEL[booking.status]}
              </StatusPill>
            </div>

            <hr className="my-4 border-[#e0e0e0]" />

            <div className="flex flex-wrap gap-10">
              <div>
                <p className="text-xs text-[#6b6b6b]">Formato</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  {booking.num_sessions === 1
                    ? "Sesión suelta"
                    : `Paquete de ${booking.num_sessions} sesiones`}
                </p>
              </div>
              {booking.session_duration_min ? (
                <div>
                  <p className="text-xs text-[#6b6b6b]">Duración</p>
                  <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                    {booking.session_duration_min} min
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs text-[#6b6b6b]">Total</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  {formatMoney(booking.total_amount, booking.currency)}
                </p>
              </div>
            </div>

            {sessions.length > 0 ? (
              <>
                <hr className="my-4 border-[#e0e0e0]" />
                <ul className="flex flex-col gap-3">
                  {sessions.map((s, i) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-[13px] font-medium text-[#404040]">
                          Sesión {i + 1} ·{" "}
                          <span className="first-letter:uppercase">
                            {formatSessionTime(s.start_at, tz)}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <StatusPill className="h-7">
                          {SESSION_STATUS_LABEL[s.status] ?? s.status}
                        </StatusPill>
                        {LIVE.has(booking.status) &&
                        (s.status === "scheduled" || s.status === "in_progress") ? (
                          <>
                            <Button
                              asChild
                              className="h-[43px] rounded-[8px] px-5 text-sm font-semibold"
                            >
                              <Link href={`/room/${s.id}`}>Entrar a la sala</Link>
                            </Button>
                            <CompleteSessionButton sessionId={s.id} />
                          </>
                        ) : null}
                        {/* US-1802 · disponible 30 días desde la clase. */}
                        {s.status === "completed" ? (
                          <RecordingLink sessionId={s.id} />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {CANCELLABLE.has(booking.status) ? (
              <>
                <hr className="my-4 border-[#e0e0e0]" />
                <TutorCancelButton bookingId={booking.id} />
              </>
            ) : null}
          </PanelCard>
        </div>

        <PanelCard className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#19191f]">
              Chat con el alumno
            </h2>
            <span className="text-[11px] text-[#6b6b6b]">RN-41</span>
          </div>
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
        </PanelCard>
      </div>
    </PanelShell>
  );
}
