import { NextResponse } from "next/server";

import { googleCalendarConfigurado, sincronizar } from "@/lib/google-calendar";

/**
 * Lo llama el trigger `avisar_google_calendar` por `pg_net` cuando cambia una
 * sesión o su reserva (`20260925180000`). Mismo secreto que los crons.
 *
 * ⚠️ `pg_net` no reintenta y nadie mira su respuesta: un fallo aquí queda en
 * los logs de Vercel y el evento se corrige en el siguiente cambio de la sesión.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  if (!googleCalendarConfigurado()) return NextResponse.json({ estado: "sin-credencial" });

  const body = (await req.json().catch(() => null)) as { sesiones?: unknown } | null;
  const sesiones = Array.isArray(body?.sesiones)
    ? body.sesiones.filter((s): s is string => typeof s === "string").slice(0, 200)
    : [];
  if (sesiones.length === 0) return NextResponse.json({ error: "sin sesiones" }, { status: 400 });

  const r = await sincronizar(new URL(req.url).origin, { sesiones });
  return NextResponse.json(r, { status: r.fallos > 0 ? 502 : 200 });
}
