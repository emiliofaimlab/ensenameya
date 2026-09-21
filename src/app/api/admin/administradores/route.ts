import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Dar y quitar acceso de admin desde `/admin/administradores`.
 *
 * ── LO QUE ESTE FICHERO **NO** HACE ─────────────────────────────────────────
 *
 * Tocar `user_roles`. Esa tabla no tiene políticas de escritura desde el primer
 * día y sigue sin tenerlas (RN-31/S-31): aquí se llaman dos funciones con
 * nombre propio, `conceder_admin` y `revocar_admin` (`20260921200000`), que son
 * las únicas que `service_role` puede usar para escribir ahí. La diferencia no
 * es de estilo: un `grant insert` a secas habría concedido «acuñar cualquier
 * rol a cualquiera» a todo Route Handler futuro de este repo.
 *
 * ── LAS DOS CERRADURAS ──────────────────────────────────────────────────────
 *
 * Rol de admin leído en el SERVIDOR, y el uid del que pulsa viajando hasta la
 * RPC, que lo REVERIFICA por dentro. Las funciones corren con `service_role`,
 * o sea sin `auth.uid()`: sin ese argumento no sabrían quién llama, igual que
 * `confirm_credit_booking`.
 *
 * ⚠️ Y LA REGLA DE «NO TE QUITAS A TI MISMO» ESTÁ EN LA BASE, no aquí. Aquí se
 * traduce su error a algo legible, nada más. Ponerla solo en la pantalla sería
 * dejar el invariante «siempre queda un admin» colgando de que nadie llame a
 * este endpoint con `curl`.
 */

/** `service_role` es server-only. */
export const runtime = "nodejs";

/**
 * Guarda de rol en servidor, y además devuelve QUIÉN es: las dos RPC lo piden.
 *
 * `requireRole('admin')` haría `redirect()`, o sea un 307 hacia el HTML del
 * login que un `fetch()` se tragaría como si fuera la respuesta de la API.
 */
async function actorAdmin(): Promise<
  { error: NextResponse } | { actor: string }
> {
  const { user, roles } = await getSessionContext();
  if (!user) {
    return { error: NextResponse.json({ error: "sin sesión" }, { status: 401 }) };
  }
  if (!roles.includes("admin")) {
    return { error: NextResponse.json({ error: "no autorizado" }, { status: 403 }) };
  }
  return { actor: user.id };
}

function adminClient():
  | { error: NextResponse }
  | { admin: ReturnType<typeof createAdminClient> } {
  try {
    return { admin: createAdminClient() };
  } catch {
    return {
      error: NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno" },
        { status: 503 },
      ),
    };
  }
}

/**
 * Lo que la persona lee cuando la RPC se niega.
 *
 * Se traduce por `code` y no por el texto del mensaje: los textos de Postgres
 * cambian de versión y de idioma, y comparar cadenas es cómo un mensaje útil se
 * convierte en «error inesperado» sin que nadie lo note.
 */
function mensajeDeRpc(code: string | undefined, mensaje: string): string {
  if (code === "P0002") return mensaje; // no_data_found: «no hay ninguna cuenta con…»
  if (code === "23514") return mensaje; // check_violation: «no puedes quitarte a ti mismo…»
  if (code === "42501") return "Tu sesión ya no tiene acceso de admin.";
  return "No se pudo completar el cambio. Vuelve a intentarlo.";
}

/** Dar admin, por correo. */
export async function POST(req: Request) {
  const quien = await actorAdmin();
  if ("error" in quien) return quien.error;

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "el cuerpo no es JSON" }, { status: 400 });
  }

  const { email } = (cuerpo ?? {}) as Record<string, unknown>;
  const correo = typeof email === "string" ? email.trim() : "";
  // Validación de FORMA, no de existencia: quien decide si esa cuenta existe es
  // la RPC, que es la única que puede mirar `auth.users`.
  if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  }

  const cli = adminClient();
  if ("error" in cli) return cli.error;

  const { data, error } = await cli.admin.rpc("conceder_admin", {
    p_email: correo,
    p_actor: quien.actor,
  });

  if (error) {
    console.error("[admin/administradores] conceder:", error.code, error.message);
    return NextResponse.json(
      { error: mensajeDeRpc(error.code, error.message) },
      { status: error.code === "P0002" ? 404 : 400 },
    );
  }

  return NextResponse.json({ status: "ok", ...(data as Record<string, unknown>) });
}

/** Quitar admin, por id de usuario. */
export async function DELETE(req: Request) {
  const quien = await actorAdmin();
  if ("error" in quien) return quien.error;

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "el cuerpo no es JSON" }, { status: 400 });
  }

  const { user_id } = (cuerpo ?? {}) as Record<string, unknown>;
  if (
    typeof user_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)
  ) {
    return NextResponse.json({ error: "id de usuario no válido" }, { status: 400 });
  }

  const cli = adminClient();
  if ("error" in cli) return cli.error;

  const { data, error } = await cli.admin.rpc("revocar_admin", {
    p_user: user_id,
    p_actor: quien.actor,
  });

  if (error) {
    console.error("[admin/administradores] revocar:", error.code, error.message);
    return NextResponse.json(
      { error: mensajeDeRpc(error.code, error.message) },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: "ok", ...(data as Record<string, unknown>) });
}
