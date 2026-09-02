// Relativo y no `@/`: así `email-templates.check.ts` puede ejecutarse con node
// a pelo, sin resolver el alias de tsconfig. Mismo estilo que `src/lib/auth/*`.
import { formatMoney } from "./catalog/format.ts";
// El destino del enlace lo decide la campana (US-1203): una sola función para
// el correo y el aviso in-app, y vive allí porque allí no arrastra nada.
import { rutaFor } from "./notifications.ts";

/**
 * Doc 7 · el texto de cada correo transaccional.
 *
 * DELIBERADAMENTE ESCUETOS. Cada correo dice el hecho y lleva a la pantalla
 * donde está el detalle, en vez de reproducir la reserva entera. Dos razones:
 * un correo es un canal que no controlamos —se reenvía, se queda en bandejas
 * ajenas, se indexa— y meter ahí el detalle de una clase es filtrar dato
 * personal sin necesidad; y evitarlo ahorra una consulta por notificación, que
 * con la cola creciendo sería un N+1 contra la base.
 *
 * El `payload` que dejan los triggers ya trae lo justo: el id para el enlace y,
 * cuando toca, el importe. Nada más hace falta.
 *
 * La campana (US-1203, `lib/notifications.ts`) tiene su propio mapa a propósito:
 * el mismo evento se dice distinto en un aviso de una línea y en un correo.
 */
type Plantilla = {
  asunto: string;
  /** Una frase. Lo que la persona necesita saber sin abrir nada. */
  cuerpo: string;
  /** Texto del botón. Si no hay, el correo va sin enlace. */
  cta?: string;
};

function importe(payload: Payload, campo: string): string {
  const valor = payload?.[campo];
  const moneda = payload?.currency;
  if (typeof valor !== "number" || typeof moneda !== "string") return "";
  return formatMoney(valor, moneda);
}

type Payload = Record<string, unknown> | null;

const PLANTILLAS: Record<string, (p: Payload) => Plantilla> = {
  booking_confirmed_student: () => ({
    asunto: "Tu reserva está confirmada",
    cuerpo:
      "El tutor aceptó tu reserva. Puedes ver el horario y entrar a la sala desde tu panel cuando llegue el momento.",
    cta: "Ver la reserva",
  }),
  booking_new_tutor: () => ({
    asunto: "Tienes una reserva nueva por aceptar",
    cuerpo:
      "Un alumno reservó y ya pagó. Tienes 24 horas para aceptarla; si se pasa el plazo se cancela sola y se le reembolsa el importe completo.",
    cta: "Responder a la reserva",
  }),
  cancellation: () => ({
    asunto: "Se canceló una reserva",
    cuerpo:
      "La reserva quedó cancelada y el horario volvió a estar libre. Si había un reembolso, se aplicó según la política de cancelación.",
    cta: "Ver el detalle",
  }),
  // NTF-14 · el correo de cierre de clase. Lo pidió el cliente con la grabación
  // dentro (acta del 29-ago, ítem 12), y el enlace YA llevaba al sitio correcto:
  // su `cta` resuelve a `/reservas/{id}` (ver `rutaFor`), que es justo la
  // pantalla donde vive el control de grabación. Lo que faltaba era decirlo.
  //
  // ⚠️ Y SE DICE EN CONDICIONAL, QUE NO ES TIMIDEZ. RN-42 exige el sí de las DOS
  // partes para grabar, así que lo NORMAL es que una clase no tenga vídeo.
  // Prometer «tu grabación» en un correo que sale siempre convertiría el caso
  // habitual en una decepción, y además hay tres formas distintas de no tenerla
  // —nadie abrió la sala, nadie consintió, o caducaron los 30 días—. La página
  // sabe distinguirlas y el correo no, así que el correo se limita a llevarte
  // allí.
  review_request: () => ({
    asunto: "¿Cómo te fue la mentoría?",
    cuerpo:
      "Tu mentoría terminó. Dejar una reseña ayuda a otros alumnos a elegir, y solo lleva un minuto. " +
      "Y si la clase se grabó, encontrarás la grabación en esa misma página durante 30 días.",
    cta: "Ver mi clase y dejar reseña",
  }),
  payment_receipt: (p) => ({
    asunto: "Recibimos tu pago",
    cuerpo: `Tu pago${importe(p, "amount") && ` de ${importe(p, "amount")}`} quedó registrado. Puedes consultar el detalle en tu historial.`,
    cta: "Ver mis pagos",
  }),
  refund_processed: (p) => ({
    asunto: "Tu reembolso está procesado",
    cuerpo: `Se procesó un reembolso${importe(p, "refunded") && ` de ${importe(p, "refunded")}`} por el mismo medio de pago que usaste. Según tu banco puede tardar unos días en aparecer.`,
    cta: "Ver mis pagos",
  }),
  payment_failed: () => ({
    asunto: "Un pago no se pudo completar",
    cuerpo:
      "No pudimos cobrar el pago de tu reserva, así que se canceló y el horario volvió a quedar libre. No se te ha cobrado nada.",
    cta: "Ver mis pagos",
  }),
  tutor_review_result: (p) => ({
    asunto: "Tu solicitud para enseñar tiene respuesta",
    cuerpo:
      p?.status === "approved"
        ? "Tu perfil quedó aprobado. Ya puedes publicar mentorías y recibir reservas."
        : "Revisamos tu solicitud y de momento no podemos aprobarla. En tu panel están los detalles y lo que puedes corregir.",
    cta: "Ir a mi panel de tutor",
  }),
  identity_in_review: () => ({
    asunto: "Recibimos tus documentos",
    cuerpo:
      "Tus documentos de verificación están en revisión. Te avisamos en cuanto haya respuesta; no tienes que hacer nada más.",
    cta: "Ver el estado",
  }),
  payout_paid: (p) => ({
    asunto: "Se pagó tu liquidación",
    cuerpo: `Tu liquidación${importe(p, "amount") && ` de ${importe(p, "amount")}`} se marcó como pagada. El detalle está en tu panel de cobros.`,
    cta: "Ver mis cobros",
  }),
  // NTF-21 (EY-151). ⚠️ NI EL MENSAJE NI QUIÉN LO ESCRIBE: el payload que deja
  // el trigger trae solo el id del hilo, a propósito (ver la migración
  // `20260826160000`). Un correo se reenvía y se queda en bandejas ajenas; el
  // chat tiene purga a 30 días dentro de la app y ninguna fuera de ella.
  new_message: () => ({
    asunto: "Tienes un mensaje nuevo",
    cuerpo:
      "Alguien te escribió por el chat de Enséñame Ya. Puedes leerlo y responder desde la plataforma.",
    cta: "Abrir la conversación",
  }),
  recording_ready: () => ({
    asunto: "La grabación de tu mentoría ya está disponible",
    cuerpo:
      "Puedes verla y descargarla desde la reserva. Estará disponible durante 30 días desde que terminó la mentoría; después se borra.",
    cta: "Ver la grabación",
  }),
  // NTF-22 (EY-189) · ⚠️ LA ÚNICA PLANTILLA CON CUERPO LIBRE. Las doce
  // anteriores son literales de este fichero; esta la escribe el administrador
  // desde la bandeja de moderación y viaja en el payload
  // (`admin_contact_user`). Por eso `renderEmail` escapa el cuerpo antes de
  // meterlo en el HTML — ver el comentario de allí.
  //
  // Se cae a una frase neutra si el payload viniera sin texto: un correo con el
  // cuerpo vacío es peor que uno que dice poco, y la RPC ya rechaza el mensaje
  // en blanco, así que esto es solo el cinturón.
  admin_message: (p) => {
    // A una variable antes de mirarla: el payload es `Record<string, unknown>`
    // y solo así el estrechamiento a `string` sobrevive al ternario.
    const m = p?.mensaje;
    return {
      asunto: "Un mensaje del equipo de Enséñame Ya",
      cuerpo:
        typeof m === "string" && m.trim()
          ? m.trim()
          : "El equipo de Enséñame Ya quiere hablar contigo sobre tu cuenta.",
      cta: "Entrar a mi cuenta",
    };
  },
};

