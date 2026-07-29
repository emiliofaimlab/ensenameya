/**
 * US-1203 · Avisos in-app.
 *
 * La tabla `notifications` guarda el código NTF y la plantilla del correo
 * (Doc 7), no un texto: el mismo evento tiene que poder decirse distinto en un
 * correo y en un aviso. Aquí vive la versión corta, la de la campana.
 *
 * El destino sale del `payload` que ya escriben los triggers (`booking_id`,
 * `payout_id`…), así que el aviso lleva a la pantalla del hecho.
 */
export type NotificationRow = {
  id: string;
  type: string;
  template: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
};

export type AppNotice = {
  id: string;
  text: string;
  href: string | null;
  createdAt: string;
  read: boolean;
};

/** Plantilla → texto de la campana. Lo que no esté cae al genérico. */
const TEXT: Record<string, string> = {
  tutor_review_result: "Tu solicitud de tutor tiene respuesta",
  identity_in_review: "Recibimos tus documentos: están en revisión",
  payment_receipt: "Tu pago se registró",
  payment_failed: "Un pago no se pudo cobrar",
  booking_confirmed_student: "Tu reserva quedó confirmada",
  booking_new_tutor: "Tienes una reserva nueva por aceptar",
  cancellation: "Se canceló una reserva",
  refund_processed: "Se procesó un reembolso",
  review_request: "¿Cómo te fue? Deja tu reseña",
  payout_paid: "Se pagó tu liquidación",
  payout_issue: "Una liquidación necesita atención",
};

/** A dónde lleva el aviso, según lo que el trigger dejó en el payload. */
function hrefFor(payload: Record<string, unknown> | null): string | null {
  const bookingId = payload?.booking_id;
  if (typeof bookingId === "string") return `/reservas/${bookingId}`;
  if (payload?.payout_id) return "/tutor/payouts";
  return null;
}

/** Cuántos avisos enseña la campana. */
export const NOTICES_LIMIT = 8;

export function toNotice(row: NotificationRow): AppNotice {
  return {
    id: row.id,
    text: TEXT[row.template] ?? `Novedad en tu cuenta (${row.type})`,
    href: hrefFor(row.payload),
    createdAt: row.created_at,
    read: row.read_at !== null,
  };
}
