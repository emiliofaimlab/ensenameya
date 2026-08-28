import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { COMPANY } from "@/lib/company";
import {
  CONTACT_KIND_SPECS,
  MAX_ADJUNTOS,
  SUPPORT_BUCKET,
  SUPPORT_MAX_BYTES,
  esContactKind,
  type ContactKind,
} from "@/lib/contact/request-kinds";
import { humanSize } from "@/components/tutor/upload-formats";

/**
 * DL-01 · el formulario de contacto público.
 *
 * dLocal Go no valida la cuenta sin esto, y lo prueban a mano: mandan un
 * mensaje y esperan que llegue. Por eso el mensaje se GUARDA SIEMPRE en
 * `contact_messages` antes de intentar el correo — si `RESEND_API_KEY` todavía
 * no está puesta, `sendEmail` no manda nada (devuelve `retriable`) y sin la
 * tabla el mensaje se perdería en silencio. Guardado, la respuesta al usuario
 * es honesta en los dos casos y no se pierde nada.
 *
 * ESCRITURA CON `service_role`, NO DESDE EL CLIENTE. El formulario es público
 * —hay que poder escribir sin cuenta— y una tabla con `insert` abierto a `anon`
 * es un formulario de spam con pasos de más. Aquí se valida, se limita por IP y
 * se comprueba el honeypot antes de tocar la base.
 *
 * ⚠️ Regla de oro 9: esto funciona porque `20260817120000` declara
 * `grant select, insert, update ... to service_role`. `service_role` se salta
 * la RLS pero NO los grants, y el fallo sería en tiempo de ejecución. Lo mismo
 * vale para `contact_message_attachments` (`20260828161500`).
 *
 * ── ADJUNTOS (28-ago) ───────────────────────────────────────────────────────
 * El tipo de solicitud decide si hay ficheros y de qué clase. Los bytes NO
 * pasan por aquí: el navegador los sube antes con una URL firmada que emite
 * `POST /api/contacto/adjuntos` (el porqué, en ese fichero). Lo que llega aquí
 * son rutas, y una ruta que manda el navegador no es prueba de nada — así que
 * **el tamaño y el MIME se leen del objeto ya subido**, no de lo que diga el
 * cuerpo de la petición. Si el fichero no está, la ruta se descarta.
 */

/** Los mismos topes que el `check` de la migración, que es el que no se salta nadie. */
const LIMITES = {
  name: { min: 1, max: 120 },
  email: { min: 3, max: 254 },
  message: { min: 10, max: 5000 },
} as const;

/** Nº de mensajes que admitimos de una misma IP en `VENTANA_MIN` minutos. */
const MAX_POR_IP = 3;
const VENTANA_MIN = 10;

/** `<uuid>/<fichero>`, la forma que da el endpoint de subida. Un nivel y solo
 *  uno: sin esto, una ruta con `..` o con carpetas de más miraría donde no debe. */
const RUTA_ADJUNTO =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/i;

/**
 * Validación deliberadamente laxa: la única forma de saber si una dirección
 * existe es escribirle. Esto descarta lo que es evidentemente inválido sin
 * rechazar direcciones legítimas raras, que es el error caro de los dos.
 */
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/** Un adjunto ya comprobado contra Storage: lo que se guarda y lo que se cuenta. */
type AdjuntoOk = {
  path: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
};

function textoPlano(m: {
  name: string;
  email: string;
  message: string;
  sesion: string;
  tipo: string;
  adjuntos: AdjuntoOk[];
}) {
  return [
    `Nombre:  ${m.name}`,
    `Correo:  ${m.email}`,
    `Cuenta:  ${m.sesion}`,
    `Tipo:    ${m.tipo}`,
    // La lista solo aparece si hay algo que listar: un «Adjuntos: (ninguno)» en
    // el 90 % de los correos es ruido en la bandeja de quien atiende.
    ...(m.adjuntos.length > 0
      ? [
          `Adjuntos (${m.adjuntos.length}):`,
          ...m.adjuntos.map(
            (a) => `  · ${a.file_name} — ${humanSize(a.size_bytes)}`,
          ),
        ]
      : []),
    "",
    m.message,
  ].join("\n");
}

