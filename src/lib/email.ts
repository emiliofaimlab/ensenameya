import "server-only";

/**
 * Adaptador de correo transaccional (C-11/DP-05 → **Resend**).
 *
 * Por qué Resend y no SendGrid ni Mailgun, que es lo que proponían los docs
 * (el Doc 9 decía SendGrid, la aprobación del cliente decía Mailgun, y ninguno
 * estaba decidido): es el único de los tres que deja enviar y PROBAR sin
 * dominio verificado, con `onboarding@resend.dev`. SendGrid exige verificar
 * remitente antes del primer envío y el sandbox de Mailgun solo entrega a cinco
 * destinatarios pre-autorizados. Como el dominio propio sigue bloqueado
 * (`ensenameya.com` sirve otra web), esa diferencia es la que decide.
 *
 * Todo el acoplamiento al proveedor vive en `sendEmail`. Cambiarlo es reescribir
 * esa función: ni el job, ni las plantillas, ni la base de datos se enteran.
 *
 * LA CREDENCIAL ES EL INTERRUPTOR, como Daily y el PSP: sin `RESEND_API_KEY` no
 * se envía nada y las notificaciones se quedan `pending` (no `failed`), así que
 * el día que se ponga la clave sale todo lo acumulado.
 */
const API = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Remitente. `onboarding@resend.dev` funciona sin verificar nada y sirve para
 * probar; el día que haya dominio propio esto pasa a ser `hola@ensenameya.com`
 * sin tocar código.
 */
function from(): string {
  return process.env.EMAIL_FROM ?? "Enséñame Ya <onboarding@resend.dev>";
}

/**
 * `retriable` distingue el fallo del que se puede volver: un 429 o un 5xx es un
 * mal momento del proveedor y la notificación debe quedarse pendiente para la
 * pasada siguiente. Un 4xx es un problema del mensaje (dirección inválida,
 * remitente no permitido) y reintentarlo cada 5 minutos para siempre solo
 * llenaría el log.
 */
export type EmailResult =
  | { ok: true }
  | { ok: false; retriable: boolean; error: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, retriable: true, error: "RESEND_API_KEY no configurada" };

  let res: Response;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: from(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
  } catch (e) {
    // Se cayó la red antes de llegar. Siempre reintentable.
    return { ok: false, retriable: true, error: e instanceof Error ? e.message : "fetch falló" };
  }

  if (res.ok) return { ok: true };

  const body = await res.text();
  return {
    ok: false,
    retriable: res.status === 429 || res.status >= 500,
    error: `${res.status} ${body.slice(0, 200)}`,
  };
}
