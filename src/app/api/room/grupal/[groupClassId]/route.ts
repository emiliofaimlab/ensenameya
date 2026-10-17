import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  ensureRoom,
  isDailyConfigured,
  mintToken,
  participantEjectAfterSec,
} from "@/lib/daily";

/**
 * G3 · entrar a la sala COMPARTIDA de una fecha grupal (RG-12). Gemelo de
 * `/api/room/[sessionId]`: allí autoriza `join_session`, aquí
 * `join_group_class` (tutor anfitrión o alumno con su sesión pagada de esa
 * fecha), y la sala admite cupo + 4 (margen para otra pestaña o una
 * reconexión). El resto —sala con grabación, token corto firmado en cada
 * entrada, la API key sin salir del servidor— es lo mismo y se explica allí.
 *
 * B10 · el nombre que ven los demás sale enmascarado de `join_group_class`
 * (RG-19): «Mariana X.» para un alumno —pueden ser menores, y el chat ya lo
 * enmascaraba—, el nombre público para el tutor. Antes se leía aquí
 * `profiles.full_name` y la sala enseñaba el nombre completo.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ groupClassId: string }> },
) {
  const { groupClassId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("join_group_class", {
    p_group_class: groupClassId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  const auth = data as {
    room_name: string;
    is_tutor: boolean;
    starts_at: string;
    ends_at: string;
    closes_at: string;
    max_participants: number;
    /** El uuid de quien entra. */
    user_id: string;
    /** Ya enmascarado para un alumno; nunca null. */
    user_name: string;
  };

  if (!isDailyConfigured()) {
    return NextResponse.json({
      simulated: true,
      roomUrl: `https://sim.daily.local/${auth.room_name}`,
      token: null,
      isTutor: auth.is_tutor,
      endsAt: auth.ends_at,
    });
  }

  try {
    // Grabación siempre (RN-42): en una grupal no hay `recording_allowed` por
    // sesión, y la regla de fondo es la misma.
    const roomUrl = await ensureRoom(
      auth.room_name,
      new Date(auth.closes_at),
      true,
      participantEjectAfterSec(new Date(auth.starts_at), new Date(auth.ends_at)),
      auth.max_participants,
    );
    const token = await mintToken({
      room: auth.room_name,
      userName: auth.user_name,
      userId: auth.user_id,
      // El tutor es el anfitrión: silencia o saca a alguien desde la lista de
      // participantes de Daily, que solo enseña esos controles a un owner.
      isOwner: auth.is_tutor,
      endsAt: new Date(auth.ends_at),
    });
    return NextResponse.json({
      roomUrl,
      token,
      isTutor: auth.is_tutor,
      endsAt: auth.ends_at,
      recording: true,
    });
  } catch (e) {
    console.error("[room/grupal] Daily falló:", e);
    return NextResponse.json(
      { error: "No pudimos abrir la sala de video. Inténtalo de nuevo." },
      { status: 502 },
    );
  }
}
