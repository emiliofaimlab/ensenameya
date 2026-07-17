import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { LiveRoom } from "./live-room";

export const metadata = { title: "Sala en vivo · Enséñame Ya" };

/**
 * SCR-LV01 — sala de clase 1:1 (EP-08). La ventana de acceso y el token los
 * gobierna el server (`join_session`, RN-18); esta página solo pinta el estado
 * y delega el "unirse" a la RPC. RLS de participante ya filtra: si no eres
 * alumno ni tutor de la sesión, no la lees → notFound.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { user } = await requireUser();
  const { sessionId } = await params;

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("sessions")
    .select(
      "id, status, start_at, end_at, tutor_id, student_id, bookings(status, products(title))",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (!s) notFound();

  return (
    <LiveRoom
      sessionId={s.id}
      startAt={s.start_at}
      endAt={s.end_at}
      sessionStatus={s.status}
      bookingStatus={s.bookings?.status ?? "cancelled"}
      productTitle={s.bookings?.products?.title ?? "Clase"}
      isTutor={s.tutor_id === user.id}
    />
  );
}
