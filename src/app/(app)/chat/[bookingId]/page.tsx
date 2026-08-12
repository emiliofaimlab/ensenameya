import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";

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

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, attachment_path, attachment_name, attachment_size")
    .eq("booking_id", bookingId)
    .order("created_at");

  const firstSessionAt =
    (booking.sessions ?? []).map((s) => s.start_at).sort()[0] ?? null;

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
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Chat de la reserva"
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
