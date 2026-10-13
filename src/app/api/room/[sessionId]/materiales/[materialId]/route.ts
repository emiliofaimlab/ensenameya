import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/server";
import { materialesDeLaSesion } from "@/lib/sala/materiales";
import { esPresentable } from "@/components/sala/formatos-presentables";

/**
 * EY-221 · URL firmada, de vida CORTA, del PDF que se presenta en la sala.
 *
 * La pide cada participante por su cuenta: el tutor al elegir el material, y
 * el alumno cuando le llega por `app-message` el `docId` que se está
 * presentando. Por el canal de Daily viaja el id, nunca la URL: así quien
 * reciba el mensaje tiene que pasar por aquí, y aquí se comprueba que es parte
 * de ESTA sesión y que el material es de SU mentoría.
 *
 * 120 s porque el visor la usa una vez, al momento, para bajar el fichero
 * entero (`fetch` → `ArrayBuffer` → pdf.js). No hace falta que sobreviva a la
 * clase; si alguien la copia de la red, caduca enseguida.
 */
const TTL_SEGUNDOS = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; materialId: string }> },
) {
  const { sessionId, materialId } = await params;
  const { user } = await getSessionContext();
  if (!user) {
    return NextResponse.json({ error: "auth requerido" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    const filas = await materialesDeLaSesion(supabase, sessionId, user.id);
    const m = filas?.find((f) => f.id === materialId);
    if (!m) {
      return NextResponse.json({ error: "no encontrado" }, { status: 404 });
    }
    // Hoy solo PDF. El punto de extensión para convertir Office está en
    // `formatos-presentables.ts`: aquí iría la URL del PDF convertido.
    if (!esPresentable(m.file_name)) {
      return NextResponse.json(
        { error: "Para presentarlo, súbelo en PDF." },
        { status: 415 },
      );
    }

    // Firma con la sesión del usuario: la política de `storage.objects`
    // (`materials_select_student` o la de carpeta del tutor) es la que decide.
    const { data, error } = await supabase.storage
      .from("tutor-materials")
      .createSignedUrl(m.storage_path, TTL_SEGUNDOS);
    if (error || !data?.signedUrl) {
      console.error("[sala/materiales] firma:", error);
      return NextResponse.json(
        { error: "No pudimos abrir el material." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { url: data.signedUrl, nombre: m.file_name },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[sala/materiales] material:", e);
    return NextResponse.json(
      { error: "No pudimos abrir el material." },
      { status: 500 },
    );
  }
}
