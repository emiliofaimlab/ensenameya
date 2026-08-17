import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { ChatThread } from "@/components/chat/chat-thread";
import {
  chatCounterpart,
  counterpartFallback,
} from "@/components/chat/counterpart";
import { MESSAGE_COLUMNS, toChatMessage } from "@/lib/chat/messages";

export const metadata = { title: "Chat de la reserva · Enséñame Ya" };

/**
 * EP-17 (SCR-AL03) — chat 1:1 de la reserva. RLS de participante ya filtra: si
 * no eres alumno ni tutor de la reserva, no la lees → notFound. El envío y la
 * ventana los gobierna `send_message`; Realtime entrega los nuevos mensajes.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { user } = await requireUser();
  const { bookingId } = await params;

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, products(title), sessions(start_at)")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) notFound();

  // N-28 · el título decía "Chat de la reserva" y punto. Los dos lados salen de
  // `chatCounterpart`: el nombre del tutor es público (`tutor_profiles`), el del
  // alumno viene de la RPC `tutor_students`, que solo lo da a quien comparte
  // reserva con él.
  const [{ data: msgs }, other] = await Promise.all([
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("booking_id", bookingId)
      .order("created_at"),
    chatCounterpart(supabase, user.id, booking),
  ]);

  const firstSessionAt =
    (booking.sessions ?? []).map((s) => s.start_at).sort()[0] ?? null;

  const initial = (msgs ?? []).map(toChatMessage);

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        {/* Sin nombre legible se dice el rol ("Chat con tu alumno") y no un
            "Chat con Alumno", que se lee como un fallo de la aplicación. */}
        <PageHeader
          title={`Chat con ${other.name ?? counterpartFallback(other.role)}`}
          description={booking.products?.title ?? "Mentoría"}
        />
        <ChatThread
          bookingId={bookingId}
          currentUserId={user.id}
          firstSessionAt={firstSessionAt}
          initialMessages={initial}
        />
      </Section>
    </Container>
  );
}
