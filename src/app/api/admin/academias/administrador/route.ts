import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email-templates";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * A2 · RA-02 · nombra al administrador de una academia y le manda NTF-40.
 *
 * La decisión es de `admin_asignar_administrador` (20261109150000), llamada con
 * la sesión del admin: `has_role('admin')` se comprueba allí, no aquí. Esto
 * existe solo por el correo, que va DIRECTO por Resend: el invitado puede no
 * tener cuenta y la cola de `notifications` cuelga de un `recipient_id`.
 */
export async function POST(req: Request) {
  // Misma puerta que `api/checkout/invitado`: un formulario de otro sitio no
  // puede nombrar administradores con la cookie del admin.
  const origen = req.headers.get("origin");
  if (origen && new URL(origen).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "Petición inválida." }, { status: 403 });
  }

  const { user, roles } = await getSessionContext();
  if (!user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  if (!roles.includes("admin")) return NextResponse.json({ error: "no autorizado" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { academyId?: unknown; email?: unknown } | null;
  const academyId = typeof body?.academyId === "string" ? body.academyId : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!academyId || !email) {
    return NextResponse.json({ error: "Faltan la academia o el correo." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: resultado, error } = await supabase.rpc("admin_asignar_administrador", {
    p_academy: academyId,
    p_email: email,
  });
  if (error) {
    // Los `raise` de la RPC ya vienen en español y para el admin.
    const legible = error.code === "23514" || error.code === "P0002";
    return NextResponse.json(
      { error: legible ? error.message : "No se pudo nombrar al administrador." },
      { status: legible ? 400 : 500 },
    );
  }

  // La credencial es el interruptor: sin clave, el nombramiento vale igual.
  let correo: "enviado" | "sin-credencial" | "fallo" = "sin-credencial";
  if (isEmailConfigured()) {
    const { data: academia } = await supabase.from("academies").select("name").eq("id", academyId).maybeSingle();
    const render = renderEmail({
      template: "academy_admin_invited",
      payload: { academia: academia?.name ?? "" },
      nombre: "",
      baseUrl: siteUrl(),
    });
    const enviado = render ? await sendEmail({ to: email, ...render }) : { ok: false as const, error: "sin plantilla" };
    correo = enviado.ok ? "enviado" : "fallo";
    if (!enviado.ok) console.error("[admin/academias/administrador] NTF-40 no salió:", enviado.error);
  }

  return NextResponse.json({ resultado, correo });
}
