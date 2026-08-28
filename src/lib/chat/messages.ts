import type { Attachment } from "./attachments";

/**
 * Forma de un mensaje del hilo y cómo se construye desde la fila de la tabla.
 *
 * Vive aquí, y no en `chat-thread.tsx`, porque lo leen los tres sitios que
 * consultan `messages` y uno de ellos es **servidor** (la página del chat).
 * Un valor exportado desde un módulo `"use client"` no llega al servidor como
 * el valor: Next lo sustituye por una referencia de cliente, y `MESSAGE_COLUMNS`
 * acababa siendo un proxy en vez de la cadena → 500 en `.select()`.
 */
export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  attachment: Attachment | null;
  /**
   * La reserva que etiqueta el mensaje, si la hay. Es lo que separa un mensaje
   * de cliente de uno de consulta previa: el servidor solo la pone cuando el
   * par YA compró (`send_message` delega en la vía de consulta si no), y el
   * tope de 20 mensajes de `send_conversation_message` cuenta exactamente los
   * que la tienen a `null`. Sin este campo, el contador de la pantalla no
   * podría dar el mismo número que el servidor.
   *
   * ⚠️ **Opcional a propósito.** Las tres pantallas que arman el `ChatMessage`
   * a mano —las dos fichas de reserva y la sala— no lo piden en su `select`, y
   * hacerlo obligatorio las rompería sin ganar nada: en las tres el par ya
   * compró, o sea que ahí no hay topes que contar. Ver `cupoConsulta`.
   */
  bookingId?: string | null;
};

/** Fila cruda de `messages`, tal y como la devuelven el select y Realtime. */
export type MessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  booking_id: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
};

/** Las columnas que hay que pedir para poder construir un `ChatMessage`. */
export const MESSAGE_COLUMNS =
  "id, sender_id, body, created_at, booking_id, attachment_path, attachment_name, attachment_size";

/** Fila → mensaje. */
export function toChatMessage(m: MessageRow): ChatMessage {
  return {
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at,
    bookingId: m.booking_id,
    attachment: m.attachment_path
      ? {
          path: m.attachment_path,
          name: m.attachment_name ?? "documento",
          size: m.attachment_size ?? 0,
        }
      : null,
  };
}
