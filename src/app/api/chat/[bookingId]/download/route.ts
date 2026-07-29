import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/auth/server";
import { humanSize } from "@/lib/chat/attachments";

/**
 * US-1702 (EY-84) — descargar la conversación de una reserva en `.txt` o
 * `.json`. Es la condición que puso el cliente para reactivar la purga a 30
 * días (decisión 22): antes de borrar, que se lo puedan llevar.
 *
 * La autorización es la RLS: `messages_select_participant` solo devuelve el
 * hilo a quien es alumno o tutor de esa reserva (ni el admin lo lee). Aquí no
 * se comprueba nada a mano — si la consulta no ve la reserva, no hay descarga.
 *
 * Los adjuntos NO van dentro: viven en un bucket privado y meterlos exigiría
 * generar un zip. Se listan en el texto con su nombre y peso, y se siguen
 * abriendo desde el chat mientras el hilo exista.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await params;
  const format =
    new URL(request.url).searchParams.get("format") === "json" ? "json" : "txt";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth requerido" }, { status: 401 });
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, created_at, products(title)")
    .eq("id", bookingId)
    .maybeSingle();

  // Sin fila = la RLS no te deja verla, o no existe. Misma respuesta para las
  // dos: no se confirma la existencia de reservas ajenas.
  if (!booking) {
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  const { data: msgs } = await supabase
    .from("messages")
    .select(
      "id, sender_id, body, created_at, expires_at, attachment_name, attachment_size",
    )
    .eq("booking_id", bookingId)
    .order("created_at");

  const rows = msgs ?? [];

  // Sin nombres: `profiles` es privado (el tutor no puede leer el del alumno).
  // El rol en la reserva identifica igual de bien y no abre nada.
  const roleOf = (senderId: string) =>
    senderId === booking.student_id ? "Alumno" : "Tutor";
  const label = (senderId: string) =>
    `${roleOf(senderId)}${senderId === user.id ? " (tú)" : ""}`;

  const title = booking.products?.title ?? "Clase";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `chat-${bookingId.slice(0, 8)}-${stamp}.${format}`;

  if (format === "json") {
    const body = JSON.stringify(
      {
        reserva: bookingId,
        clase: title,
        exportado_en: new Date().toISOString(),
        // El hilo se purga a los 30 días de cada mensaje (RN-41): quien
        // descarga debe saber hasta cuándo existirá el original.
        caduca_el: rows.at(-1)?.expires_at ?? null,
        mensajes: rows.map((m) => ({
          fecha: m.created_at,
          de: roleOf(m.sender_id),
          texto: m.body,
          adjunto: m.attachment_name
            ? { nombre: m.attachment_name, bytes: m.attachment_size ?? 0 }
            : null,
        })),
      },
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Las fechas del .txt van en la hora local de quien descarga (RN-02).
  const tz = await getUserTimezone();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const lines = [
    `Conversación de la reserva ${bookingId}`,
    `Clase: ${title}`,
    `Descargado: ${fmt(new Date().toISOString())} (${tz})`,
    rows.at(-1)?.expires_at
      ? `El hilo se borra el ${fmt(rows.at(-1)!.expires_at)} (retención de 30 días).`
      : "",
    "",
    "─".repeat(60),
    "",
    ...(rows.length === 0
      ? ["(sin mensajes)"]
      : rows.map((m) => {
          // Un mensaje de solo-adjunto lleva el cuerpo en blanco (la tabla no
          // admite vacío, pero sí un espacio): sin esto quedaba una línea
          // sangrada vacía encima de cada archivo.
          const parts = [
            m.body.trim(),
            m.attachment_name
              ? `[archivo] ${m.attachment_name} (${humanSize(m.attachment_size ?? 0)})`
              : "",
          ].filter(Boolean);
          return `[${fmt(m.created_at)}] ${label(m.sender_id)}:\n${parts
            .map((p) => `    ${p}`)
            .join("\n")}`;
        })),
    "",
    "Los archivos adjuntos no van en esta descarga: ábrelos desde el chat",
    "mientras la conversación siga disponible.",
  ];

  return new NextResponse(lines.filter((l) => l !== null).join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
