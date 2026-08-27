import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asRpc, type ConversationRow } from "./rpc";
import { toConversation, type Conversation } from "./types";

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

/*
 * ⚠️ `toConversation` ya no vive aquí: se mudó a `./types`, que es neutro. La
 * burbuja tiene que llamar a `my_conversations()` desde el NAVEGADOR para
 * alcanzar un hilo que no venía en la lista del servidor, y este módulo es
 * `server-only`. El porqué largo está en la cabecera de `types.ts`.
 */

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
 * El hilo de una reserva. Todo lo que solo tiene un `booking_id` entra por aquí
 * y tiene que seguir funcionando: la sala, los correos antiguos y cualquier
 * `/chat/<reserva>` que ande suelto.
 * `conversation_of_booking` es SECURITY INVOKER: si la reserva no es tuya, la
 * RLS devuelve null y esto acaba en un 404.
 *
 * ⚠️ 27-ago: aquí también se nombraba «el panel del tutor». Su botón «Chat» ya
 * no navega a `/chat/<reserva>` — le pide a la burbuja que abra ese hilo (ver
 * `app/(app)/tutor/chat-button.tsx`). Sigue viajando un id de RESERVA, así que
 * la traducción hace la misma falta que antes; lo que cambió es quién la pide y
 * desde qué lado. Este módulo es `server-only`: desde el navegador hay que
 * llamar a la RPC directamente.
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
