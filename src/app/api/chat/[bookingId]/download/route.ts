import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/auth/server";
import { humanSize } from "@/lib/chat/attachments";
import { NRO_SESION_LABEL } from "@/components/room/session-ref";

/**
 * US-1702 (EY-84) — descargar la conversación de una reserva. Es la condición
 * que puso el cliente para reactivar la purga a 30 días (decisión 22): antes de
 * borrar, que se lo puedan llevar.
 *
 * La autorización es la RLS: `messages_select_participant` solo devuelve el
 * hilo a quien es alumno o tutor de esa reserva (ni el admin lo lee). Aquí no
 * se comprueba nada a mano — si la consulta no ve la reserva, no hay descarga.
 *
 * N-26 · el formato normal es **.txt**, y es el único que se enlaza desde el
 * chat. El `.json` sigue existiendo con `?format=json` para soporte —volcarlo a
 * una hoja de cálculo en una disputa—, pero ofrecérselo a un alumno junto al
 * .txt solo conseguía que la mitad se llevara el archivo que no sabe abrir.
 *
 * N-26/N-27 · la cabecera identifica la conversación por el **N.º de sesión** y
 * el nombre de la mentoría. Antes empezaba con el uuid de la reserva, que quien
 * abría el archivo leía como un código interno nuestro: no se puede dictar, no
 * se puede buscar y no dice qué clase era.
 *
 * ⚠️ LOS ADJUNTOS NO VAN DENTRO, Y ESO TIENE UN FILO. Viven en un bucket
 * privado y meterlos exigiría armar un zip. Se listan con su nombre y su peso,
 * pero quien descarga "la conversación" antes de que se cumplan los 30 días se
 * lleva el texto y **pierde los archivos igual** cuando la purga pase. Se deja
 * dicho aquí, en el propio .txt y en el aviso del chat; arreglarlo de verdad es
 * generar el zip, que es otra historia.
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
    .select(
      "id, student_id, tutor_id, created_at, booking_ref, products(title), sessions(session_ref, start_at)",
    )
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

  const title = booking.products?.title ?? "Mentoría";

  // Los números de las sesiones del paquete, en el orden en que se dan. Un
  // paquete de 4 clases es UNA conversación, así que el archivo los lleva
  // todos: es lo que permite atar el hilo con el cobro y con cada clase.
  const nrosSesion = [...(booking.sessions ?? [])]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((s) => s.session_ref)
    .filter((ref): ref is string => Boolean(ref));

  const stamp = new Date().toISOString().slice(0, 10);
  // El nombre del archivo también lleva la referencia y no el uuid: es lo que
  // se ve en la carpeta de descargas cuando hay tres. Las reservas anteriores a
  // la migración `20260817140000` no tienen referencia → se cae al uuid corto,
  // que es lo que había antes.
  const filename = `chat-${booking.booking_ref ?? bookingId.slice(0, 8)}-${stamp}.${format}`;

  if (format === "json") {
    const body = JSON.stringify(
      {
        mentoria: title,
        referencia: booking.booking_ref,
        nros_sesion: nrosSesion,
        // El uuid se queda SOLO aquí: el .json es la vía de soporte y ahí sí
        // hace falta poder cruzar con la BD. En el .txt sobra.
        reserva: bookingId,
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

  // ⚠️ Las líneas opcionales entran con un spread condicional, NO con un `""`
  // que se filtre después: las cadenas vacías de aquí abajo son los renglones
  // en blanco que separan la cabecera del hilo. El filtro que había (`l !== null`)
  // no quitaba nada —ninguna línea era null— y cambiarlo por `l !== ""` habría
  // pegado la cabecera con los mensajes.
  const lines = [
    `Conversación de la mentoría «${title}»`,
    // Con el paquete de varias clases el rótulo se queda igual a propósito: es
    // el que dice la pantalla y el que va a usar quien llame a soporte.
    ...(nrosSesion.length > 0
      ? [`${NRO_SESION_LABEL}: ${nrosSesion.join(", ")}`]
      : []),
    `Descargado: ${fmt(new Date().toISOString())} (${tz})`,
    ...(rows.at(-1)?.expires_at
      ? [
          `El hilo se borra el ${fmt(rows.at(-1)!.expires_at)} (retención de 30 días).`,
        ]
      : []),
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
    "Los archivos adjuntos no van en esta descarga: ábrelos desde el chat y",
    "guárdalos aparte antes de que la conversación se borre.",
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
