import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  RECORDING_DAYS,
  isDailyConfigured,
  listRecordings,
  recordingLink,
} from "@/lib/daily";

/**
 * US-1802 · ver y descargar la grabación de una sesión.
 *
 * GET  → si hay grabación y sigue dentro de los 30 días, un enlace firmado.
 *
 * Autorización por RLS: si la consulta de `sessions` no devuelve la fila, no
 * hay nada que enseñar.
 *
 * ⚠️ CORRECCIÓN (EY-189, 31-ago). Esta línea decía «ni el admin la ve — el
 * criterio es el del chat, RN-41», y es falso: `sessions_select_admin` existe
 * desde EP-06 (`20260709140000:153-155`), así que un admin SÍ recibe la fila y
 * este endpoint le devuelve el enlace firmado. Comprobado contra dev: sesión
 * `28794f4a…` → `status:"ready"`. Es lo que hace posible «ver la grabación»
 * desde la ficha de un reporte, y conviene que esté escrito donde toca en vez
 * de que el próximo lector construya encima de una limitación que no existe.
 * (Quien SÍ queda fuera del criterio del chat es `conversations`, que no tiene
 * política de admin a propósito — esa parte de RN-41 sigue en pie.)
 *
 * La caducidad se aplica **al servir**: pasados los 30 días el enlace deja de
 * darse. Quien lo borra de verdad en el proveedor es el job diario
 * `/api/cron/recordings-purge`; esta comprobación se queda igualmente porque
 * cierra la ventana entre que la grabación vence y el job pasa.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, status, end_at, daily_room_name, group_class_id, booking_id, tutor_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  // B1 · que la RLS devuelva la sesión NO basta en una grupal: quien se dio de
  // baja, o abrió el checkout y lo abandonó, conserva su fila de `sessions`, y
  // con ella se llevaba el enlace firmado de la clase entera (caras y voces de
  // los demás). Para el ALUMNO, la sesión tiene que seguir viva y su reserva,
  // pagada. El tutor (que en grupal no tiene sesión propia y llega por la de un
  // alumno) y el admin (la ficha de un reporte, EY-189) no dependen de eso: si
  // ese alumno se reembolsó, la grabación de la clase sigue siendo suya. En 1:1
  // la sala es la de esa sesión: una cancelada nunca llegó a grabarse.
  const { user, roles } = await getSessionContext();
  const esAlumno = user?.id !== session.tutor_id && !roles.includes("admin");
  if (session.group_class_id && esAlumno) {
    const { data: reserva } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", session.booking_id)
      .maybeSingle();
    if (
      session.status === "cancelled" ||
      !reserva ||
      !["confirmed", "in_progress", "completed"].includes(reserva.status)
    ) {
      return NextResponse.json({ error: "no encontrada" }, { status: 404 });
    }
  }

  // G3 · una sesión grupal no tiene sala propia: graba la de su FECHA (RG-12),
  // y la ven todos los inscritos. El nombre de sala no tiene grant de columna
  // para el cliente (`20261009210000`), así que se lee con service_role — y
  // solo después de que la RLS y la guarda B1 de arriba hayan dicho que esta
  // sesión es tuya y sigue viva.
  if (session.group_class_id) {
    const { data: g } = await createAdminClient()
      .from("group_classes")
      .select("daily_room_name, end_at")
      .eq("id", session.group_class_id)
      .maybeSingle();
    session.daily_room_name = g?.daily_room_name ?? null;
    if (g?.end_at) session.end_at = g.end_at;
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
