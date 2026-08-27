import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext, getUserTimezone } from "@/lib/auth/server";
import { humanSize } from "@/lib/chat/attachments";
import {
  conversationIdOfBooking,
  getConversation,
} from "@/components/chat/conversations";
import { counterpartFallback } from "@/components/chat/types";
import { NRO_SESION_LABEL } from "@/components/room/session-ref";

/**
 * US-1702 (EY-84) — descargar la conversación. Es la condición que puso el
 * cliente para reactivar la purga a 30 días (decisión 22): antes de borrar, que
 * se lo puedan llevar.
 *
 * La autorización es la RLS: `my_conversations()` solo devuelve los hilos en
 * los que el usuario participa, y `messages_select_participant` solo devuelve
 * mensajes de esos hilos (ni el admin los lee). Aquí no se comprueba nada a
 * mano — si la consulta no ve la conversación, no hay descarga.
 *
 * ── M-12 · qué cambió ───────────────────────────────────────────────────────
 * Se descarga LA CONVERSACIÓN, no "el chat de la reserva". Es la consecuencia
 * directa del histórico continuo: lo hablado antes de comprar y lo hablado
 * dentro de la reserva son el mismo hilo, y partir el archivo por reservas
 * dejaría fuera justo la parte donde se acordó qué incluía la clase — que es la
 * que importa en una disputa, y la que el §21 de los Términos hace relevante.
 * Las reservas del par se listan en la cabecera con su referencia y sus N.º de
 * sesión, que es lo que permite atar el hilo con el cobro y con cada clase.
 *
 * `?format=json` sigue existiendo para soporte (volcarlo a una hoja de cálculo
 * en una disputa); el formato normal es **.txt** y es el único que se enlaza
 * desde el chat (N-26).
 *
 * ⚠️ LOS ADJUNTOS NO VAN DENTRO, Y ESO TIENE UN FILO. Viven en un bucket
 * privado y meterlos exigiría armar un zip. Se listan con su nombre y su peso,
 * pero quien descarga "la conversación" antes de que se cumplan los 30 días se
 * lleva el texto y **pierde los archivos igual** cuando la purga pase.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const format =
    new URL(request.url).searchParams.get("format") === "json" ? "json" : "txt";

  const supabase = await createClient();
  // `getSessionContext` en vez de `auth.getUser()` porque además del usuario
  // trae su `full_name`, que es lo que firma sus propias líneas del archivo.
  const { user, fullName: miNombre } = await getSessionContext();
  if (!user) {
    return NextResponse.json({ error: "auth requerido" }, { status: 401 });
  }

  // Igual que la página del hilo: el parámetro puede ser la conversación o —por
  // los enlaces viejos— una reserva.
  let conversation = await getConversation(threadId);
  if (!conversation) {
    const id = await conversationIdOfBooking(threadId);
    if (id) conversation = await getConversation(id);
  }

  // Sin fila = la RLS no te deja verla, o no existe. Misma respuesta para las
  // dos: no se confirma la existencia de conversaciones ajenas.
  if (!conversation) {
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  const soyElAlumno = conversation.counterpartRole === "tutor";

  const [{ data: msgs }, { data: bookings }] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id, sender_id, body, created_at, expires_at, attachment_name, attachment_size",
      )
      .eq("conversation_id", conversation.id)
      .order("created_at"),
    // Las reservas del par, para la cabecera. Los dos filtros son explícitos
    // (no basta con la RLS) porque una misma persona puede ser mi tutor en una
    // reserva y mi alumno en otra: sin acotar los dos lados se colarían las de
    // la otra dirección, que son otra conversación.
    supabase
      .from("bookings")
      .select(
        "id, booking_ref, created_at, products(title), sessions(session_ref, start_at)",
      )
      .eq(soyElAlumno ? "student_id" : "tutor_id", user.id)
      .eq(soyElAlumno ? "tutor_id" : "student_id", conversation.counterpartId)
      .order("created_at"),
  ]);

  const rows = msgs ?? [];
  const reservas = bookings ?? [];

  const otroNombre = conversation.counterpart?.trim() || null;

  // Solo hay dos personas en el hilo: la que descarga y la otra. Un nombre
  // puede faltar (perfil sin `full_name`, o alta de tutor a medias).
  const nameOf = (senderId: string) =>
    (senderId === user.id ? miNombre : otroNombre)?.trim() || null;
  const roleOf = (senderId: string) =>
    (senderId === user.id) === soyElAlumno ? "Alumno" : "Tutor";
  const label = (senderId: string) =>
    `${nameOf(senderId) ?? roleOf(senderId)}${senderId === user.id ? " (tú)" : ""}`;
  // Para la cabecera: quién es quién, dicho una sola vez.
  const quien = (senderId: string) => nameOf(senderId) ?? "(sin nombre)";

  const yo = user.id;
  const otro = conversation.counterpartId;
  const alumnoId = soyElAlumno ? yo : otro;
  const tutorId = soyElAlumno ? otro : yo;

  // Los números de sesión de cada reserva, en el orden en que se dan. Un
  // paquete de 4 clases es UNA reserva con 4 números.
  const refsDe = (b: (typeof reservas)[number]) =>
    [...(b.sessions ?? [])]
      .sort((a, c) => a.start_at.localeCompare(c.start_at))
      .map((s) => s.session_ref)
      .filter((ref): ref is string => Boolean(ref));

  const stamp = new Date().toISOString().slice(0, 10);
  // El nombre del archivo lleva la referencia de la última reserva si la hay
  // —es lo que se ve en la carpeta de descargas cuando hay tres— y si no, el
  // uuid corto de la conversación.
  const referencia =
    reservas.at(-1)?.booking_ref ?? `consulta-${conversation.id.slice(0, 8)}`;
  const filename = `chat-${referencia}-${stamp}.${format}`;

  if (format === "json") {
    const body = JSON.stringify(
      {
        // El uuid se queda SOLO aquí: el .json es la vía de soporte y ahí sí
        // hace falta poder cruzar con la BD. En el .txt sobra.
        conversacion: conversation.id,
        participantes: {
          alumno: nameOf(alumnoId),
          tutor: nameOf(tutorId),
        },
        reservas: reservas.map((b) => ({
          referencia: b.booking_ref,
          mentoria: b.products?.title ?? null,
          nros_sesion: refsDe(b),
        })),
        exportado_en: new Date().toISOString(),
        // Los mensajes de reserva se purgan a los 30 días de escribirse
        // (RN-41). Los previos a la compra no tienen fecha propia: caducan con
        // la conversación entera si nunca se llega a reservar (M-12).
        caduca_el: rows.at(-1)?.expires_at ?? null,
        mensajes: rows.map((m) => ({
          fecha: m.created_at,
          // `de` se queda con el ROL y no con el nombre: es la vía de soporte y
          // hay volcados viejos con este campo. El nombre va al lado, nuevo.
          de: (m.sender_id === alumnoId ? "Alumno" : "Tutor") as string,
          nombre: nameOf(m.sender_id),
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

  const caduca = rows.at(-1)?.expires_at ?? null;

  // ⚠️ Las líneas opcionales entran con un spread condicional, NO con un `""`
  // que se filtre después: las cadenas vacías de aquí abajo son los renglones
  // en blanco que separan la cabecera del hilo.
  const lines = [
    `Conversación con ${otroNombre ?? counterpartFallback(conversation.counterpartRole)}`,
    // Quién es quién. Los mensajes van firmados con el nombre a secas, así que
    // el rol se dice aquí: en una disputa importa saber cuál de los dos daba la
    // clase, y el nombre solo no lo dice.
    `Alumno: ${quien(alumnoId)} · Tutor: ${quien(tutorId)}`,
    ...(reservas.length === 0
      ? ["Sin reservas: es una consulta previa a la contratación."]
      : reservas.map((b) => {
          const refs = refsDe(b);
          return `Mentoría «${b.products?.title ?? "Mentoría"}»${
            b.booking_ref ? ` · reserva ${b.booking_ref}` : ""
          }${refs.length > 0 ? ` · ${NRO_SESION_LABEL}: ${refs.join(", ")}` : ""}`;
        })),
    `Descargado: ${fmt(new Date().toISOString())} (${tz})`,
    ...(caduca
      ? [`El mensaje más reciente se borra el ${fmt(caduca)} (retención de 30 días).`]
      : reservas.length === 0
        ? [
            "Si no se llega a reservar, esta conversación se borra entera a los 30",
            "días del último mensaje.",
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