function html(m: {
  name: string;
  email: string;
  message: string;
  sesion: string;
  tipo: string;
  adjuntos: AdjuntoOk[];
}) {
  // Escapado a mano: el cuerpo lo escribe un desconocido y va a parar a un
  // cliente de correo. Sin esto, un `<script>` o una etiqueta rota viaja tal cual.
  // El nombre del fichero también lo elige quien escribe, así que pasa por aquí.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // ⚠️ Los ficheros NO viajan adjuntos al correo: pesan hasta 25 MB cada uno y
  // el bucket es privado a propósito. Se listan por nombre y tamaño, y se abren
  // desde `support-attachments` con URL firmada.
  const lista =
    m.adjuntos.length > 0
      ? `<p style="margin:16px 0 4px"><strong>Adjuntos (${m.adjuntos.length}):</strong></p>
         <ul style="margin:0 0 16px;padding-left:20px;color:#475467">
           ${m.adjuntos
             .map(
               (a) =>
                 `<li>${esc(a.file_name)} — ${humanSize(a.size_bytes)}</li>`,
             )
             .join("")}
         </ul>
         <p style="margin:0 0 16px;color:#98a2b3;font-size:13px">
           Están en el bucket privado <code>${SUPPORT_BUCKET}</code>, no en este correo.
         </p>`
      : "";

  return `
    <div style="font-family:system-ui,sans-serif;font-size:15px;color:#101828">
      <p style="margin:0 0 4px"><strong>Nombre:</strong> ${esc(m.name)}</p>
      <p style="margin:0 0 4px"><strong>Correo:</strong> ${esc(m.email)}</p>
      <p style="margin:0 0 4px"><strong>Tipo:</strong> ${esc(m.tipo)}</p>
      <p style="margin:0 0 16px;color:#475467"><strong>Cuenta:</strong> ${esc(m.sesion)}</p>
      ${lista}
      <div style="white-space:pre-wrap;border-left:3px solid #fe6a00;padding-left:12px">${esc(
        m.message,
      )}</div>
    </div>`;
}

/**
 * Comprueba contra Storage las rutas que declara el navegador y devuelve solo
 * las que existen de verdad, con el tamaño y el MIME que dice **el objeto**.
 *
 * Se listan las carpetas una vez cada una (no un `list` por fichero) porque en
 * la práctica todas las rutas de un envío comparten carpeta: es el id de la
 * solicitud que generó el formulario.
 */
