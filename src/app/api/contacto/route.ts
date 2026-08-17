import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { COMPANY } from "@/lib/company";

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
 * la RLS pero NO los grants, y el fallo sería en tiempo de ejecución.
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

/**
 * Validación deliberadamente laxa: la única forma de saber si una dirección
 * existe es escribirle. Esto descarta lo que es evidentemente inválido sin
 * rechazar direcciones legítimas raras, que es el error caro de los dos.
 */
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function textoPlano(m: {
  name: string;
  email: string;
  message: string;
  sesion: string;
}) {
  return [
    `Nombre:  ${m.name}`,
    `Correo:  ${m.email}`,
    `Cuenta:  ${m.sesion}`,
    "",
    m.message,
  ].join("\n");
}

function html(m: { name: string; email: string; message: string; sesion: string }) {
  // Escapado a mano: el cuerpo lo escribe un desconocido y va a parar a un
  // cliente de correo. Sin esto, un `<script>` o una etiqueta rota viaja tal cual.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  return `
    <div style="font-family:system-ui,sans-serif;font-size:15px;color:#101828">
      <p style="margin:0 0 4px"><strong>Nombre:</strong> ${esc(m.name)}</p>
      <p style="margin:0 0 4px"><strong>Correo:</strong> ${esc(m.email)}</p>
      <p style="margin:0 0 16px;color:#475467"><strong>Cuenta:</strong> ${esc(m.sesion)}</p>
      <div style="white-space:pre-wrap;border-left:3px solid #fe6a00;padding-left:12px">${esc(
        m.message,
      )}</div>
    </div>`;
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

  // ⚠️ TEMPORAL — el cast se quita en cuanto se regeneren los tipos.
  // `contact_messages` existe en `20260817120000` pero NO en
  // `database.types.ts`, porque `npm run db:types` devuelve hoy 403
  // ("your account does not have the necessary privileges"), igual que
  // `npm run db:push`. Es un permiso de la cuenta de Supabase sobre el
  // Management API, no un problema de este código.
  //
  // Cuando se arregle: `npm run db:types`, borrar este cast y volver a
  // `const admin = createAdminClient();`. El resto del archivo compila igual —
  // los nombres de columna ya son los de la migración.
  //
  // ⚠️ Y ojo al regenerar: `db:types` redirige con `>`, así que si vuelve a
  // fallar VACÍA `database.types.ts` antes de darse cuenta. Comprobar el
  // archivo después de correrlo (`git diff --stat`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

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

  const { data: fila, error: errorInsert } = await admin
    .from("contact_messages")
    .insert({
      name,
      email,
      message,
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

  // A partir de aquí el mensaje ya está a salvo. Que el correo salga o no
  // cambia lo que anotamos, pero no lo que respondemos: para quien escribe, el
  // mensaje ha llegado.
  const sesion = senderId ? `registrada (${senderId})` : "sin sesión";

  if (!isEmailConfigured()) {
    // Se queda en 'pending', que es el default de la columna: "todavía no",
    // no "falló". El día que se ponga RESEND_API_KEY se puede reenviar.
    return NextResponse.json({ status: "ok" });
  }

  const enviado = await sendEmail({
    to: COMPANY.email,
    subject: `Contacto web — ${name}`,
    text: textoPlano({ name, email, message, sesion }),
    html: html({ name, email, message, sesion }),
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
