// Relativo y no `@/`: así `email-templates.check.ts` puede ejecutarse con node
// a pelo, sin resolver el alias de tsconfig. Mismo estilo que `src/lib/auth/*`.
import { formatMoney } from "./catalog/format.ts";

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
  review_request: () => ({
    asunto: "¿Cómo te fue la clase?",
    cuerpo:
      "Tu clase terminó. Dejar una reseña ayuda a otros alumnos a elegir, y solo lleva un minuto.",
    cta: "Dejar mi reseña",
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
  recording_ready: () => ({
    asunto: "La grabación de tu clase ya está disponible",
    cuerpo:
      "Puedes verla y descargarla desde la reserva. Estará disponible durante 30 días desde que terminó la clase; después se borra.",
    cta: "Ver la grabación",
  }),
};

/** A dónde lleva el correo, según lo que el trigger dejó en el payload. */
function rutaFor(template: string, payload: Payload): string {
  const bookingId = payload?.booking_id;
  if (typeof bookingId === "string") return `/reservas/${bookingId}`;
  if (payload?.payout_id) return "/tutor/payouts";
  if (payload?.payment_id) return "/pagos";
  if (template === "tutor_review_result" || template === "identity_in_review") {
    return "/tutor/verification";
  }
  return "/app";
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
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#242424;max-width:520px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px">${saludo}</p>
  <p style="margin:0 0 24px">${plantilla.cuerpo}</p>
  <p style="margin:0 0 24px">
    <a href="${url}" style="display:inline-block;background:#fe6a00;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${plantilla.cta ?? "Abrir Enséñame Ya"}</a>
  </p>
  <p style="margin:0;color:#666;font-size:13px">Enséñame Ya · Recibes este correo porque tienes una cuenta en la plataforma.</p>
</div>`;

  return { subject: plantilla.asunto, html, text };
}
