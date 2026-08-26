import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asRpc, type AnonymizeResult, type DeletionBlockers } from "./rpc";

/**
 * EY-192 · B5.9 — baja de cuenta con anonimización.
 *
 * GET  → los motivos por los que HOY no puedes darte de baja (o `{}` si puedes).
 * POST → ejecuta la baja. Irreversible.
 *
 * ── POR QUÉ ESTO ES UN ROUTE HANDLER Y NO UNA RPC LLAMADA DESDE EL NAVEGADOR ─
 * Regla de oro 7: es una operación destructiva sobre datos reales que además
 * toca el esquema `auth`. `anonymize_account` está concedida ÚNICAMENTE a
 * `service_role`, así que desde el cliente no se puede invocar ni con el uid
 * propio ni con el de otro. La función recibe el uid por parámetro porque
 * `service_role` no tiene `auth.uid()`; **quién puede dar de baja a quién se
 * decide AQUÍ**, y la respuesta es siempre «solo a uno mismo»: el uid que se
 * pasa sale de la cookie de sesión, nunca del cuerpo de la petición.
 *
 * ⚠️ Si alguna vez se añade un «dar de baja a este usuario» para el admin, NO
 * se hace aceptando un uid por el body de esta ruta. Se hace en una ruta
 * aparte, bajo `requireRole('admin')` y con su propio registro.
 *
 * ── LA CONFIRMACIÓN ─────────────────────────────────────────────────────────
 * No basta un botón. Hay que escribir el correo de la cuenta, y se comprueba
 * EN EL SERVIDOR contra el de la sesión: una comprobación solo en el cliente
 * no es una confirmación, es una sugerencia. Se eligió el correo y no un
 * «ELIMINAR» genérico porque es imposible de teclear por accidente y porque
 * obliga a mirar de QUÉ cuenta se está hablando — que con varias sesiones
 * abiertas no es evidente.
 */

const noAutenticado = () =>
  NextResponse.json({ error: "no autenticado" }, { status: 401 });

async function quienLlama() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, supabase, admin: createAdminClient() };
}

export async function GET() {
  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  const { data, error } = await asRpc(ctx.admin).rpc("account_deletion_blockers", {
    p_user_id: ctx.user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    email: ctx.user.email ?? null,
    bloqueos: (data ?? {}) as DeletionBlockers,
  });
}

export async function POST(req: Request) {
  const { confirmacion } = (await req.json().catch(() => ({}))) as {
    confirmacion?: string;
  };

  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  const email = ctx.user.email?.trim().toLowerCase();
  if (!email) {
    // Sin correo en la sesión no hay nada contra lo que confirmar. Antes de
    // inventarse otra prueba de identidad, se para: es una baja irreversible.
    return NextResponse.json(
      { error: "esta cuenta no tiene correo; escribe a info@ensenameya.com" },
      { status: 409 },
    );
  }

  if ((confirmacion ?? "").trim().toLowerCase() !== email) {
    return NextResponse.json(
      { error: "escribe el correo de tu cuenta tal cual para confirmar" },
      { status: 400 },
    );
  }

  // Se consultan aquí, aunque `anonymize_account` los vuelva a comprobar por
  // dentro, para poder contestar 409 con el motivo en vez de un 500 con el
  // texto de una excepción de Postgres.
  const { data: bloqueos, error: errBloqueos } = await asRpc(ctx.admin).rpc(
    "account_deletion_blockers",
    { p_user_id: ctx.user.id },
  );
  if (errBloqueos) {
    return NextResponse.json({ error: errBloqueos.message }, { status: 500 });
  }
  const pendientes = (bloqueos ?? {}) as DeletionBlockers;
  if (Object.keys(pendientes).length > 0) {
    return NextResponse.json(
      { error: "la cuenta todavía no puede darse de baja", bloqueos: pendientes },
      { status: 409 },
    );
  }

  const { data, error } = await asRpc(ctx.admin).rpc("anonymize_account", {
    p_user_id: ctx.user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // La sesión del navegador ya está muerta —`anonymize_account` borra las filas
  // de `auth.sessions` y `auth.refresh_tokens`—, pero la cookie sigue en el
  // navegador con un JWT que no caduca hasta dentro de ~1 h. El `signOut` de
  // aquí es el que la retira; el cliente además recarga a la portada.
  //
  // ⚠️ Y va envuelto a propósito: la baja YA está confirmada en base de datos
  // cuando se llega aquí. Si `signOut` fallara —y es probable que proteste,
  // porque le está pidiendo a GoTrue que cierre una sesión cuya fila acaba de
  // desaparecer— dejar que la excepción suba convertiría una baja hecha en un
  // «no se pudo eliminar la cuenta» en pantalla. La cookie huérfana ya no
  // autentica nada: su usuario está baneado y sin sesión.
  try {
    await ctx.supabase.auth.signOut();
  } catch {
    // Sin ruido: no hay nada que reintentar ni nada que contarle a la persona.
  }

  return NextResponse.json({ status: "ok", resultado: data as AnonymizeResult });
}
