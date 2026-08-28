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
  recording_ready: "La grabación de tu mentoría ya está disponible",
  payout_issue: "Una liquidación necesita atención",
  // NTF-21 · el canal de este aviso es `email`, pero la campana pinta TODAS las
  // filas de `notifications` sin mirar el canal, así que también sale aquí. Sin
  // esta línea diría "Novedad en tu cuenta (NTF-21)".
  new_message: "Tienes un mensaje nuevo",
  // NTF-22 · el respaldo. El texto de verdad lo pone `toNotice` desde el
  // payload; esto solo cubre una fila sin mensaje.
  admin_message: "Tienes un mensaje del equipo de Enséñame Ya",
};

/** Cuánto del mensaje del admin cabe en una línea de la campana. */
const CORTE_ADMIN = 120;

/** A dónde lleva el aviso, según lo que el trigger dejó en el payload. */
function hrefFor(payload: Record<string, unknown> | null): string | null {
  // NTF-21 · primero el hilo: un mensaje puede ocurrir dentro de una reserva y
  // el aviso tiene que abrir el chat, no la ficha (mismo orden que `rutaFor`
  // en `email-templates.ts`, que es el otro sitio donde se decide esto).
  const conversationId = payload?.conversation_id;
  if (typeof conversationId === "string") return `/chat/${conversationId}`;

  const bookingId = payload?.booking_id;
  if (typeof bookingId === "string") return `/reservas/${bookingId}`;
  if (payload?.payout_id) return "/tutor/payouts";
  return null;
}

/** Cuántos avisos enseña la campana. */
export const NOTICES_LIMIT = 8;

/**
 * NTF-22 · La única plantilla cuyo texto NO está en el mapa de arriba: lo
 * escribe el administrador y viaja en el payload. Se enseña tal cual (recortado)
 * en vez de un «tienes un mensaje» porque si no, el aviso obligaría a ir al
 * correo para leer dos frases que ya están en la fila.
 *
 * ⚠️ Aquí NO se escapa nada, y es correcto: React interpola este texto como
 * contenido, no como HTML. El escapado que sí hace falta es el del correo, que
 * vive en `lib/email-templates.ts` porque allí se construye una cadena de HTML.
 */
function textoAdmin(payload: Record<string, unknown> | null): string | null {
  const m = payload?.mensaje;
  if (typeof m !== "string" || !m.trim()) return null;
  const limpio = m.trim().replace(/\s+/g, " ");
  return limpio.length > CORTE_ADMIN
    ? `${limpio.slice(0, CORTE_ADMIN - 1)}…`
    : limpio;
}

export function toNotice(row: NotificationRow): AppNotice {
  return {
    id: row.id,
    text:
      (row.template === "admin_message" ? textoAdmin(row.payload) : null) ??
      TEXT[row.template] ??
      `Novedad en tu cuenta (${row.type})`,
    href: hrefFor(row.payload),
    createdAt: row.created_at,
    read: row.read_at !== null,
  };
}
