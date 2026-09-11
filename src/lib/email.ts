import "server-only";

import { COMPANY } from "@/lib/company";

/**
 * Adaptador de correo transaccional (C-11/DP-05 → **Resend**).
 *
 * Por qué Resend y no SendGrid ni Mailgun, que es lo que proponían los docs
 * (el Doc 9 decía SendGrid, la aprobación del cliente decía Mailgun, y ninguno
 * estaba decidido): es el único de los tres que deja enviar y PROBAR sin
 * dominio verificado, con `onboarding@resend.dev`. SendGrid exige verificar
 * remitente antes del primer envío y el sandbox de Mailgun solo entrega a cinco
 * destinatarios pre-autorizados. Cuando se eligió, el dominio propio estaba
 * bloqueado (`ensenameya.com` servía otra web) y esa diferencia fue la que
 * decidió.
 *
 * ⚠️ El dominio propio YA ESTÁ VERIFICADO en Resend (10-sep-2026), así que ese
 * argumento caducó: se pudo verificar sin tocar los `MX` ni el `SPF` del ápice,
 * que es lo que había que proteger del Microsoft 365 detrás de Proofpoint (ver
 * `docs/ENTORNOS.md`). Lo que queda pendiente es distinto y más pequeño: el
 * SMTP de Resend en **Supabase Auth**, que es otro proceso y no pasa por aquí
 * (`docs/PROPUESTAS/33-correos/README.md` §2).
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
 * Remitente.
 *
 * 🔴 EL RESPALDO ERA `onboarding@resend.dev` Y ESO SE VOLVIÓ UN FALLO MUDO el
 * 10-sep-2026, el día que `ensenameya.com` quedó VERIFICADO en Resend
 * (comprobado contra su API: `status: "verified"`, 15:40 UTC).
 *
 * Con el dominio verificado, el remitente de pruebas deja de ser «lo que hay
 * mientras tanto» y pasa a ser peor que nada: Resend solo entrega desde
 * `onboarding@resend.dev` **a la propia dirección de la cuenta**, y a cualquier
 * otra responde `403`. Y un 403 no es `retriable` aquí abajo —correctamente: es
 * un problema del mensaje, no del proveedor—, así que el job hace
 * `mark_notification(p_ok := false)` y la notificación queda **`failed`, que es
 * PERMANENTE**. O sea: sin `EMAIL_FROM`, cada correo a un usuario real se
 * quemaba en el primer intento, sin reintento, sin excepción y sin build en
 * rojo. Lo único que se movía era el contador `fallosPermanentes` del JSON del
 * job, que no mira nadie.
 *
 * Por eso el respaldo ya no es el de pruebas: es la dirección del dominio
 * verificado, que es además la que se viene usando de hecho (los envíos del
 * 10-sep salieron de `hola@ensenameya.com`). `EMAIL_FROM` sigue mandando por
 * encima para poder cambiarla sin tocar código.
 *
 * ⚠️ `hola@` es solo REMITENTE, no un buzón: el correo de verdad del proyecto
 * es `info@ensenameya.com` (§39 del contrato, M365 detrás de Proofpoint), y es
 * el que sale en el pie de los 34 correos y en su `List-Unsubscribe`. Si algún
 * día alguien responde a `hola@`, ahí no hay nadie.
 */
function from(): string {
  return process.env.EMAIL_FROM ?? "Enséñame Ya <hola@ensenameya.com>";
}

/**
 * Un adjunto. Hoy lo usa UNO solo: el `.ics` de la reserva confirmada
 * (Doc 33 §5.2), que lo arma el job de correo.
 *
 * `content` va **en base64 y ya montado por quien llama**, porque es lo único
 * que acepta la API de Resend (`Buffer.from(x, "utf8").toString("base64")`).
 * Codificarlo aquí obligaría a decidir si lo que entra es texto o binario, y
 * esa pregunta la responde mejor quien tiene el fichero en la mano.
 */
export type Adjunto = {
  filename: string;
  /** El contenido YA en base64. */
  content: string;
  /** Sin él, el cliente de correo adivina por la extensión. */
  contentType?: string;
};

/**
 * `List-Unsubscribe` de los correos no esenciales (Doc 33 §9).
 *
 * ⚠️ ES UN `mailto:` Y NO UNA URL, a propósito. El destino que pedía el diseño
 * —`/account#avisos`— **no existe**: S-49, la preferencia de opt-out, sigue
 * siendo una decisión de PRODUCTO abierta y aquí no se inventa (regla de oro
 * 8). El pliego lo zanja: mandar un enlace que no lleva a ningún sitio es peor
 * que no ponerlo.
 *
 * La forma `mailto:` es tan válida como la URL (RFC 2369), Gmail y Outlook la
 * respetan —que es lo que cuenta para la reputación del dominio, el motivo real
 * de poner la cabecera— y no necesita NINGUNA pantalla. El buzón es el oficial
 * del §39 del contrato, que por contrato está atendido: una baja pedida por
 * aquí la lee una persona.
 *
 * El día que S-49 exista esto pasa a ser la URL y `BAJA_TIENE_DESTINO` de
 * `email-sistema.ts` a `true` — y entonces el enlace del pie vuelve solo.
 */
const LIST_UNSUBSCRIBE = `<mailto:${COMPANY.email}?subject=baja>`;

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
  /**
   * A dónde va la respuesta si alguien pulsa "Responder". Lo usa el formulario
   * de contacto (DL-01): el correo lo manda el remitente de la plataforma, pero
   * quien escribió es otra persona, y sin esto habría que copiar su dirección a
   * mano del cuerpo del mensaje para contestarle.
   */
  replyTo?: string;
  /**
   * Ficheros que viajan con el correo. Hoy, el `.ics` de la clase confirmada.
   */
  adjuntos?: Adjunto[];
  /**
   * ¿Es un correo NO esencial? Entonces lleva `List-Unsubscribe`. Lo decide la
   * plantilla, correo por correo: `renderEmail` lo devuelve ya resuelto y el
   * job se limita a pasarlo. Aquí no hay ninguna lista de plantillas que
   * mantener sincronizada.
   */
  baja?: boolean;
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
        // Resend lo llama `reply_to`. Solo se manda si viene: enviar la clave
        // con `undefined` haría que el JSON llevara el campo vacío.
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        // Mismo criterio: la clave solo existe si hay adjuntos. Resend los
        // acepta en el propio `POST /emails` —no hay una llamada aparte— y a
        // sus claves las llama `filename`, `content` y `content_type`.
        ...(opts.adjuntos?.length
          ? {
              attachments: opts.adjuntos.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
          : {}),
        // `headers` aquí es el campo del CUERPO de la petición (cabeceras del
        // correo que se envía), no las de este `fetch`, que van arriba.
        ...(opts.baja ? { headers: { "List-Unsubscribe": LIST_UNSUBSCRIBE } } : {}),
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
