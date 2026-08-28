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
 * ⚠️ ESTA PANTALLA CAMBIÓ DE PAPEL EL 27-AGO, aunque el código apenas se haya
 * movido. **Ya no es un destino de la aplicación: es la red de lo que no
 * controlamos.** El cliente pidió que el chat se abriera en la burbuja y no en
 * otra pantalla («esa pantalla individual de chat prácticamente ya no va a
 * existir»), así que se retiró la NAVEGACIÓN hacia aquí desde dentro: la ficha
 * pública del tutor, el «Chat» del panel del tutor y los avisos de la campana
 * abren ahora la burbuja en sitio. Lo que queda apuntando aquí es lo que no
 * podemos reescribir ni aunque quisiéramos:
 *
 *  · **Correos ya enviados**, que están en buzones ajenos (`email-templates.ts`
 *    → `rutaFor`, NTF-21). Una URL que sale de aquí ya no vuelve.
 *  · **La sala** (`live-room.tsx`, «Ver hilo completo»), el único sitio de la
 *    app sin burbuja por la decisión MN-04.
 *  · **La campana cuando no hay burbuja donde está pintada** — la propia sala, o
 *    cualquier pantalla futura fuera de `(app)`/`(public)`.
 *
 * Por eso **no se borra la ruta**. Y por eso el `git grep '/chat/'` de esta
 * tanda se hizo a mano: no hay `typedRoutes` en `next.config.ts` y el CI solo
 * pasa lint y typecheck, así que un enlace a una ruta borrada compila, se
 * despliega y solo revienta cuando alguien lo pulsa.
 *
 * ── POR QUÉ SE ENSEÑA LA PÁGINA Y NO SE REDIRIGE A UNA CON BURBUJA ──────────
 * La tentación es "que todo sea burbuja": mandar a quien llega de un correo a
 * `/app` con el hilo ya abierto. Se descarta, y estos son los dos lados:
 *
 *  A FAVOR DE REDIRIGIR: coherencia. El usuario vería siempre el mismo chat, y
 *  la pantalla dejaría de existir de verdad en vez de quedarse como un pariente
 *  pobre que nadie mantiene.
 *
 *  EN CONTRA, que es lo que gana:
 *   1. **El coste de equivocarse es asimétrico.** Enseñar una pantalla más sosa
 *      de lo que a uno le gustaría no le rompe el día a nadie; un enlace de
 *      correo que aterriza en `/app` y NO abre el hilo —porque la conversación
 *      cae fuera de las 30 que lista `ChatLauncher`, o porque el filtro
 *      `lastMessageAt !== null || hasBooking` la deja fuera— es un aviso muerto,
 *      y encima uno que ya no podemos corregir porque el correo ya se envió.
 *      Redirigir cambia un resultado seguro por uno que depende de otra pieza.
 *   2. **Habría que adivinar el destino.** No hay una "pantalla con burbuja"
 *      canónica: `/app` es del alumno y `/tutor` del tutor, así que el redirect
 *      tendría que mirar el rol para escoger — y aterrizar en un panel que no
 *      pediste, con un hilo encima, se lee como un fallo.
 *   3. **Quien llega de fuera no está en ninguna pantalla.** El daño que el
 *      cliente quería evitar era perder de vista lo que estabas mirando. Desde
 *      un correo no hay nada que perder: la página ES el sitio al que vas.
 *   4. Y una URL que redirige deja de servir para compartir, guardar en
 *      marcadores o volver con el botón atrás sin rebotar.
 *
 * ⚠️ EL PARÁMETRO ACEPTA DOS COSAS, y es a propósito. Desde M-12 la identidad
 * del hilo es la CONVERSACIÓN, pero hay enlaces vivos a `/chat/<reserva>` —la
 * sala (LV01), correos antiguos, y hasta el 27-ago también el panel del tutor—
 * que son de otros carriles y que no se van a reescribir. En vez de dejar 404
 * sembrados, se prueban las dos lecturas: primero conversación, y si no, reserva
 * → su conversación. Un uuid ajeno no encuentra ninguna de las dos, porque las
 * dos consultas van con la sesión del usuario y su RLS. **Esta doble lectura no
 * se toca**: es la mitad del valor de que la pantalla siga aquí (la otra mitad
 * está en `/api/chat/[threadId]/download`, que hace lo mismo).
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
          // los enlaces que vienen de fuera, y ahí viven los hilos previos a
          // MN-06 y los de reservas canceladas.
          //
          // ⚠️ 27-ago: aquí ponía «y de la bandeja». Dejó de ser verdad — la
          // bandeja abre el hilo DENTRO de la burbuja y ya no pasa por aquí.
          canChat={conversation.canChat}
          // De qué lado se mira. Decide el contador de la consulta previa: los
          // topes son solo del alumno, así que sin esto el hilo no puede decir
          // «te quedan N» sin arriesgarse a decírselo al tutor, que no tiene
          // ninguno.
          counterpartRole={conversation.counterpartRole}
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
