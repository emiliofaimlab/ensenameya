import { getUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { ChatBubble, type Conversation } from "./chat-bubble";
import { chatCounterparts, counterpartFallback } from "./counterpart";

/**
 * ¿El hilo de esta reserva ya está abierto? RN-41: desde 2 días antes de la
 * primera sesión. Vive a nivel de módulo a propósito: leer el reloj dentro de
 * una closure de render dispara la regla de pureza de react-hooks.
 */
function chatIsOpen(starts: string[]): boolean {
  if (starts.length === 0) return false;
  const first = Math.min(...starts.map((s) => new Date(s).getTime()));
  return first - 2 * 86_400_000 <= Date.now();
}

/**
 * Estados en los que la reserva sigue viva para conversar.
 *
 * ⚠️ AB-01 · NADIE HA DECIDIDO CUÁNTO SIGUE ABIERTO EL CHAT DESPUÉS DE LA CLASE,
 * y hoy la respuesta del código es "para siempre". `completed` está en esta
 * lista y `send_message` (`20260716180000`) solo comprueba el borde de ABAJO de
 * la ventana —2 días antes de la primera sesión—, nunca el de arriba: alumno y
 * tutor pueden seguir escribiéndose meses después de la última clase.
 *
 * Lo único que caduca es la RETENCIÓN, y no es lo mismo ni se comporta como la
 * gente supone: `messages.expires_at` nace como `now() + 30 días` en CADA
 * mensaje, así que el plazo cuenta desde el mensaje, no desde la clase. Efecto
 * real, y es el que hay que contarle al cliente antes de que lo descubra solo:
 *   · la conversación se erosiona por arriba — a los 31 días de la clase el
 *     principio del hilo ya no está, aunque el final sí;
 *   · un hilo con respuestas nuevas no muere nunca del todo: cada mensaje
 *     renueva su propia cuenta atrás y arrastra la conversación viva.
 *
 * Si lo que el cliente entendió al aprobar la decisión 22 fue "30 días desde la
 * clase", entonces el ancla no puede ser `now()` de cada mensaje sino el FIN DE
 * LA ÚLTIMA SESIÓN de la reserva, y hacen falta dos cosas que hoy no existen:
 * un cierre (dejar de admitir mensajes pasado el plazo, arriba en
 * `send_message`) y un `expires_at` calculado desde esa fecha, igual para todo
 * el hilo. Hasta que se decida no se toca nada: cambiar la retención por nuestra
 * cuenta borra conversaciones que hoy la gente da por guardadas.
 */
const OPEN_STATUSES = [
  "pending_acceptance",
  "confirmed",
  "in_progress",
  "completed",
] as const;

/**
 * R24-21 — burbuja flotante de chat, **solo con sesión** (decisión 15): una
 * bandeja tipo LinkedIn para abrir la conversación con el tutor sin tener que
 * entrar a la reserva. Sin sesión no se pinta nada (el chat es por reserva:
 * un visitante anónimo no tiene con quién hablar).
 *
 * La lista sale de las reservas del propio usuario —RLS ya limita a las suyas,
 * sea alumno o tutor— y respeta la ventana de RN-41: el hilo se abre 2 días
 * antes de la primera sesión, así que antes de eso la conversación no aparece.
 */
export async function ChatLauncher() {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, products(title), sessions(start_at)")
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(20);

  const open = (data ?? []).filter((b) =>
    chatIsOpen((b.sessions ?? []).map((s) => s.start_at)),
  );

  // N-28 · con quién habla en cada conversación. Antes aquí solo se resolvía el
  // lado tutor (público) y el alumno se quedaba en "con tu alumno" porque
  // `profiles` es own-only; hoy los dos lados salen de `chatCounterparts`.
  const others = await chatCounterparts(supabase, user.id, open);

  const conversations: Conversation[] = open.map((b) => {
    const other = others.get(b.id);
    const name = other?.name ?? null;
    return {
      bookingId: b.id,
      title: b.products?.title ?? "Mentoría",
      subtitle: `con ${name ?? counterpartFallback(other?.role ?? "tutor")}`,
      // Suelto y sin adornos: la cabecera del hilo lo usa a secas, no dentro de
      // la frase "con …".
      counterpart: name,
      // La 1ª sesión de la reserva: el hilo la necesita para saber si la ventana
      // de RN-41 está abierta y dejar escribir o no.
      firstSessionAt:
        (b.sessions ?? []).map((s) => s.start_at).sort()[0] ?? null,
    };
  });

  return <ChatBubble conversations={conversations} currentUserId={user.id} />;
}
