import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/components/chat/chat-thread";
import { LiveRoom } from "./live-room";

export const metadata = { title: "Sala en vivo · Enséñame Ya" };

/**
 * SCR-LV01 — sala de clase 1:1 (EP-08). La ventana de acceso y el token los
 * gobierna el server (`join_session`, RN-18); esta página solo pinta el estado
 * y delega el "unirse" a la RPC. RLS de participante ya filtra: si no eres
 * alumno ni tutor de la sesión, no la lees → notFound.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { user } = await requireUser();
  const { sessionId } = await params;

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("sessions")
    .select(
      "id, status, start_at, end_at, tutor_id, student_id, booking_id, bookings(status, products(title))",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (!s) notFound();

  // El panel de chat de LV01 es el hilo de EP-17, no una copia: se precarga el
  // mismo histórico que `/chat/<reserva>` y Realtime sigue desde ahí.
  const [{ data: msgs }, { data: firstSession }, { data: consents }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_id, body, created_at, attachment_path, attachment_name, attachment_size")
      .eq("booking_id", s.booking_id)
      .order("created_at"),
    supabase
      .from("sessions")
      .select("start_at")
      .eq("booking_id", s.booking_id)
      .order("start_at")
      .limit(1)
      .maybeSingle(),
    // US-1801 · quién aceptó que se grabe. La RLS deja a los dos participantes
    // ver las dos filas: hay que poder decir "falta que el otro acepte".
    supabase
      .from("session_recording_consents")
      .select("user_id")
      .eq("session_id", sessionId),
  ]);

  const initialMessages: ChatMessage[] = (msgs ?? []).map((m) => ({
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
    <LiveRoom
      sessionId={s.id}
      bookingId={s.booking_id}
      startAt={s.start_at}
      endAt={s.end_at}
      sessionStatus={s.status}
      bookingStatus={s.bookings?.status ?? "cancelled"}
      productTitle={s.bookings?.products?.title ?? "Clase"}
      isTutor={s.tutor_id === user.id}
      currentUserId={user.id}
      firstSessionAt={firstSession?.start_at ?? null}
      initialMessages={initialMessages}
      consent={{
        mine: (consents ?? []).some((c) => c.user_id === user.id),
        other: (consents ?? []).some((c) => c.user_id !== user.id),
      }}
    />
  );
}
