import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  RECORDING_DAYS,
  isDailyConfigured,
  listRecordings,
  recordingLink,
} from "@/lib/daily";

/**
 * A6 · la grabación de una FECHA grupal, pedida por la fecha y no por una
 * sesión. Es la vía del TUTOR: en una grupal no tiene sesión propia, y hasta
 * ahora no tenía dónde ver lo que se grabó en su clase. Gemelo de
 * `/api/recordings/[sessionId]`: mismos estados (`ready` | `none` |
 * `unavailable` | `expired`), mismos 404 y 410.
 *
 * Autorización: la RPC `grabacion_de_fecha` (SECURITY DEFINER) aplica la
 * misma regla que la guarda B1 del gemelo —el tutor de la clase, un admin, o
 * un alumno con la sesión viva y la reserva pagada— y solo entonces devuelve
 * el nombre de sala. Por eso aquí no hace falta `service_role`: si no estás
 * autorizado, la RPC no devuelve fila y esto es un 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ groupClassId: string }> },
) {
  const { groupClassId } = await params;
  const supabase = await createClient();

  // Hasta que `database.types.ts` se regenere con la RPC nueva, el cast es el
  // contrato: un array vacío es «no autorizado o no existe»; `room_name` null,
  // que nadie llegó a entrar.
  const { data, error } = (await supabase.rpc(
    "grabacion_de_fecha" as never,
    { p_group_class: groupClassId } as never,
  )) as unknown as {
    data: { room_name: string | null; end_at: string }[] | null;
    error: { message: string } | null;
  };

  // Regla 10 · un fallo de la RPC no se disfraza de «no encontrada».
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const fecha = data?.[0];
  if (!fecha) {
    return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  }

  const expiresAt = new Date(
    new Date(fecha.end_at).getTime() + RECORDING_DAYS * 86_400_000,
  );
  if (Date.now() > expiresAt.getTime()) {
    return NextResponse.json({ status: "expired", expiresAt }, { status: 410 });
  }

  // Sin credenciales de Daily no hay grabación que buscar (mismo criterio que
  // el gemelo y la sala simulada).
  if (!isDailyConfigured()) {
    return NextResponse.json({ status: "unavailable", simulated: true });
  }

  // El nombre de sala lo escribe `join_group_class` en la fecha; si es null,
  // nadie entró y no hay nada que grabar.
  if (!fecha.room_name) {
    return NextResponse.json({ status: "none", expiresAt });
  }

  const recordings = await listRecordings(fecha.room_name);
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
