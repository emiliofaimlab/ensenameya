/**
 * US-1203 · Avisos in-app.
 *
 * La tabla `notifications` guarda el código NTF y la plantilla del correo
 * (Doc 7), no un texto: el mismo evento tiene que poder decirse distinto en un
 * correo y en un aviso. Aquí vive la versión corta, la de la campana.
 *
 * El destino sale de la plantilla y del `payload` que ya escriben los triggers
 * (`booking_id`, `payout_id`…), así que el aviso lleva a la pantalla del hecho.
 * Lo decide `rutaFor`, que es la MISMA que usa el correo.
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
  href: string;
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

/**
 * A dónde lleva el aviso, según la plantilla y lo que el trigger dejó en el
 * payload. NUNCA devuelve null: un aviso que no se puede clicar es texto muerto.
 *
 * Vive aquí y no en `email-templates.ts` —que es quien la usaba primero— porque
 * este fichero no importa nada y lo consume un componente cliente: al revés, la
 * campana arrastraría al navegador las plantillas, el escapado de HTML y
 * `catalog/format.ts` para calcular una cadena.
 */
export function rutaFor(
  template: string,
  payload: Record<string, unknown> | null,
): string {
  // NTF-21 · el hilo, que es lo único que trae su payload. Va ANTES que la
  // reserva porque un mensaje puede ocurrir dentro de una: el día que alguien
  // añada `booking_id` a este payload, el enlace tiene que seguir llevando al
  // chat y no a la ficha de la reserva.
  const conversationId = payload?.conversation_id;
  if (typeof conversationId === "string") return `/chat/${conversationId}`;

  const bookingId = payload?.booking_id;
  if (typeof bookingId === "string") return `/reservas/${bookingId}`;
  if (payload?.payout_id) return "/tutor/payouts";
  // Respaldo. Desde `20260831120000` los avisos de dinero (NTF-04/10/15) traen
  // también `booking_id` —y `payments.booking_id` es `not null`—, así que aquí
  // solo cae una fila cuyo pago ya no exista. `/pagos` son las tarjetas
  // guardadas, no un historial: esa pantalla no existe.
  if (payload?.payment_id) return "/pagos";
  if (template === "tutor_review_result" || template === "identity_in_review") {
    return "/tutor/verification";
  }
  // NTF-22 · a `/account`, que es la única pantalla del área con sesión que
  // existe para los tres perfiles. `/app` es el panel del ALUMNO, y este aviso
  // se le manda igual de a menudo a un tutor.
  if (template === "admin_message") return "/account";
  return "/app";
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
    href: rutaFor(row.template, row.payload),
    createdAt: row.created_at,
    read: row.read_at !== null,
  };
}
