import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { ChatThread } from "@/components/chat/chat-thread";
import {
  conversationIdOfBooking,
  getConversation,
} from "@/components/chat/conversations";
import {
  conversationSubtitle,
  counterpartFallback,
} from "@/components/chat/types";
import { MESSAGE_COLUMNS, toChatMessage } from "@/lib/chat/messages";

export const metadata = { title: "Mensajes · Enséñame Ya" };

/**
 * El hilo 1:1 a página completa.
 *
 * ⚠️ EL PARÁMETRO ACEPTA DOS COSAS, y es a propósito. Desde M-12 la identidad
 * del hilo es la CONVERSACIÓN, pero hay enlaces vivos a `/chat/<reserva>` —el
 * panel del tutor, la sala (LV01), correos ya enviados— que son de otros
 * carriles y que no se van a reescribir. En vez de dejar 404 sembrados, se
 * prueban las dos lecturas: primero conversación, y si no, reserva → su
 * conversación. Un uuid ajeno no encuentra ninguna de las dos, porque las dos
 * consultas van con la sesión del usuario y su RLS.
 *
 * La autorización, por tanto, sigue siendo la RLS y no una comprobación a mano.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { user } = await requireUser();
  const { threadId } = await params;

  // 1) ¿Es una conversación mía?
  let conversation = await getConversation(threadId);

  // 2) Si no, ¿es una reserva mía? (enlaces viejos)
  if (!conversation) {
    const id = await conversationIdOfBooking(threadId);
    if (id) conversation = await getConversation(id);
  }

  if (!conversation) notFound();

  const supabase = await createClient();
  const { data: msgs } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversation.id)
    .order("created_at");

  const initial = (msgs ?? []).map(toChatMessage);

  // Sin nombre legible se dice el rol ("Chat con tu alumno") y no un "Chat con
  // Alumno", que se lee como un fallo de la aplicación.
  const nombre =
    conversation.counterpart ?? counterpartFallback(conversation.counterpartRole);

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title={`Chat con ${nombre}`}
          // MN-08 · el recuento de mentorías del par delante del título de la
          // última reserva. El respaldo largo se conserva: aquí hay sitio para
          // una frase entera, y en un hilo sin compra es lo único que explica
          // qué es esta pantalla.
          //
          // ⚠️ MN-06 · pero ese respaldo cambió de sentido. Solo se usa cuando
          // no hay ni recuento ni título, o sea cuando el par NUNCA reservó — y
          // desde MN-06 eso es exactamente un hilo de solo lectura. El texto de
          // M-12 («pregúntale lo que necesites») invitaba a algo que ya no se
          // puede hacer.
          description={conversationSubtitle(
            conversation,
            "Conversación de solo lectura: no hay ninguna mentoría reservada entre los dos.",
          )}
        />
        <ChatThread
          conversationId={conversation.id}
          // La reserva más reciente del par, si la hay: es lo que etiqueta el
          // mensaje (retención de 30 días) y lo que permite adjuntar.
          bookingId={conversation.bookingId ?? undefined}
          hasBooking={conversation.hasBooking}
          // MN-06 · esta pantalla SÍ alcanza hilos cerrados: es el destino de
          // los enlaces viejos y de la bandeja, y ahí viven los hilos previos a
          // MN-06 y los de reservas canceladas.
          canChat={conversation.canChat}
          // Solo cuando el otro es el tutor: es el único que tiene mentorías
          // que reservar.
          reservarHref={
            conversation.counterpartRole === "tutor"
              ? `/tutors/${conversation.counterpartId}`
              : undefined
          }
          blocked={conversation.blocked}
          currentUserId={user.id}
          initialMessages={initial}
        />
      </Section>
    </Container>
  );
}
