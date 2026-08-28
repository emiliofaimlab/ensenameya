import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONTACT_KIND_SPECS,
  MAX_ADJUNTOS,
  SUPPORT_BUCKET,
  SUPPORT_MAX_BYTES,
  esContactKind,
} from "@/lib/contact/request-kinds";
import { humanSize, maxLabel } from "@/components/tutor/upload-formats";

/**
 * DL-01 · el permiso de subida de un adjunto del formulario de contacto.
 *
 * ── POR QUÉ HAY UN ENDPOINT PARA ESTO ───────────────────────────────────────
 * El resto del proyecto sube del navegador a Storage con la clave anon, y la
 * RLS de Storage decide (la carpeta es el uid del tutor, o el id de la reserva
 * y sus dos participantes). Aquí no sirve: **el formulario es público** —lo
 * exige dLocal, hay que poder escribir sin cuenta— así que no hay uid ni
 * reserva contra los que comprobar nada, y una política de `insert` para `anon`
 * convertiría el bucket en alojamiento de ficheros gratis. Es el mismo
 * razonamiento que dejó a `contact_messages` sin `insert` para `anon`.
 *
 * La salida es una **URL de subida firmada**: aquí se valida tipo, tamaño,
 * nombre y cuántos van, y solo entonces se emite el token con `service_role`.
 * El navegador sube contra el token, no contra la RLS.
 *
 * ── POR QUÉ NO VIAJAN LOS BYTES POR AQUÍ ────────────────────────────────────
 * Sería más simple recibir el fichero en este handler y subirlo nosotros, pero
 * en Vercel el cuerpo de una función serverless está topado en 4,5 MB: con eso,
 * la UI prometería 25 MB y Storage nunca los vería. Un tope que la UI miente es
 * exactamente lo que MN-11a lleva media docena de avisos intentando evitar.
 *
 * ⚠️ ESTO NO ES ANTISPAM. Limita a `MAX_ADJUNTOS` por carpeta, y la carpeta la
 * elige quien llama, así que quien quiera abusar solo tiene que inventarse
 * otra. Lo que acota el daño de verdad es la purga: los objetos sin mensaje que
 * los reclame se encolan para borrado al día siguiente (`20260828161500`). Un
 * captcha aquí sería fricción en el formulario que dLocal tiene que poder usar,
 * y el mismo criterio ya se tomó en `POST /api/contacto`.
 */

/** La carpeta es el id de la solicitud, y tiene que ser un uuid: si no, un
 *  nombre con `..` o con barras se saldría de su sitio en el bucket. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tope del nombre, el mismo `check` que la columna `file_name`. */
const MAX_NOMBRE = 200;

/**
 * El nombre que ve Storage. Se conserva el original en la BD (`file_name`) para
 * que la bandeja lo enseñe tal cual; esto es solo la ruta, y ahí un nombre con
 * barras, acentos raros o un `#` da problemas al firmar la URL de descarga.
 */
function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80); // por la cola: lo que importa conservar es la extensión
  return limpio.replace(/^[._]+/, "") || "adjunto";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const folder = typeof body.folder === "string" ? body.folder : "";
  const nombre = typeof body.name === "string" ? body.name.trim() : "";
  const tipoMime = typeof body.type === "string" ? body.type : "";
  const tamano = typeof body.size === "number" ? body.size : -1;

  if (!UUID.test(folder)) {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  // A local antes de comprobarlo: el estrechamiento de una `const` vale para
  // todo lo que venga después, mirar `body.kind` dos veces no.
  const tipoSolicitud = body.kind;
  if (!esContactKind(tipoSolicitud)) {
    return NextResponse.json(
      { error: "Elige un tipo de solicitud." },
      { status: 400 },
    );
  }
  const spec = CONTACT_KIND_SPECS[tipoSolicitud];
  // A variable local y no `spec.types` a secas: así el estrechamiento del `if`
  // de abajo vale para todo el resto de la función.
  const tiposAdmitidos = spec.types;
  const pista = spec.hint ?? "";

  // Un tipo que no lleva ficheros no recibe permiso de subida. El formulario ya
  // esconde el selector, pero esto es lo que no se puede saltar tocando el
  // navegador.
  if (!tiposAdmitidos) {
    return NextResponse.json(
      { error: "Ese tipo de solicitud no admite archivos." },
      { status: 400 },
    );
  }

  if (nombre.length < 1 || nombre.length > MAX_NOMBRE) {
    return NextResponse.json(
      { error: "El nombre del archivo no es válido." },
      { status: 400 },
    );
  }

  // Mismo criterio que `fileProblem`: el mensaje repite lo que SÍ vale, porque
  // quien acaba de equivocarse necesita saberlo. Aquí no se puede reusar la
  // función —recibe un `File` del navegador y nosotros solo tenemos su ficha—,
  // así que se repiten las dos comprobaciones con las mismas constantes.
  if (!tiposAdmitidos.includes(tipoMime)) {
    return NextResponse.json(
      { error: `«${nombre}»: ese formato no se admite. Acepta ${pista}.` },
      { status: 400 },
    );
  }
  if (!Number.isFinite(tamano) || tamano <= 0) {
    return NextResponse.json(
      { error: `«${nombre}» está vacío.` },
      { status: 400 },
    );
  }
  if (tamano > SUPPORT_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `«${nombre}» pesa ${humanSize(tamano)}. El máximo es ${maxLabel(
          SUPPORT_MAX_BYTES,
        )}.`,
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Cuántos lleva ya esta solicitud. Se cuenta contra Storage y no contra lo
  // que diga el navegador: es el único sitio donde constan los que se subieron
  // de verdad.
  const { data: yaSubidos, error: errorLista } = await admin.storage
    .from(SUPPORT_BUCKET)
    .list(folder, { limit: MAX_ADJUNTOS + 1 });

  if (errorLista) {
    console.error("[contacto/adjuntos] no se pudo listar", errorLista.message);
    return NextResponse.json(
      { error: "No hemos podido preparar la subida. Inténtalo en un momento." },
      { status: 500 },
    );
  }
  if ((yaSubidos?.length ?? 0) >= MAX_ADJUNTOS) {
    return NextResponse.json(
      { error: `Puedes adjuntar como máximo ${MAX_ADJUNTOS} archivos.` },
      { status: 400 },
    );
  }

  // Prefijo aleatorio: dos «captura.png» no se pisan. Misma forma que el chat.
  const path = `${folder}/${crypto.randomUUID()}-${nombreSeguro(nombre)}`;

  const { data, error } = await admin.storage
    .from(SUPPORT_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[contacto/adjuntos] no se pudo firmar", error?.message);
    return NextResponse.json(
      { error: "No hemos podido preparar la subida. Inténtalo en un momento." },
      { status: 500 },
    );
  }

  // El token es lo que autoriza la subida, y caduca solo. No hace falta
  // devolver `signedUrl`: el cliente sube con `uploadToSignedUrl(path, token)`.
  return NextResponse.json({ path, token: data.token });
}