async function adjuntosReales(
  admin: ReturnType<typeof createAdminClient>,
  rutas: string[],
  tiposAdmitidos: string[],
  nombres: Map<string, string>,
): Promise<AdjuntoOk[]> {
  const carpetas = new Set(
    rutas.map((r) => RUTA_ADJUNTO.exec(r)?.[1]).filter((c): c is string => !!c),
  );

  // nombre-de-objeto → metadatos, con la ruta completa como clave.
  const enStorage = new Map<string, { size?: number; mimetype?: string }>();

  for (const carpeta of carpetas) {
    const { data, error } = await admin.storage
      .from(SUPPORT_BUCKET)
      .list(carpeta, { limit: MAX_ADJUNTOS + 1 });
    if (error) {
      console.error("[contacto] no se pudo listar adjuntos", error.message);
      continue;
    }
    for (const objeto of data ?? []) {
      // `list` devuelve también las carpetas, y esas vienen sin metadatos. Sin
      // tamaño ni MIME no hay nada que validar, así que no entran.
      if (!objeto.metadata) continue;
      enStorage.set(`${carpeta}/${objeto.name}`, objeto.metadata);
    }
  }

  const validos: AdjuntoOk[] = [];
  for (const ruta of rutas) {
    const meta = enStorage.get(ruta);
    if (!meta) {
      // La subida no llegó a completarse, o la ruta se la inventó quien llamó.
      // No es motivo para tirar el mensaje: se pierde el fichero, no el texto.
      console.warn("[contacto] adjunto declarado que no existe", ruta);
      continue;
    }
    const size = Number(meta.size ?? 0);
    const mime = String(meta.mimetype ?? "");
    // Cinturón sobre lo que ya filtra el bucket: si algún día su
    // `allowed_mime_types` se abriera de más, esto sigue cerrado.
    if (size <= 0 || size > SUPPORT_MAX_BYTES || !tiposAdmitidos.includes(mime)) {
      console.warn("[contacto] adjunto rechazado", ruta, mime, size);
      continue;
    }
    validos.push({
      path: ruta,
      file_name: nombres.get(ruta) ?? ruta.split("/").pop() ?? "adjunto",
      size_bytes: size,
      mime_type: mime,
    });
  }

  return validos;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot. Es un campo oculto que una persona no ve y un bot rellena por
  // costumbre. Se responde 200 a propósito: decirle que ha fallado solo le
  // enseña a esquivarlo la próxima vez.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ status: "ok" });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  // Sin `kind` es un envío del formulario viejo (o una pestaña que llevaba
  // abierta desde antes del despliegue): 'mensaje' es el default de la columna
  // y el comportamiento de siempre, así que no se rechaza.
  const tipoSolicitud = body.kind;
  const kind: ContactKind = esContactKind(tipoSolicitud) ? tipoSolicitud : "mensaje";
  const spec = CONTACT_KIND_SPECS[kind];
  const tiposAdmitidos = spec.types;

  if (name.length < LIMITES.name.min || name.length > LIMITES.name.max) {
    return NextResponse.json({ error: "Escribe tu nombre." }, { status: 400 });
  }
  if (
    email.length < LIMITES.email.min ||
    email.length > LIMITES.email.max ||
    !emailValido(email)
  ) {
    return NextResponse.json(
      { error: "Revisa tu correo: no parece una dirección válida." },
      { status: 400 },
    );
  }
  if (message.length < LIMITES.message.min) {
    return NextResponse.json(
      { error: "Cuéntanos un poco más para poder ayudarte." },
      { status: 400 },
    );
  }
  if (message.length > LIMITES.message.max) {
    return NextResponse.json(
      { error: "El mensaje es demasiado largo. Resume un poco, por favor." },
      { status: 400 },
    );
  }

  // ── Los adjuntos que declara el navegador ─────────────────────────────────
  // Cada uno es `{ path, name }`: la ruta que devolvió el endpoint de subida y
  // el nombre original, que es lo único que Storage no conserva.
  const declarados = Array.isArray(body.attachments) ? body.attachments : [];

  if (declarados.length > MAX_ADJUNTOS) {
    return NextResponse.json(
      { error: `Puedes adjuntar como máximo ${MAX_ADJUNTOS} archivos.` },
      { status: 400 },
    );
  }
  // Un tipo sin ficheros con ficheros dentro es una petición manipulada, no un
  // despiste: el formulario ni siquiera enseña el selector.
  if (!tiposAdmitidos && declarados.length > 0) {
    return NextResponse.json(
      { error: "Ese tipo de solicitud no admite archivos." },
      { status: 400 },
    );
  }

  const rutas: string[] = [];
  const nombres = new Map<string, string>();
  for (const d of declarados) {
    if (typeof d !== "object" || d === null) continue;
    const { path, name: nombre } = d as { path?: unknown; name?: unknown };
    if (typeof path !== "string" || !RUTA_ADJUNTO.test(path)) {
      return NextResponse.json(
        { error: "Uno de los archivos no es válido. Quítalo y vuelve a subirlo." },
        { status: 400 },
      );
    }
    if (rutas.includes(path)) continue; // el mismo fichero dos veces no cuenta dos
    rutas.push(path);
    if (typeof nombre === "string" && nombre.trim() !== "") {
      nombres.set(path, nombre.trim().slice(0, 200));
    }
  }

  // Vercel pone la IP real la primera de la lista; en local no hay cabecera y
  // queda null, que la columna admite.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // Si tiene sesión lo anotamos: para soporte cambia mucho saber si quien
  // escribe es un usuario registrado o alguien que aún no ha entrado.
  let senderId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    senderId = user?.id ?? null;
  } catch {
    // Sin sesión es el caso normal de un formulario público, no un error.
  }

  const admin = createAdminClient();

  // Límite por IP. No es antispam serio —para eso haría falta un captcha, que
  // dLocal no pide y que añade fricción a un formulario que tienen que poder
  // usar— pero corta el caso tonto de alguien pulsando enviar veinte veces.
  if (ip) {
    const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
    const { count } = await admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", desde);

    if ((count ?? 0) >= MAX_POR_IP) {
      return NextResponse.json(
        {
          error:
            "Has enviado varios mensajes seguidos. Espera unos minutos y vuelve a intentarlo.",
        },
        { status: 429 },
      );
    }
  }

  // Se comprueba ANTES de insertar el mensaje para que el correo pueda listar lo
  // que de verdad hay. Que un adjunto no exista no tumba el envío: lo que no se
  // puede perder es el texto.
  const adjuntos: AdjuntoOk[] =
    tiposAdmitidos && rutas.length > 0
      ? await adjuntosReales(admin, rutas, tiposAdmitidos, nombres)
      : [];

  const { data: fila, error: errorInsert } = await admin
    .from("contact_messages")
    .insert({
      name,
      email,
      message,
      kind,
      sender_id: senderId,
      ip,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (errorInsert || !fila) {
    // Aquí sí conviene 500: no hemos guardado nada y el mensaje se perdería.
    console.error("[contacto] no se pudo guardar", errorInsert);
    return NextResponse.json(
      { error: "No hemos podido registrar tu mensaje. Inténtalo en un momento." },
      { status: 500 },
    );
  }

  if (adjuntos.length > 0) {
    const { error: errorAdjuntos } = await admin
      .from("contact_message_attachments")
      .insert(adjuntos.map((a) => ({ ...a, message_id: fila.id })));

    // No se aborta: el mensaje ya está a salvo y el correo va a listar los
    // ficheros igualmente. Lo que se pierde es el enlace en la bandeja, y los
    // objetos sin fila los recoge la purga de huérfanos (`20260828161500`).
    if (errorAdjuntos) {
      console.error("[contacto] no se pudieron registrar los adjuntos", errorAdjuntos);
    }
  }

  // A partir de aquí el mensaje ya está a salvo. Que el correo salga o no
  // cambia lo que anotamos, pero no lo que respondemos: para quien escribe, el
  // mensaje ha llegado.
  const sesion = senderId ? `registrada (${senderId})` : "sin sesión";
  const correo = {
    name,
    email,
    message,
    sesion,
    tipo: spec.label,
    adjuntos,
  };

  if (!isEmailConfigured()) {
    // Se queda en 'pending', que es el default de la columna: "todavía no",
    // no "falló". El día que se ponga RESEND_API_KEY se puede reenviar.
    return NextResponse.json({ status: "ok" });
  }

  const enviado = await sendEmail({
    to: COMPANY.email,
    // El tipo va en el asunto y no solo en el cuerpo: quien atiende la bandeja
    // ordena por ahí, y «documentos» o «capturas» dicen de un vistazo si el
    // mensaje trae algo que mirar.
    subject: `Contacto web (${spec.label.toLowerCase()}) — ${name}`,
    text: textoPlano(correo),
    html: html(correo),
    // Para poder contestar pulsando "Responder" en vez de copiar la dirección
    // del cuerpo a mano.
    replyTo: email,
  });

  await admin
    .from("contact_messages")
    .update(
      enviado.ok
        ? { delivery: "sent", delivered_at: new Date().toISOString() }
        : {
            // `retriable` se queda en 'pending' para poder reintentarlo; un 4xx
            // del proveedor es un problema del mensaje y no se va a arreglar solo.
            delivery: enviado.retriable ? "pending" : "failed",
            delivery_error: enviado.error.slice(0, 500),
          },
    )
    .eq("id", fila.id);

  return NextResponse.json({ status: "ok" });
}