/**
 * Escapa lo que va a interpolarse dentro del HTML del correo.
 *
 * ⚠️ Existe desde que hay UNA plantilla con cuerpo libre (`admin_message`,
 * NTF-22). Las demás son literales de este fichero y no contienen ni un `<`, así
 * que escapar siempre no cambia nada de lo que ya se enviaba — y evita tener
 * que acordarse de escapar en la plantilla, que es la clase de olvido que no se
 * ve hasta que alguien pega un `<script>` en el mensaje.
 *
 * Solo se aplica a la rama HTML: en la de texto plano el mensaje va tal cual,
 * porque ahí un `&amp;` se leería literalmente.
 */
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailRendered = { subject: string; html: string; text: string };

/**
 * Devuelve `null` si la plantilla no está en el mapa. El job lo trata como
 * error PERMANENTE: reintentar cada 5 minutos una plantilla que no existe no la
 * va a hacer aparecer, y dejarla pendiente para siempre escondería el problema.
 */
export function renderEmail(opts: {
  template: string;
  payload: Payload;
  nombre: string;
  baseUrl: string;
}): EmailRendered | null {
  const plantilla = PLANTILLAS[opts.template]?.(opts.payload);
  if (!plantilla) return null;

  const saludo = opts.nombre ? `Hola ${opts.nombre.split(" ")[0]},` : "Hola,";
  const url = `${opts.baseUrl}${rutaFor(opts.template, opts.payload)}`;

  const text = [
    saludo,
    "",
    plantilla.cuerpo,
    "",
    plantilla.cta ? `${plantilla.cta}: ${url}` : url,
    "",
    "— Enséñame Ya",
  ].join("\n");

  // HTML con estilos EN LÍNEA y sin imágenes: los clientes de correo descartan
  // el <style> del head y bloquean las remotas por defecto. Nada de layout
  // moderno aquí — esto se ve en Outlook.
  //
  // ⚠️ Los dos trozos variables van escapados. El cuerpo por `admin_message`
  // (NTF-22, lo escribe el admin), y el saludo porque sale de
  // `profiles.full_name`, que lo escribe el propio usuario: eso ya se estaba
  // interpolando crudo desde el primer correo.
  //
  // Los saltos de línea del cuerpo se convierten en `<br>` DESPUÉS de escapar:
  // un mensaje del panel se escribe en varios párrafos y sin esto llegaba todo
  // pegado en una línea.
  const cuerpoHtml = escaparHtml(plantilla.cuerpo).replace(/\n/g, "<br>");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#242424;max-width:520px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px">${escaparHtml(saludo)}</p>
  <p style="margin:0 0 24px">${cuerpoHtml}</p>
  <p style="margin:0 0 24px">
    <a href="${url}" style="display:inline-block;background:#fe6a00;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${plantilla.cta ?? "Abrir Enséñame Ya"}</a>
  </p>
  <p style="margin:0;color:#666;font-size:13px">Enséñame Ya · Recibes este correo porque tienes una cuenta en la plataforma.</p>
</div>`;

  return { subject: plantilla.asunto, html, text };
}
