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
 *
 * ⚠️ Y DESDE EL DOC 33 MANDA LA PLANTILLA, NO EL PAYLOAD. Al revés —que era como
 * estaba— todo lo que llevara `booking_id` acababa en `/reservas/{id}`, la
 * pantalla del ALUMNO, incluidos los avisos dirigidos al tutor. Ver `DESTINO`.
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

  // ── Recompensas y regalos (NTF-31..37) ───────────────────────────────────
  // Sin estas siete la campana pinta «Novedad en tu cuenta (NTF-31)» y manda a
  // `/app` a todo el mundo: ninguno de sus payloads lleva `booking_id` ni
  // `payment_id`, así que `rutaFor` cae al respaldo. Lo caza `check:email`.
  reward_earned: "Ganaste una recompensa por invitar",
  reward_expiring: "Tu recompensa caduca pronto",
  reward_expired: "Tu recompensa caducó sin usarse",
  gift_purchased: "Tu regalo ya está activo",
  gift_received: "Te han regalado una mentoría",
  gift_expiring: "Un regalo caduca pronto y sigue sin agendar",
  gift_expired: "Un regalo caducó sin agendarse",
  payment_failed: "Un pago no se pudo cobrar",
  booking_confirmed_student: "Tu reserva quedó confirmada",
  booking_new_tutor: "Tienes una reserva nueva por aceptar",
  cancellation: "Se canceló una reserva",
  refund_processed: "Se procesó un reembolso",
  review_request: "¿Cómo te fue? Deja tu reseña",
  payout_paid: "Se pagó tu liquidación",
  recording_ready: "La grabación de tu mentoría ya está disponible",
  payout_issue: "Una liquidación necesita atención",
  // NTF-23 · el RESPALDO, que es el texto de los rieles que no son PayPal. El
  // de PayPal lo pone `textoPayoutSinLlegar` desde el payload: «que la
  // reclames» solo es cierto ahí. Ver el comentario de esa función.
  payout_unclaimed: "Tu liquidación está tardando más de lo normal",
  // NTF-21 · el canal de este aviso es `email`, pero la campana pinta TODAS las
  // filas de `notifications` sin mirar el canal, así que también sale aquí. Sin
  // esta línea diría "Novedad en tu cuenta (NTF-21)".
  new_message: "Tienes un mensaje nuevo",
  // NTF-22 · el respaldo. El texto de verdad lo pone `toNotice` desde el
  // payload; esto solo cubre una fila sin mensaje.
  admin_message: "Tienes un mensaje del equipo de Enséñame Ya",

  // ── Doc 33 ────────────────────────────────────────────────────────────────
  //
  // Las plantillas que nacieron con el pliego de correos. Se registran aquí
  // aunque casi todas se encolen con `channel = 'email'`: la campana pinta
  // TODAS las filas de `notifications` sin mirar el canal (ver `new_message`
  // dos líneas más arriba), así que sin su línea saldrían como «Novedad en tu
  // cuenta (NTF-24)», que no dice nada.
  //
  // NO están las tres de Auth ni `guest_account_created` ni `contact_internal`:
  // esas no pasan por la cola —las manda Supabase, el checkout de invitado y el
  // formulario de contacto, directas— así que nunca hay una fila que pintar.
  order_receipt: "Recibimos el pago de tu pedido",
  booking_pending_student: "Tu reserva espera a que el tutor la acepte",
  booking_expiring_tutor: "Te queda poco para responder a una reserva",
  // NTF-11 le sale igual al alumno y al tutor, así que la frase vale para los
  // dos: «tu mentoría», sin decir con quién.
  booking_reminder_24h: "Tu mentoría es mañana",
  session_starting: "Tu mentoría empieza en unos minutos",
  materials_ready: "Tu tutor subió material para tu clase",
  review_received_tutor: "Tienes una reseña nueva",
  payout_account_changed: "Cambiaron los datos de tu cuenta de cobro",
  welcome_student: "Te damos la bienvenida: busca tu primer tutor",
  welcome_tutor: "Te faltan dos pasos para empezar a enseñar",
  account_deletion_requested: "Tu cuenta quedó desactivada",
  account_deletion_done: "Tu cuenta se cerró",
  admin_alert: "Hay incidencias esperando revisión",
  contact_ack: "Recibimos tu mensaje",
};

/**
 * Doc 33 · destino FIJO por plantilla: el que no depende de ningún id.
 *
 * 🔴 EL FALLO QUE ESTE MAPA EMPIEZA A TAPAR. Hasta hoy `rutaFor` mandaba a
 * TODO EL MUNDO a la pantalla del alumno: cualquier payload con `booking_id`
 * caía en `/reservas/{id}`, que es SCR-AL03. `booking_new_tutor` (NTF-07) va al
 * TUTOR y salía así desde siempre, y la RLS no lo tapa —el tutor puede leer esa
 * fila—, así que la pantalla renderizaba entera, con las acciones del alumno.
 * No es una mejora pendiente: es un enlace que lleva al sitio equivocado.
 *
 * Se mira ANTES que el payload porque casi todas estas plantillas TAMBIÉN
 * traen `booking_id`: si se mirara después, no se llegaría nunca aquí.
 */
