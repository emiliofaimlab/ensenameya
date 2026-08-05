import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { ensureRoom, isDailyConfigured, mintToken } from "@/lib/daily";

/**
 * US-801 — entrar a la sala (Daily real).
 *
 * Orquesta lo que la BD no puede hacer sola:
 *   1. `join_session` (RPC) AUTORIZA: participante, reserva activa, ventana
 *      RN-18/S-45, y mueve el ciclo M5. Si algo falla, lanza y aquí se traduce.
 *      La barrera con dientes sigue siendo la BD, no este endpoint.
 *   2. Crea/reusa la sala en Daily y firma un meeting-token acotado a
 *      (sala, usuario, expiración). La API key nunca sale del servidor.
 *
 * El token no se almacena (Doc 1 §1.4.11): se firma en cada entrada.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const supabase = await createClient();

  // 1) Autorización + ciclo, con la sesión del usuario (RLS + guardas).
  const { data, error } = await supabase.rpc("join_session", {
    p_session_id: sessionId,
  });

  if (error) {
    // Los errores de negocio de la RPC (fuera de ventana, reserva inactiva…)
    // se devuelven tal cual: la UI ya los muestra.
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  const auth = data as { room_name: string; is_tutor: boolean; ends_at: string };

  // Sin credenciales de Daily → sala simulada. La autorización y el ciclo (lo
  // de arriba) YA ocurrieron: lo único que falta es el transporte de video.
  if (!isDailyConfigured()) {
    return NextResponse.json({
      simulated: true,
      roomUrl: `https://sim.daily.local/${auth.room_name}`,
      token: null,
      isTutor: auth.is_tutor,
      endsAt: auth.ends_at,
    });
  }

  // Nombre a mostrar en la sala. Si no hay perfil, un genérico por rol.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  // 2) Sala + token. La sala expira al cerrar la ventana (fin + 10 min, S-45):
  // aunque alguien guarde la URL, Daily no admite a nadie después.
  const windowClosesAt = new Date(new Date(auth.ends_at).getTime() + 10 * 60_000);

  // US-1801 · la sala se crea con grabación SOLO si los dos consintieron
  // (RN-42). La regla vive en `recording_allowed`, no aquí.
  const { data: allowed } = await supabase.rpc("recording_allowed", {
    p_session_id: sessionId,
  });

  try {
    const roomUrl = await ensureRoom(
      auth.room_name,
      windowClosesAt,
      allowed === true,
    );
    const token = await mintToken({
      room: auth.room_name,
      userName: profile?.full_name ?? (auth.is_tutor ? "Tutor" : "Alumno"),
      userId: user!.id,
      isOwner: auth.is_tutor, // el tutor controla la sala
      expiresAt: windowClosesAt,
    });

    return NextResponse.json({
      roomUrl,
      token,
      isTutor: auth.is_tutor,
      endsAt: auth.ends_at,
      recording: allowed === true,
    });
  } catch (e) {
    // Fallo del proveedor: la sesión ya quedó `in_progress` (el join se
    // autorizó). Se informa sin filtrar detalles de la API key.
    console.error("[room] Daily falló:", e);
    return NextResponse.json(
      { error: "No pudimos abrir la sala de video. Inténtalo de nuevo." },
      { status: 502 },
    );
  }
}
