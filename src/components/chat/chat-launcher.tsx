import { getUser } from "@/lib/auth/server";
import { ChatBubble } from "./chat-bubble";
import { listConversations } from "./conversations";

/**
 * R24-21 — burbuja flotante de chat, **solo con sesión** (decisión 15).
 *
 * ── M-12 · qué cambió aquí ──────────────────────────────────────────────────
 * Antes esto listaba RESERVAS —con su filtro de estados y su cálculo de "¿ya
 * abrió la ventana de RN-41?"— porque el chat era de la reserva. Ahora lista
 * CONVERSACIONES, que es una llamada y ningún cálculo: `my_conversations()`
 * resuelve en el servidor con quién hablas, si hubo compra y de qué mentoría.
 *
 * De paso se fueron dos cosas que ya no aplican:
 *  · `OPEN_STATUSES` y la ventana de 2 días. Un hilo que existe antes de la
 *    compra no se puede filtrar por el estado de una reserva que no hay, y el
 *    candado de RN-41 dejó de poder cerrar nada (el razonamiento largo está en
 *    la migración `20260817210000` y en `chat-thread.tsx`).
 *  · El baile de `chatCounterparts` para averiguar el nombre del otro por dos
 *    caminos distintos según el rol. Sigue habiendo dos caminos —el del tutor
 *    es público, el del alumno privado— pero ahora viven dentro de la función
 *    SQL, que es donde se puede razonar sobre ellos con la RLS delante.
 *
 * ⚠️ AB-01 sigue vivo y sin decidir para el chat de reserva: `expires_at` se
 * calcula por MENSAJE, así que esa parte de la conversación se erosiona por
 * arriba. Lo pre-compra sí caduca de una pieza (decisión b de M-12).
 */
export async function ChatLauncher() {
  const user = await getUser();
  if (!user) return null;

  const todas = await listConversations();

  // Una conversación recién abierta desde la ficha del tutor existe ANTES de
  // que se escriba el primer mensaje (`open_conversation` la crea al pulsar).
  // Sin este filtro, al tutor le aparecería en la bandeja una fila vacía de
  // alguien que abrió el chat y se arrepintió — y al alumno, un hilo consigo
  // mismo. Con reserva sí se lista aunque esté muda: ahí hay una relación real
  // aunque nadie haya escrito todavía.
  const conversations = todas
    .filter((c) => c.lastMessageAt !== null || c.hasBooking)
    // Tope de cortesía: la bandeja es una lista corta con scroll, no un
    // buscador. Vienen ordenadas por actividad, así que lo que se corta es lo
    // más antiguo. (El día que haga falta más, esto pide paginación, no un
    // número más grande.)
    .slice(0, 30);

  return <ChatBubble conversations={conversations} currentUserId={user.id} />;
}
