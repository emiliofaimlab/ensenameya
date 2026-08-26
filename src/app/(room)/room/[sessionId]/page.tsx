import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/components/chat/chat-thread";
import { getUserTimezone } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { listNotices } from "@/lib/notifications-server";
import { SiteHeader } from "@/components/layout/site-header";
import { LiveRoom } from "./live-room";
import { ACCESS_WINDOW_MIN, withMinutes } from "@/lib/room-window";

export const metadata = { title: "Sala en vivo · Enséñame Ya" };


/**
 * SCR-LV01 — sala de clase 1:1 (EP-08). La ventana de acceso y el token los
 * gobierna el server (`join_session`, RN-18); esta página solo pinta el estado
 * y delega el "unirse" a la RPC. RLS de participante ya filtra: si no eres
 * alumno ni tutor de la sesión, no la lees → notFound.
 *
 * MN-05 · La ventana ya no se recalcula en el cliente: se LEEN
 * `access_opens_at` / `access_closes_at`, que es donde vive desde la migración
 * `20260820190000`. Antes `live-room.tsx` tenía su propio `WINDOW_MIN = 10` y
 * era uno de los cinco sitios donde el número estaba copiado; ahora la pantalla
 * y el server no pueden discrepar porque leen la misma fila.
 *
 * V-2 · **La cabecera del sitio vuelve a la sala**, y se arma AQUÍ. `SiteHeader`
 * necesita el usuario, sus roles y los avisos, y las tres cosas son de servidor:
 * `(app)/layout.tsx` las tiene porque su layout es asíncrono, pero la sala no
 * cuelga de `(app)` desde MN-04 (ver `(room)/layout.tsx`). Se le pasa a
 * `LiveRoom` ya renderizada, como slot, en vez de convertir el layout de `(room)`
 * en uno autenticado: ese layout envuelve la sala y nada más, y darle una
 * consulta de avisos lo haría correr también en las pantallas de espera.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { user, roles, fullName, avatarPath } = await requireUser();
  const { sessionId } = await params;

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("sessions")
    .select(
      "id, status, start_at, end_at, access_opens_at, access_closes_at, tutor_id, student_id, booking_id, session_ref, bookings(status, products(title))",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (!s) notFound();

  // El panel de chat de LV01 es el hilo de EP-17, no una copia: se precarga el
  // mismo histórico que `/chat/<reserva>` y Realtime sigue desde ahí.
  const [{ data: msgs }, { data: firstSession }, { data: consents }, notices] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_id, body, created_at, attachment_path, attachment_name, attachment_size")
      .eq("booking_id", s.booking_id)
      .order("created_at"),
    supabase
      .from("sessions")
      .select("start_at")
      .eq("booking_id", s.booking_id)
      .order("start_at")
      .limit(1)
      .maybeSingle(),
    // US-1801 · quién aceptó que se grabe. La RLS deja a los dos participantes
    // ver las dos filas: hay que poder decir "falta que el otro acepte".
    supabase
      .from("session_recording_consents")
      .select("user_id")
      .eq("session_id", sessionId),
    // V-2 · la campana de la cabecera. Va en el mismo `Promise.all` para que no
    // añada un viaje en serie a una pantalla que ya hace tres.
    listNotices(),
  ]);

  const initialMessages: ChatMessage[] = (msgs ?? []).map((m) => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at,
    attachment: m.attachment_path
      ? {
          path: m.attachment_path,
          name: m.attachment_name ?? "documento",
          size: m.attachment_size ?? 0,
        }
      : null,
  }));

  return (
    <LiveRoom
      header={
        <SiteHeader
          user={toHeaderUser(user, roles, { fullName, avatarPath })}
          notices={notices}
        />
      }
      timeZone={await getUserTimezone()}
      sessionId={s.id}
      bookingId={s.booking_id}
      startAt={s.start_at}
      endAt={s.end_at}
      // El respaldo replica la fórmula de `session_access_window` para una fila
      // que llegara sin ventana. No debería existir —hay backfill y trigger—,
      // pero es la misma cautela que la RPC: aquí se cae a la fórmula, NUNCA a
      // "sin límite", que es lo que haría un rango construido con nulos.
      opensAt={s.access_opens_at ?? withMinutes(s.start_at, -ACCESS_WINDOW_MIN)}
      closesAt={s.access_closes_at ?? withMinutes(s.end_at, ACCESS_WINDOW_MIN)}
      sessionStatus={s.status}
      bookingStatus={s.bookings?.status ?? "cancelled"}
      productTitle={s.bookings?.products?.title ?? "Mentoría"}
      // N-27 · el número que el cliente pidió para poder seguir la clase y su
      // cobro. Puede ser null en reservas anteriores a `20260817140000`.
      sessionRef={s.session_ref}
      isTutor={s.tutor_id === user.id}
      currentUserId={user.id}
      firstSessionAt={firstSession?.start_at ?? null}
      initialMessages={initialMessages}
      consent={{
        mine: (consents ?? []).some((c) => c.user_id === user.id),
        other: (consents ?? []).some((c) => c.user_id !== user.id),
      }}
    />
  );
}
