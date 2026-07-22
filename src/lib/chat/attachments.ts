import { createClient } from "@/lib/supabase/client";

/** Límites del bucket `chat-attachments` (los repite la migración). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
];

export type Attachment = { path: string; name: string; size: number };

export const humanSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

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
  if (!ATTACHMENT_TYPES.includes(file.type)) {
    return { error: "Formato no admitido. Usa PDF, imagen o documento de Office." };
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { error: "El archivo supera los 10 MB." };
  }

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
