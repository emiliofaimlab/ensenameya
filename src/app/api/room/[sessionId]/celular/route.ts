import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isDailyConfigured, mintToken } from "@/lib/daily";
import { SUFIJO_CELULAR } from "@/components/sala/celular";

/**
 * Segunda cámara · el tutor pide un token para meter su celular en la sala
 * como cámara de la hoja. El QR que pinta la sala lleva este token.
 *
 * Autoriza `join_session`, la misma barrera que la entrada normal, y además
 * exige ser el TUTOR. El token sale recortado a propósito:
 *   · `canSend: ["video"]` → el celular no manda audio (no hay eco) ni pantalla.
 *   · `user_id = <tutor>-cam` → la sala lo reconoce y lo pinta como la
 *     «pantalla» del tutor, no como un tercer participante.
 *   · sin owner y sin arrancar la grabación (la arranca el token del tutor).
 *   · `exp` del fin de la sesión, como cualquier otro token (`mintToken`).
 *
 * ponytail: el token viaja en el fragmento (`#`) de la URL del QR, no en una
 * firma propia: el fragmento no llega a ningún servidor. Techo: quien
 * fotografíe el QR puede mandar video a la sala hasta que acabe la clase.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!isDailyConfigured()) {
    return NextResponse.json({ error: "La sala de video no está disponible." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_session", { p_session_id: sessionId });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  const auth = data as { room_name: string; is_tutor: boolean; ends_at: string };
  if (!auth.is_tutor) {
    return NextResponse.json({ error: "Solo el tutor puede conectar un celular." }, { status: 403 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const token = await mintToken({
      room: auth.room_name,
      userName: "Celular",
      userId: `${user!.id}${SUFIJO_CELULAR}`,
      isOwner: false,
      endsAt: new Date(auth.ends_at),
      canSend: ["video"],
      startRecording: false,
    });
    return NextResponse.json({ token });
  } catch (e) {
    console.error("[room/celular] Daily falló:", e);
    return NextResponse.json({ error: "No pudimos preparar el celular." }, { status: 502 });
  }
}
