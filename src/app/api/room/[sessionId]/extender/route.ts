import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  ensureRoom,
  isDailyConfigured,
  participantEjectAfterSec,
} from "@/lib/daily";

/**
 * EY-232 — el tutor extiende la clase 5, 10 o 20 minutos (una vez, gratis).
 * Los minutos llegan en el cuerpo (`{ minutos }`); la RPC los valida.
 *
 * `extend_session` AUTORIZA y mueve `end_at` (el trigger recalcula
 * `access_closes_at`). Lo que la BD no puede hacer es avisar a Daily: la sala
 * se creó con `exp` = cierre viejo y `eject_at_room_exp`, así que sin volver a
 * aplicarle propiedades echaría a los dos a la hora de siempre. Eso es esta
 * ruta. Los navegadores se enteran del nuevo fin por Realtime (`live-room.tsx`).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const { minutos } = (await req.json().catch(() => ({}))) as { minutos?: unknown };
  const { data, error } = await supabase.rpc("extend_session", {
    p_session_id: sessionId,
    p_minutos: typeof minutos === "number" ? minutos : 5,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  const s = data as {
    room_name: string | null;
    starts_at: string;
    ends_at: string;
    closes_at: string;
  };

  if (isDailyConfigured() && s.room_name) {
    // Mismo cálculo que `/api/room/[sessionId]`: si aquí se pasara `false`, el
    // PATCH apagaría la grabación a mitad de clase.
    const { data: allowed } = await supabase.rpc("recording_allowed", {
      p_session_id: sessionId,
    });
    try {
      await ensureRoom(
        s.room_name,
        new Date(s.closes_at),
        allowed === true,
        participantEjectAfterSec(new Date(s.starts_at), new Date(s.ends_at)),
      );
    } catch (e) {
      // La BD ya se movió: la clase no se cierra antes por el cron, pero la
      // sala sí. Se dice, para que el tutor no crea que tiene minutos de más.
      console.error("[room/extender] Daily falló:", e);
      return NextResponse.json(
        { error: "No pudimos alargar la sala de video." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ endsAt: s.ends_at, closesAt: s.closes_at });
}
