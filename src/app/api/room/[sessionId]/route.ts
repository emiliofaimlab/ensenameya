import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  ensureRoom,
  isDailyConfigured,
  mintToken,
  participantEjectAfterSec,
} from "@/lib/daily";

/**
 * US-801 — entrar a la sala (Daily real).
 *
 * Orquesta lo que la BD no puede hacer sola:
 *   1. `join_session` (RPC) AUTORIZA: participante, reserva activa, ventana de
 *      acceso (RN-18; desde MN-05, 7 días a cada lado) y —solo si esto es de
 *      verdad la hora de la clase— mueve el ciclo M5. Si algo falla, lanza y
 *      aquí se traduce. La barrera con dientes sigue siendo la BD.
 *   2. Crea/reusa la sala en Daily y firma un meeting-token acotado a
 *      (sala, usuario, expiración). La API key nunca sale del servidor.
 *      La expiración del token es la SUYA, no la de la sala (MN-05a).
 *
 * ⚠️ Este endpoint se llama MÁS DE UNA VEZ por clase desde MN-05: la sala lo
 * vuelve a pedir cuando se abre la ventana de la mentoría para que el ciclo M5
 * se mueva aunque el alumno hubiera entrado horas antes. Es idempotente —
 * `join_session` no repite transiciones— pero cada llamada firma un token
 * nuevo, así que no se llama en bucle.
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

  // Tres relojes, tres consumidores. `join_session` los devuelve por separado
  // desde MN-05 justamente para que nadie vuelva a usar uno donde va otro:
  //   · `ends_at`   → fin de la mentoría → `exp` del meeting-token (corto).
  //   · `closes_at` → `sessions.access_closes_at` → `exp` de la SALA (7 días).
  //   · `starts_at` → con `ends_at`, la duración de la clase → tope de minutos
  //                   que un participante puede estar conectado de seguido.
  const auth = data as {
    room_name: string;
    is_tutor: boolean;
    starts_at: string;
    ends_at: string;
    closes_at: string;
  };

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

  // 2) Sala + token. La sala expira cuando cierra la ventana de acceso, que
  // desde MN-05 es `end_at + 7 días` y ya NO se calcula aquí: la trae la BD en
  // `closes_at` (columna `sessions.access_closes_at`). Antes esta línea era un
  // `+ 10 * 60_000` a mano, y era uno de los cinco sitios donde la ventana
  // estaba duplicada. Aunque alguien guarde la URL, pasado ese `exp` Daily no
  // admite a nadie.
  //
  // ⚠️ MN-05a: esta fecha es SOLO de la sala. El token NO la hereda — lo firma
  // `mintToken` a partir del fin de la sesión, corto y por su cuenta. Con la
  // sala viva una semana, pasársela al token sería firmar credenciales de
  // acceso válidas siete días. Si se la vuelves a pasar, deshaces exactamente
  // eso, y no lo va a avisar ni el typecheck: los dos son `Date`.
  const roomClosesAt = new Date(auth.closes_at);

  // US-1801 · la sala se crea con grabación SOLO si los dos consintieron
  // (RN-42). La regla vive en `recording_allowed`, no aquí.
  const { data: allowed } = await supabase.rpc("recording_allowed", {
    p_session_id: sessionId,
  });

  try {
    const roomUrl = await ensureRoom(
      auth.room_name,
      roomClosesAt,
      allowed === true,
      // MN-05 · con la sala viva 7 días, `eject_at_room_exp` dejó de ser el
      // tope de nadie. Este es el que queda, y se cuenta desde que cada persona
      // entra. Ver `participantEjectAfterSec`.
      participantEjectAfterSec(new Date(auth.starts_at), new Date(auth.ends_at)),
    );
    const token = await mintToken({
      room: auth.room_name,
      userName: profile?.full_name ?? (auth.is_tutor ? "Tutor" : "Alumno"),
      userId: user!.id,
      isOwner: auth.is_tutor, // el tutor controla la sala
      endsAt: new Date(auth.ends_at),
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
