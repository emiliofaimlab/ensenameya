import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/server";
import { aMaterialDeSala, materialesDeLaSesion } from "@/lib/sala/materiales";

/**
 * EY-221 · La lista de materiales que el tutor puede presentar en la sala.
 *
 * Devuelve TODOS los de la mentoría, presentables o no: el panel enseña los
 * Word/PowerPoint/Excel deshabilitados con «Para presentarlo, súbelo en PDF»,
 * que es justo lo que el tutor necesita saber para arreglarlo. Sin URLs: la
 * firma se pide fichero a fichero, solo del que se va a abrir (ver
 * `[materialId]/route.ts`).
 *
 * La autorización es la de `materialesDeLaSesion` (participante de la sesión +
 * RLS). Fuera de eso, 404 — no se confirma la existencia de sesiones ajenas.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const { user } = await getSessionContext();
  if (!user) {
    return NextResponse.json({ error: "auth requerido" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    const filas = await materialesDeLaSesion(supabase, sessionId, user.id);
    if (filas === null) {
      return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    }
    return NextResponse.json(
      { materiales: filas.map(aMaterialDeSala) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[sala/materiales] lista:", e);
    return NextResponse.json(
      { error: "No pudimos cargar los materiales." },
      { status: 500 },
    );
  }
}
