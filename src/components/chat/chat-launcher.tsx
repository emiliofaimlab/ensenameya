import { getUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { tutorNames } from "@/lib/booking";
import { ChatBubble, type Conversation } from "./chat-bubble";

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

/** Estados en los que la reserva sigue viva para conversar. */
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

  // Como alumno, la contraparte es el tutor (nombre público, DD-01). Como
  // tutor, el nombre del alumno no es legible (profiles es own-only por RLS),
  // así que la conversación se identifica por la mentoría.
  const names = await tutorNames(
    supabase,
    open.filter((b) => b.student_id === user.id).map((b) => b.tutor_id),
  );

  const conversations: Conversation[] = open.map((b) => ({
    bookingId: b.id,
    title: b.products?.title ?? "Mentoría",
    subtitle:
      b.student_id === user.id
        ? `con ${names.get(b.tutor_id) ?? "tu tutor"}`
        : "con tu alumno",
  }));

  return <ChatBubble conversations={conversations} />;
}
