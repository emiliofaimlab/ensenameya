import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Encender o apagar un método de cobro desde `/admin/metodos-de-cobro`.
 *
 * Lo único que escribe es `payout_manual_channels.is_active`, y eso es todo lo
 * que hace falta: `metodosDelPais` construye las tarjetas del tutor recorriendo
 * los canales ACTIVOS, así que un canal apagado deja de pintarse sin tocar una
 * fila de nadie. El `comment on column` de esa columna lleva prevista esta
 * operación desde el 2-sep-2026 («apagar un canal es un UPDATE, no una
 * migración»); lo que no había era quién pulsaba.
 *
 * ── LAS DOS CERRADURAS, IGUAL QUE EN `/api/admin/referidos/[id]` ────────────
 *
 * Rol de admin leído en el SERVIDOR, y escritura con `service_role` porque
 * `payout_manual_channels` no tiene políticas de escritura para nadie: su RLS
 * solo abre el `select` a `authenticated`.
 *
 * ⚠️ Y el `grant` es de `20260921180000`, por columna. Sin esa migración esto
 * responde `permission denied` en tiempo de ejecución aunque el build esté en
 * verde (regla de oro 9).
 */

/** `service_role` es server-only. */
export const runtime = "nodejs";

/**
 * Guarda de rol en servidor. `requireRole('admin')` haría `redirect()`, o sea
 * un 307 hacia el HTML del login que un `fetch()` se tragaría como si fuera la
 * respuesta de la API.
 *
 * // ponytail: copiada de `../../referidos/[id]/route.ts`, que a su vez la
 * copió de su hermano. Un `route.ts` no puede exportar nada que no sea un
 * método HTTP sin romper el typecheck de Next.
 */
async function soloAdmin(): Promise<NextResponse | null> {
  const { user, roles } = await getSessionContext();
  if (!user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  if (!roles.includes("admin")) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  req: Request,
  // Next 16: `params` es una promesa.
  { params }: { params: Promise<{ channel: string }> },
) {
  const noPasa = await soloAdmin();
  if (noPasa) return noPasa;

  const { channel } = await params;
  // El mismo `check` que la tabla (`^[a-z][a-z0-9_]{1,30}$`). Se mira aquí para
  // no mandarle a Postgres una cadena arbitraria desde la URL: el `eq` de
  // PostgREST la parametriza, pero un canal inventado tiene que contestar 404 y
  // no un 200 con cero filas tocadas.
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(channel)) {
    return NextResponse.json({ error: "canal no válido" }, { status: 400 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "el cuerpo no es JSON" }, { status: 400 });
  }

  const { is_active } = (cuerpo ?? {}) as Record<string, unknown>;
  if (typeof is_active !== "boolean") {
    return NextResponse.json(
      { error: "«is_active» tiene que ser un booleano." },
      { status: 400 },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno" },
      { status: 503 },
    );
  }

  // `updated_at` lo pone el trigger de la tabla.
  const { data, error } = await admin
    .from("payout_manual_channels")
    .update({ is_active })
    .eq("channel", channel)
    .select("channel, is_active");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Un `update` que no encuentra la fila NO es un error en PostgREST: devuelve
  // lista vacía y 200. Sin esto, un canal borrado dejaría a la pantalla
  // diciendo «Guardado» para siempre (regla de oro 10).
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Ese método ya no existe." }, { status: 404 });
  }

  return NextResponse.json({ status: "ok", is_active: data[0].is_active });
}
