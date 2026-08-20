import { createClient } from "@/lib/supabase/client";
import {
  ATTACHMENT_HINT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  fileProblem,
  humanSize,
} from "@/components/tutor/upload-formats";

/**
 * MN-11a · Los límites del bucket `chat-attachments` ya no se declaran aquí:
 * viven con los de los otros cuatro buckets en
 * `components/tutor/upload-formats.ts`, que es también donde está apuntado qué
 * hay que hacer en la BD el día que el número cambie (P-8).
 *
 * Se re-exportan porque el chat los pide a ESTE módulo desde antes
 * (`chat-thread.tsx` y la descarga del hilo en `api/chat/[threadId]/download`);
 * reapuntar esos imports no es de esta ficha, y el alias no cuesta nada.
 */
export { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, humanSize };

export type Attachment = { path: string; name: string; size: number };

/**
 * Sube un documento al hilo de la reserva y lo publica como mensaje.
 *
 * Lo usan los dos sitios que el Figma pinta: el clip del chat y el botón
 * "Subir documentos" de la barra de la sala (LV01). La carpeta es el id de la
 * reserva porque el hilo es de los dos participantes; `send_message` vuelve a
 * comprobarlo server-side.
 *
 * Devuelve el id del mensaje creado, o `null` con el motivo en `error`.
 */
export async function uploadAttachment(
  bookingId: string,
  file: File,
): Promise<{ id: string; attachment: Attachment } | { error: string }> {
  // Mismo juez que el resto de subidas: el mensaje nombra el archivo y repite
  // lo que SÍ vale, con el tope sacado de la constante y no escrito a mano.
  const problema = fileProblem(file, {
    types: ATTACHMENT_TYPES,
    maxBytes: ATTACHMENT_MAX_BYTES,
    hint: ATTACHMENT_HINT,
  });
  if (problema) return { error: problema };

  const supabase = createClient();
  // Prefijo aleatorio: dos archivos con el mismo nombre no se pisan.
  const path = `${bookingId}/${crypto.randomUUID()}-${file.name}`;

  const { error: upErr } = await supabase.storage
    .from("chat-attachments")
    .upload(path, file, { contentType: file.type });
  if (upErr) return { error: "No se pudo subir el archivo." };

  const { data, error } = await supabase.rpc("send_message", {
    p_booking_id: bookingId,
    p_body: "",
    p_attachment_path: path,
    p_attachment_name: file.name,
    p_attachment_size: file.size,
  });

  if (error) {
    // El objeto ya subió pero el mensaje no salió: sin la fila nadie lo ve, así
    // que se retira para no dejar basura en el bucket.
    await supabase.storage.from("chat-attachments").remove([path]);
    return { error: error.message || "No se pudo compartir el archivo." };
  }

  return {
    id: data as string,
    attachment: { path, name: file.name, size: file.size },
  };
}

/** URL firmada (60 s) para abrir un adjunto: el bucket es privado. */
export async function attachmentUrl(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}