const DESTINO: Record<string, string> = {
  welcome_student: "/app",
  welcome_tutor: "/tutor",
  // El correo invita a ver su FICHA PÚBLICA («las reseñas salen en tu ficha y
  // pesan en el orden de las búsquedas»), no a gestionar aquella reserva.
  review_received_tutor: "/tutor",
  payout_account_changed: "/tutor/payouts",
  admin_alert: "/admin/alertas",
  // La baja se pide y se deshace desde ahí, y `/app` es el panel del ALUMNO:
  // este aviso le llega igual a un tutor. Mismo motivo que `admin_message`.
  account_deletion_requested: "/account",
  account_deletion_done: "/account",

  // ── Recompensas y regalos ────────────────────────────────────────────────
  // La recompensa se ve donde se gana: «Invita y gana».
  reward_earned: "/referidos",
  reward_expiring: "/referidos",
  reward_expired: "/referidos",
  // El regalo tiene DOS caras y cada aviso va a la suya: quien lo compró lo
  // sigue en «Mis regalos»; quien lo recibe lo agenda desde «Mis reservas»,
  // que además llama a `reclamar_mis_regalos()` al pintarse.
  gift_purchased: "/regalar/mis-regalos",
  gift_received: "/reservas",
  // ⚠️ `gift_expiring` se encola a `coalesce(beneficiary_id, purchased_by)`:
  // al destinatario si ya lo reclamó, al comprador si no. Con un solo destino
  // se acierta con quien AÚN PUEDE HACER ALGO —agendarlo—, que es el que lo
  // tiene. Distinguirlos de verdad pide un `papel` en el payload: migración.
  gift_expiring: "/reservas",
  // `gift_expired` no entra aquí a propósito: es el único cuyo destino depende
  // del payload (la copia del comprador lleva `amount`, la del destinatario
  // no), y eso lo resuelve `rutaFor`, no este mapa.
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

  // ── Doc 33 · lo que NO va a la pantalla del alumno ────────────────────────
  //
  // Todo este bloque va ANTES de la rama de `booking_id` a propósito: leer el
  // payload primero es exactamente lo que mandaba al tutor a SCR-AL03.
  const fijo = DESTINO[template];
  if (fijo) return fijo;

  // NTF-07 y NTF-17 · la reserva vista DESDE EL TUTOR, que es otra pantalla y
  // otras acciones (aceptar / rechazar, no pagar / cancelar / reseñar).
  if (template === "booking_new_tutor" || template === "booking_expiring_tutor") {
    return typeof bookingId === "string" ? `/tutor/reservas/${bookingId}` : "/tutor/reservas";
  }

  // NTF-04b · al PEDIDO, que es donde está el recibo con el total.
  //
  // Se decide por PLANTILLA y no por «¿hay `order_id` en el payload?», y la
  // diferencia importa: un pedido son VARIAS reservas —es justo el motivo de
  // que `order_receipt` exista aparte del recibo por línea— así que si el
  // payload trajera además un `booking_id`, la rama de abajo lo mandaría al
  // detalle de UNA de las tres clases que compró, como si fuera la única.
  // Cerrando por plantilla eso no puede pasar, venga lo que venga en el payload.
  // Sin `order_id` cae a la lista, que es escueta pero nunca engañosa.
  if (template === "order_receipt") {
    const o = payload?.order_id;
    return typeof o === "string" ? `/pedidos/${o}/confirmacion` : "/reservas";
  }

  // NTF-08 · a la SALA, que es a donde tiene que ir quien lee «empieza en unos
  // minutos». El `session_id` lo trae el payload desde `20260911210000`; si un
  // día faltara, la reserva es un destino honesto y la sala se alcanza desde
  // ahí, así que se cae a la rama de abajo en vez de inventar una URL.
  if (template === "session_starting") {
    // A una variable antes de mirarla, como `conversationId`: el payload es
    // `Record<string, unknown>` y el estrechamiento no sobrevive de otra forma.
    const sessionId = payload?.session_id;
    if (typeof sessionId === "string") return `/room/${sessionId}`;
  }

  // ⚠️ `booking_reminder_24h` (NTF-11) SE QUEDA AQUÍ, y es el único caso que
  // este mecanismo no resuelve: `avisar_clases_de_manana` encola DOS filas —una
  // al alumno y otra al tutor— con la MISMA plantilla y el MISMO payload, así
  // que por plantilla no hay forma de saber a cuál de los dos se le está
  // hablando. Va a la pantalla del alumno, que es la equivocada la mitad de las
  // veces. Arreglarlo de verdad pide el papel del destinatario en la fila (o
  // dos plantillas), y eso es una migración, no un `if` aquí.
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

/**
 * NTF-23 · ⚠️ «QUE LA RECLAMES» SOLO ES CIERTO EN PAYPAL, y la campana pinta
 * esta fila igual que el correo la manda.
 *
 * El barrido que la encola (`avisar_payouts_sin_reclamar`) no filtra por riel a
 * propósito, así que desde que Wise paga (`20260907120000`) esta línea le salía
 * a un tutor con cuenta bancaria — al que nadie le ha pedido que reclame nada,
 * porque en una transferencia no hay nada que reclamar. Se decide por el
 * `provider` que la migración `20260907140000` metió en el payload; sin él cae
 * al texto neutro del mapa, que es cierto en cualquier riel.
 */
function textoPayoutSinLlegar(payload: Record<string, unknown> | null): string | null {
  return payload?.provider === "paypal"
    ? "Tu liquidación está esperando a que la reclames"
    : null;
}

export function toNotice(row: NotificationRow): AppNotice {
  return {
    id: row.id,
    text:
      (row.template === "admin_message" ? textoAdmin(row.payload) : null) ??
      (row.template === "payout_unclaimed" ? textoPayoutSinLlegar(row.payload) : null) ??
      TEXT[row.template] ??
      `Novedad en tu cuenta (${row.type})`,
    href: rutaFor(row.template, row.payload),
    createdAt: row.created_at,
    read: row.read_at !== null,
  };
}
