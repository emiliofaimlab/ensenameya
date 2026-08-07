import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isDailyConfigured, listRecordings, recordingLink } from "@/lib/daily";

/** RN-42 / NTF-19: la grabación vive 30 días desde que la clase termina. */
export const RECORDING_DAYS = 30;

/**
 * US-1802 · ver y descargar la grabación de una sesión.
 *
 * GET  → si hay grabación y sigue dentro de los 30 días, un enlace firmado.
 *
 * Autorización por RLS: si la consulta de `sessions` no devuelve la fila, no
 * eres participante y no hay nada que enseñar (ni el admin la ve — el criterio
 * es el del chat, RN-41).
 *
 * La caducidad se aplica **al servir**: pasados los 30 días el enlace deja de
 * darse aunque el fichero siga en Daily. Borrarlo allí necesita la API key en
 * un job (Edge Function), igual que el `provider.payout()` de EP-10 — hasta
 * entonces la retención se cumple de cara al usuario, no en el proveedor.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, status, end_at, daily_room_name")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  const expiresAt = new Date(
    new Date(session.end_at).getTime() + RECORDING_DAYS * 86_400_000,
  );
  if (Date.now() > expiresAt.getTime()) {
    return NextResponse.json({ status: "expired", expiresAt }, { status: 410 });
  }

  // Sin credenciales de Daily no hay grabación que buscar: el add-on es del
  // proveedor. Se dice, no se finge (mismo criterio que la sala simulada).
  if (!isDailyConfigured()) {
    return NextResponse.json({ status: "unavailable", simulated: true });
  }

  // El nombre de sala lo escribe `join_session` en la propia fila. Se LEE, no
  // se vuelve a derivar: derivarlo aquí ya falló una vez —la BD lo construye
  // como `'ey-' || replace(id::text,'-','')` y aquí se montaba con los guiones,
  // así que el nombre nunca coincidía y toda grabación salía como inexistente.
  // Si es null, nadie llegó a entrar a la sala: no hay nada que grabar.
  if (!session.daily_room_name) {
    return NextResponse.json({ status: "none", expiresAt });
  }

  const recordings = await listRecordings(session.daily_room_name);
  if (recordings.length === 0) {
    return NextResponse.json({ status: "none", expiresAt });
  }

  // La más reciente: si la clase se grabó en dos tramos, el último es el bueno.
  const latest = recordings.sort((a, b) => b.start_ts - a.start_ts)[0];
  const url = await recordingLink(latest.id);
  if (!url) {
    return NextResponse.json({ status: "unavailable" }, { status: 502 });
  }

  return NextResponse.json({
    status: "ready",
    url,
    durationSecs: latest.duration,
    expiresAt,
  });
}
