import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asRpc, type ConversationRow } from "./rpc";
import type { Conversation } from "./types";

/**
 * M-12 · Las conversaciones del usuario, desde el servidor.
 *
 * Una sola llamada a `my_conversations()` resuelve lo que antes eran tres
 * consultas encadenadas (reservas → nombres de tutor → RPC de alumnos), y
 * resuelve además el caso que ninguna de ellas podía: una consulta previa a la
 * compra, donde el tutor NO tiene reserva con esa persona y por tanto
 * `tutor_students` no le daba el nombre. El razonamiento de por qué esa función
 * es `SECURITY DEFINER` está en la migración `20260817210000`.
 */

function toConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    counterpartId: r.other_id,
    // Cadena vacía = sin nombre. `full_name` es nulo si esa persona entró con
    // Google y nunca lo puso, y `display_name` puede quedarse a medias en un
    // alta de tutor sin terminar.
    counterpart: r.other_name?.trim() || null,
    counterpartRole: r.other_is_tutor ? "tutor" : "student",
    avatarPath: r.other_avatar_path,
    lastMessageAt: r.last_message_at,
    hasBooking: r.has_booking,
    blocked: r.blocked_at !== null,
    bookingId: r.last_booking_id,
    productTitle: r.last_product_title,
  };
}

/** La bandeja completa, ya ordenada por actividad (lo hace la función SQL). */
export async function listConversations(): Promise<Conversation[]> {
  const supabase = await createClient();
  const { data, error } = await asRpc(supabase).rpc("my_conversations");
  if (error) return [];
  return ((data ?? []) as ConversationRow[]).map(toConversation);
}

/**
 * Una conversación por id. Se filtra sobre la bandeja en vez de pedir la fila
 * suelta: es la MISMA función acotada por participación, así que un id ajeno
 * simplemente no aparece — no hay una segunda superficie que autorizar.
 */
export async function getConversation(
  conversationId: string,
): Promise<Conversation | null> {
  const todas = await listConversations();
  return todas.find((c) => c.id === conversationId) ?? null;
}

/**
 * El hilo de una reserva. Los enlaces viejos (`/chat/<reserva>`, el panel del
 * tutor, la sala) siguen entrando por aquí y tienen que seguir funcionando.
 * `conversation_of_booking` es SECURITY INVOKER: si la reserva no es tuya, la
 * RLS devuelve null y esto acaba en un 404.
 */
export async function conversationIdOfBooking(
  bookingId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await asRpc(supabase).rpc("conversation_of_booking", {
    p_booking_id: bookingId,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

/**
 * M-12 (decisión d) · Mediana de respuesta del tutor, en minutos, o `null`.
 *
 * `null` es un resultado normal y frecuente —tutor nuevo, o que no contesta— y
 * significa NO PINTAR NADA. Ver `responseTimeLabel` en `./types`.
 */
export async function tutorResponseTime(
  tutorId: string,
): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await asRpc(supabase).rpc("tutor_response_time", {
    p_tutor_id: tutorId,
  });
  if (error) return null;
  return typeof data === "number" ? data : null;
}
