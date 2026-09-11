import { NextResponse, after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { renderEmail, type Contexto } from "@/lib/email-templates";
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

/**
 * Cuándo llegó, en texto. Va al correo interno (ficha) y al acuse (pie de la
 * cita), y por eso lleva el huso escrito al lado.
 *
 * ⚠️ Se pinta en UTC y NO en el huso de nadie, al revés que todo lo demás de la
 * plataforma (regla de oro 4). Aquí no hay a quién preguntárselo: el formulario
 * es PÚBLICO, quien escribe puede no tener cuenta, y `profiles.timezone` —que es
 * de donde sale el huso en el resto de correos— no existe para un anónimo.
 * Entre inventarse un huso y decir cuál es, se dice cuál es: así quien atiende
 * la bandeja puede cruzar el sello con `contact_messages.created_at`, que
 * también está en UTC, sin restar nada de cabeza.
 */
function selloDeLlegada(cuando: Date): string {
  return (
    new Intl.DateTimeFormat("es", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(cuando) + " (UTC)"
  );
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
  //
  // ⚠️ Y desde que hay ACUSE (el `after()` del final) esto dejó de ser solo
  // antispam: es lo único que impide que este endpoint escriba a cualquier
  // dirección que alguien teclee, con texto suyo dentro. Subir `MAX_POR_IP` es
  // aflojar eso, no solo dejar pasar más mensajes.
  //
  // ⚠️ TECHO CONOCIDO: sin cabecera de IP este `if` no entra y NO hay límite.
  // En Vercel siempre viene, así que en producción no se abre; en local sí, y
  // ahí no hay clave de Resend, así que tampoco sale nada. `checkout/invitado`
  // resolvió lo mismo mandando esos casos a un cubo COMÚN ("sin-ip") en vez de
  // apagar el límite; aquí no se ha copiado todavía.
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

  // La ficha que comparten los DOS correos: el interno y el acuse. Es el mismo
  // objeto a propósito —quien escribe tiene que ver exactamente lo que vamos a
  // leer nosotros—, y va dentro de `contexto` porque es lo que `renderEmail`
  // espera: el `payload` es lo que dejó un trigger, y aquí no hay trigger.
  //
  // ⚠️ Nada de esto se escapa aquí. `cita()` y `ficha()` de `email-sistema.ts`
  // escapan por dentro, y hacerlo dos veces enseñaría `&amp;lt;` en la bandeja.
  // Por eso el `esc` local que tenía este fichero ya no existe.
  //
  // ⚠️ Los ficheros siguen SIN viajar adjuntos: pesan hasta 25 MB cada uno y el
  // bucket es privado a propósito. Se listan por nombre y tamaño, y se abren
  // desde `support-attachments` con URL firmada.
  const contacto: NonNullable<Contexto["contacto"]> = {
    nombre: name,
    correo: email,
    tipo: spec.label,
    sesion,
    mensaje: message,
    recibido: selloDeLlegada(new Date()),
    adjuntos: adjuntos.map((a) => ({
      nombre: a.file_name,
      tamano: humanSize(a.size_bytes),
    })),
  };

  // El origen sale de la PETICIÓN y no de una constante, igual que en el job de
  // correo: así el «Abrir en el panel» del correo interno lleva al despliegue
  // que atendió el mensaje y no al que se escribió en una variable hace meses.
  const origen = new URL(req.url).origin;

  if (!isEmailConfigured()) {
    // Se queda en 'pending', que es el default de la columna: "todavía no",
    // no "falló". El día que se ponga RESEND_API_KEY se puede reenviar.
    //
    // ⚠️ Y el acuse de abajo tampoco sale, que es lo correcto: sin clave no hay
    // correo de ninguna clase, y el mensaje ya está guardado.
    return NextResponse.json({ status: "ok" });
  }

  const interno = renderEmail({
    template: "contact_internal",
    payload: null,
    // Sin saludo: este correo no va a una persona, va a una bandeja. La
    // plantilla lo declara con `saludo: null`, así que el nombre sobra.
    nombre: "",
    baseUrl: origen,
    contexto: { contacto },
  });

  // `renderEmail` devuelve `null` cuando el id no está en el mapa. Con un
  // literal no debería pasar nunca, pero si pasa el mensaje ya está guardado y
  // `delivery` se queda en 'pending' —"todavía no", no "falló"—, que es
  // exactamente el estado del que se puede reenviar.
  if (!interno) {
    console.error("[contacto] falta la plantilla contact_internal");
    return NextResponse.json({ status: "ok" });
  }

  const enviado = await sendEmail({
    to: COMPANY.email,
    ...interno,
    // Para poder contestar pulsando "Responder" en vez de copiar la dirección
    // del cuerpo a mano. NO lo pone la plantilla: el asunto y el cuerpo son del
    // Doc 33, pero a dónde va la respuesta es cosa de esta ruta.
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

  /**
   * EL ACUSE A QUIEN ESCRIBE. Hasta hoy este formulario tragaba el mensaje sin
   * decir nada: la pantalla contestaba «gracias» y en la bandeja de quien
   * escribió no aparecía nada. Si nuestra respuesta tardaba un día, no tenía
   * forma de saber si el mensaje había salido siquiera.
   *
   * Va DIRECTO y no por `notifications`, por lo de siempre: la cola la vacía un
   * job que en producción entrega cada 2-6 horas, y un acuse que llega mañana
   * no acusa nada. Y además quien escribe puede no tener cuenta —el formulario
   * es público—, así que no hay `recipient_id` que encolar.
   *
   * Dentro de `after()` para que el «gracias» de la pantalla no espere a
   * Resend: el mensaje ya está guardado y la respuesta ya se decidió arriba.
   * Que el acuse salga o no NO cambia `delivery`, que es el registro del correo
   * INTERNO —el que de verdad no se puede perder—.
   *
   * ⚠️ UN ACUSE CONVIERTE ESTE ENDPOINT PÚBLICO EN UN REFLECTOR DE CORREO: a
   * partir de aquí cualquiera puede hacer que nuestro remitente escriba a la
   * dirección que teclee, con un texto suyo dentro (la cita del mensaje). Lo
   * único que lo acota es el tope por IP de más arriba —3 en 10 minutos—, que
   * por eso ya NO es solo antispam: es lo que separa «acuse» de «lanzadera de
   * correo con nuestra reputación de dominio». Si algún día se sube ese tope,
   * se sube sabiendo esto; y si se afloja del todo, el acuse se va con él.
   */
  after(async () => {
    const acuse = renderEmail({
      template: "contact_ack",
      payload: null,
      // Aquí sí saluda por el nombre: va a una persona, y es el que ella misma
      // tecleó. `render` lo escapa.
      nombre: name,
      baseUrl: origen,
      contexto: { contacto },
    });
    if (!acuse) {
      console.error("[contacto] falta la plantilla contact_ack");
      return;
    }

    const salio = await sendEmail({ to: email, ...acuse });
    if (!salio.ok) {
      // Se registra y no se reintenta: el acuse es una cortesía, el mensaje ya
      // está a salvo en `contact_messages` y quien atiende la bandeja lo va a
      // leer igual. Reintentar aquí sería montar una segunda cola.
      console.error("[contacto] el acuse no salió:", salio.error);
    }
  });

  return NextResponse.json({ status: "ok" });
}
