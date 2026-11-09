import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * EY-248 · Descargar un PDF del perfil del tutor a cambio de nombre + email.
 *
 * Mismo patrón que `POST /api/contacto` (DL-01): el formulario es público, así
 * que el lead lo escribe SOLO este handler con `service_role` —la tabla no
 * tiene política de insert— después de validar, mirar el honeypot y limitar
 * por IP. Guardado el lead, se firma la URL del bucket privado: si el bucket
 * fuera público el formulario se saltaría copiando el enlace.
 *
 * ⚠️ Regla de oro 9: funciona porque `20261109120000` declara los grants a
 * `service_role` en `tutor_download_leads`.
 */

const MAX_POR_IP = 10;
const VENTANA_MIN = 10;
/** Lo justo para que el navegador empiece la descarga; no es un enlace para compartir. */
const URL_TTL_S = 300;

const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot: 200 sin URL, para no enseñarle al bot qué falló.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ status: "ok" });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (name.length < 1 || name.length > 120) {
    return NextResponse.json({ error: "Escribe tu nombre." }, { status: 400 });
  }
  if (email.length < 3 || email.length > 254 || !emailValido(email)) {
    return NextResponse.json(
      { error: "Revisa tu correo: no parece una dirección válida." },
      { status: 400 },
    );
  }
  if (body.consent !== true) {
    return NextResponse.json(
      { error: "Para descargarlo tienes que aceptar compartir tus datos." },
      { status: 400 },
    );
  }

  // Se lee con la clave anon: la política pública decide si el documento
  // existe (vivo y de un tutor aprobado). Un id inventado o retirado da 404.
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("tutor_downloads")
    .select("id, tutor_id, file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!doc) {
    return NextResponse.json({ error: "Ese documento ya no está disponible." }, { status: 404 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const admin = createAdminClient();

  // ponytail: sin cabecera de IP (solo en local) no hay límite, igual que /api/contacto.
  if (ip) {
    const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
    const { count } = await admin
      .from("tutor_download_leads")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", desde);
    if ((count ?? 0) >= MAX_POR_IP) {
      return NextResponse.json(
        { error: "Hiciste varias descargas seguidas. Espera unos minutos." },
        { status: 429 },
      );
    }
  }

  const { error: errorLead } = await admin.from("tutor_download_leads").insert({
    download_id: doc.id,
    tutor_id: doc.tutor_id,
    name,
    email,
    ip,
    user_agent: userAgent,
  });
  if (errorLead) {
    console.error("[descargables] no se pudo guardar el lead", errorLead);
    return NextResponse.json(
      { error: "No pudimos preparar la descarga. Inténtalo en un momento." },
      { status: 500 },
    );
  }

  const { data: firmada, error: errorFirma } = await admin.storage
    .from("tutor-downloads")
    .createSignedUrl(doc.file_path, URL_TTL_S, { download: doc.file_name });
  if (errorFirma || !firmada) {
    console.error("[descargables] no se pudo firmar", errorFirma);
    return NextResponse.json(
      { error: "No pudimos preparar la descarga. Inténtalo en un momento." },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok", url: firmada.signedUrl });
}
