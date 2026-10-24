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
  /** EY-224 · en qué papel le llega (ver `papelDelAviso`). `null` = de la cuenta. */
  papel: Papel | null;
  /**
   * Las filas de `notifications` que representa este aviso. Una sola salvo
   * después de `agruparAvisos`, que junta varias en una línea: marcarlo leído
   * tiene que marcarlas TODAS, o el contador no baja.
   */
  ids: string[];
  /** A qué otros avisos se puede juntar (`agruparAvisos`). `null` = va solo. */
  grupo: string | null;
  /** Título de la clase grupal, si el payload lo trae: lo usa el texto agrupado. */
  clase?: string;
};

/** El papel del destinatario EN ESE AVISO, no su rol de cuenta. */
export type Papel = "alumno" | "tutor";

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
  gift_received: "Te regalaron una mentoría",
  // NTF-39 · el reclamo. Es OTRO momento que NTF-35 y por eso es otra frase:
  // cuando esto sale, la persona ya tiene cuenta y el regalo ya es suyo, así
  // que lo único que queda por hacer —y lo que la campana tiene que decir— es
  // elegir el día.
  gift_claimed: "Tu regalo ya está en tu cuenta",
  gift_expiring: "Un regalo caduca pronto y sigue sin agendar",
  gift_expired: "Un regalo caducó sin agendarse",
  // NTF-38 · el tutor cerró su cuenta y el regalo pasó a ser saldo. La frase
  // dice lo que GANA, no lo que se cayó: el aviso de que el tutor se fue sin
  // decir que el dinero sigue ahí es una alarma sin salida.
  gift_converted: "Tu regalo ahora vale con cualquier tutor",
  payment_failed: "Un pago no se pudo cobrar",
  booking_confirmed_student: "Tu reserva quedó confirmada",
  booking_new_tutor: "Tienes una reserva nueva por aceptar",
  // Grupales · los RESPALDOS: desde el lote 6 el payload trae `clase` (y
  // `alumno` al tutor) y el texto de verdad lo pone `textoGrupal`. Estos solo
  // los ve una fila vieja, sin esos campos.
  group_enrolled_student: "Tu inscripción en la clase grupal quedó confirmada",
  group_enrolled_tutor: "Alguien se inscribió en tu clase grupal",
  group_full_tutor: "Tu clase grupal se llenó",
  group_min_cancelled: "Una clase grupal se canceló por no llegar al mínimo",
  group_rescheduled: "Cambió la hora de tu clase grupal",
  group_cancelled: "Se canceló tu clase grupal, una fecha o tu cupo",
  // NTF-09 grupal · la baja del propio alumno. Antes salía el genérico de 1:1
  // («se canceló la mentoría… el horario volvió a quedar libre»), que era falso:
  // la clase sigue (A2).
  group_left_tutor: "Un alumno se dio de baja de tu clase grupal",
  group_left_student: "Te diste de baja de una clase grupal",
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
  // dos: «tu mentoría», sin decir con quién. A dónde lleva sí cambia: `para`.
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
  // §14 · reagendar (`20260925120000`).
  reschedule_requested: "Te propusieron otra hora para una mentoría",
  reschedule_accepted: "Aceptaron la nueva hora de tu mentoría",
  reschedule_rejected: "No aceptaron la nueva hora que propusiste",
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
  // EY-230 · a «Mis reseñas», dentro del panel. Ni `/tutor` (no enseña
  // ninguna) ni la ficha pública: está en `(public)` y la guarda de `(app)` no
  // se cruza con un enlace a mano (regla de oro 13).
  review_received_tutor: "/tutor/resenas",
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
  // Mismo destino que NTF-35 y por el mismo motivo: «Mis reservas» es donde
  // se agenda un regalo. Aquí además es el destino EXACTO —ya hay cuenta, así
  // que no hay rebote por la guarda que valga.
  gift_claimed: "/reservas",
  // ⚠️ `gift_expiring` se encola a `coalesce(beneficiary_id, purchased_by)`:
  // al destinatario si ya lo reclamó, al comprador si no. Con un solo destino
  // se acierta con quien AÚN PUEDE HACER ALGO —agendarlo—, que es el que lo
  // tiene. Distinguirlos de verdad pide un `papel` en el payload: migración.
  gift_expiring: "/reservas",
  // ⚠️ `gift_converted` (NTF-38) se encola al mismo `coalesce(beneficiary_id,
  // purchased_by)` y arrastra la misma imposibilidad: un solo destino para dos
  // papeles. Va con quien puede GASTAR el bono —el destinatario—, que además es
  // el único de los dos que lo tiene cuando ya lo reclamó. El correo sí lleva
  // su enlace a «Mis regalos» para el otro caso, que aquí no cabe.
  gift_converted: "/reservas",
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

  // EY-218 · las plantillas que se encolan a los DOS (reagendar, NTF-08/09/11/
  // 19) llevan `para` en el payload: dice a cuál se le habla. Las filas viejas,
  // sin `para`, caen al alumno, que es lo que hacían antes.
  const alTutor = payload?.para === "tutor";

  // Grupales (Jose, 13-oct) · el aviso grupal al tutor va a SU clase grupal y
  // no a la reserva de uno de los alumnos. La página es por PRODUCTO, por eso
  // el payload lleva `product_id` (20261013170000). «Empieza en 15 min» no lo
  // lleva a propósito: ese sigue yendo a la sala.
  const productId = payload?.product_id;
  if (
    typeof productId === "string" &&
    ((alTutor && payload?.group_class_id) ||
      template === "group_enrolled_tutor" ||
      template === "group_full_tutor" ||
      template === "group_left_tutor" ||
      (alTutor && template === "group_min_cancelled") ||
      // NTF-55 al tutor cuando cancela el admin: sin `booking_id`, así que sin
      // esta línea caía a `/app`, el panel del ALUMNO.
      (alTutor && template === "group_cancelled"))
  ) {
    return `/tutor/clases-grupales/${productId}`;
  }

  // §14 · reagendar le habla a cualquiera de los dos.
  if (template.startsWith("reschedule_")) {
    const base = alTutor ? "/tutor/reservas" : "/reservas";
    return typeof bookingId === "string" ? `${base}/${bookingId}` : base;
  }

  // NTF-07 y NTF-17 · la reserva vista DESDE EL TUTOR, que es otra pantalla y
  // otras acciones (aceptar / rechazar, no pagar / cancelar / reseñar).
  if (
    template === "booking_new_tutor" ||
    template === "booking_expiring_tutor" ||
    template === "group_enrolled_tutor"
  ) {
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

  // `booking_reminder_24h`, `cancellation`, `recording_ready` (y
  // `session_starting` sin sesión) se encolan al alumno Y al tutor con la misma
  // plantilla: desde `20261013120000` (EY-218) el payload trae `para`, y con él
  // el tutor va a SU detalle de la reserva y no a SCR-AL03.
  if (typeof bookingId === "string") {
    return alTutor ? `/tutor/reservas/${bookingId}` : `/reservas/${bookingId}`;
  }
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

/**
 * Cuántos avisos enseña la campana.
 *
 * ⚠️ EY-224 · «mis avisos» tiene TRES puertas y las tres tienen que decir lo
 * mismo: `session_bootstrap()` (SQL), `listNotices()` y el `load()` de la
 * campana. Mismo filtro (`recipient_id` propio y `FILTRO_AVISOS_VISIBLES`),
 * mismo orden (`created_at desc`) y este mismo límite. Si cambia uno, cambian
 * los tres — si no, la misma cuenta ve una lista u otra según por dónde entre.
 *
 * ⚠️ El CONTADOR de no leídos ya NO sale de esta lista (A3): contado sobre los
 * 8 últimos nunca pasaba de 8 y el «9+» era inalcanzable. Lo trae aparte
 * `session_bootstrap()` (`notices_unread`) y la campana lo recuenta con un
 * `count` al abrirse, con el mismo filtro.
 */
export const NOTICES_LIMIT = 8;

/**
 * Las plantillas que `caducar_notificaciones()` (`20260911210000`) marca
 * `failed` cuando su correo ya llegaría tarde. Es la MISMA lista que la de esa
 * función: si allí se añade una, se añade aquí y en `session_bootstrap()`.
 */
export const PLANTILLAS_CADUCABLES = ["session_starting", "booking_reminder_24h"] as const;

/**
 * Qué avisos NO enseña la campana: solo los CADUCADOS —`failed` en una
 * plantilla caducable—, porque «tu clase empieza en unos minutos» tres horas
 * después es mentira también en la campana.
 *
 * ⚠️ NO todo `failed`. `failed` también es «Resend rechazó el correo», y ese
 * aviso tiene que seguir en la campana: es justo el canal que NO falló. No hay
 * una marca más precisa en la fila (no hay columna de motivo), así que la
 * caducidad se reconoce por plantilla + estado, como en la propia función.
 */
export function avisoVisible(row: { status?: string | null; template: string }): boolean {
  return !(
    row.status === "failed" &&
    (PLANTILLAS_CADUCABLES as readonly string[]).includes(row.template)
  );
}

/** `avisoVisible` en sintaxis de PostgREST, para `.or(...)`: lo comparten `listNotices` y la campana. */
export const FILTRO_AVISOS_VISIBLES = `status.neq.failed,template.not.in.(${PLANTILLAS_CADUCABLES.join(",")})`;

/** Plantillas que solo se le mandan a alguien EN SU PAPEL DE TUTOR. */
const DEL_TUTOR = new Set([
  "booking_new_tutor",
  "booking_expiring_tutor",
  "group_enrolled_tutor",
  "group_full_tutor",
  "group_left_tutor",
  "review_received_tutor",
  "welcome_tutor",
  "payout_paid",
  "payout_issue",
  "payout_unclaimed",
  "payout_account_changed",
  "tutor_review_result",
  "identity_in_review",
]);

/** Plantillas que solo se le mandan a alguien EN SU PAPEL DE ALUMNO. */
const DEL_ALUMNO = new Set([
  "booking_confirmed_student",
  "booking_pending_student",
  "group_enrolled_student",
  "group_rescheduled",
  "group_cancelled",
  "group_left_student",
  "payment_receipt",
  "payment_failed",
  "refund_processed",
  "order_receipt",
  "review_request",
  "materials_ready",
  "welcome_student",
  "gift_purchased",
  "gift_received",
  "gift_claimed",
  "gift_expiring",
  "gift_expired",
  "gift_converted",
]);

/**
 * EY-224 · en qué papel le llega este aviso a quien lo recibe: la etiqueta
 * «Tutor» / «Alumno» de la campana para quien tiene los dos roles (la lista es
 * ÚNICA y mezclada, decidido con el cliente).
 *
 * Primero `payload.para` —las plantillas compartidas (NTF-08/09/11/19 y los
 * `reschedule_*`) lo llevan desde EY-218—, luego la plantilla. `null` = es de la
 * CUENTA, no de un papel (chat, mensajes del equipo, baja, recompensas…) o es
 * una fila vieja de plantilla compartida sin `para`: mejor sin etiqueta que con
 * una inventada.
 */
export function papelDelAviso(
  template: string,
  payload: Record<string, unknown> | null,
): Papel | null {
  const para = payload?.para;
  if (para === "tutor" || para === "alumno") return para;
  if (DEL_TUTOR.has(template)) return "tutor";
  if (DEL_ALUMNO.has(template)) return "alumno";
  return null;
}

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

/**
 * Grupales (A3, P14, P39) · el texto con NOMBRE: la clase y, al tutor, el
 * alumno —ya enmascarado en SQL, «Elena G.»—. «Alguien se inscribió en tu clase
 * grupal» tres veces no le dice a la tutora ni quién ni en cuál.
 *
 * Sin `clase` en el payload (filas de antes del lote 6) devuelve null y cae al
 * respaldo de `TEXT`, que es cierto aunque sea vago.
 */
function textoGrupal(
  template: string,
  payload: Record<string, unknown> | null,
): string | null {
  const clase = payload?.clase;
  if (typeof clase !== "string" || !clase.trim()) return null;
  const a = payload?.alumno;
  const alumno = typeof a === "string" && a.trim() ? a : null;
  switch (template) {
    case "group_enrolled_tutor":
      return `${alumno ?? "Alguien"} se inscribió en «${clase}»`;
    case "group_full_tutor":
      return `Tu clase grupal «${clase}» se llenó`;
    case "group_enrolled_student":
      return `Tu inscripción en «${clase}» quedó confirmada`;
    case "group_left_tutor": {
      const inscritos = payload?.inscritos;
      const cupo = payload?.cupo;
      const cola =
        typeof inscritos === "number" && typeof cupo === "number"
          ? ` · quedan ${inscritos}/${cupo}`
          : "";
      return `${alumno ?? "Un alumno"} se dio de baja de «${clase}»${cola}`;
    }
    case "group_left_student":
      return `Te diste de baja de «${clase}»`;
    case "group_cancelled":
      // P39 · tres hechos distintos con la misma plantilla: una fecha, la clase
      // entera (la cancela el tutor o el admin) o solo el cupo de este alumno.
      if (payload?.fecha) return `Se canceló una fecha de «${clase}»`;
      if (payload?.alcance === "clase") return `Se canceló la clase «${clase}»`;
      return `Se canceló tu cupo en «${clase}»`;
    case "group_min_cancelled":
      return `Se canceló «${clase}» por no llegar al mínimo`;
    case "group_rescheduled":
      return `Cambió la hora de «${clase}»`;
    default:
      return null;
  }
}

export function toNotice(row: NotificationRow): AppNotice {
  const productId = row.payload?.product_id;
  const clase = row.payload?.clase;
  return {
    id: row.id,
    text:
      (row.template === "admin_message" ? textoAdmin(row.payload) : null) ??
      (row.template === "payout_unclaimed" ? textoPayoutSinLlegar(row.payload) : null) ??
      textoGrupal(row.template, row.payload) ??
      TEXT[row.template] ??
      `Novedad en tu cuenta (${row.type})`,
    href: rutaFor(row.template, row.payload),
    createdAt: row.created_at,
    read: row.read_at !== null,
    papel: papelDelAviso(row.template, row.payload),
    ids: [row.id],
    grupo:
      row.template === "group_enrolled_tutor" && typeof productId === "string"
        ? `${row.template}:${productId}`
        : null,
    ...(typeof clase === "string" && clase.trim() ? { clase } : {}),
  };
}

/**
 * A3 · el «Alguien se inscribió en tu clase grupal» TRES VECES. Junta en una
 * línea las inscripciones a la misma clase: «3 alumnos se inscribieron en «X»».
 *
 * Se queda el PRIMERO de cada grupo —la lista viene por `created_at desc`, así
 * que es el más reciente y conserva su sitio y su fecha— y se le suman los ids
 * de los demás, para que abrirlo los dé todos por leídos. Solo se junta lo que
 * está en el mismo estado: una inscripción nueva no se esconde dentro de una
 * línea ya leída.
 *
 * ⚠️ Agrupa dentro de la lista que le den (las 8 de `NOTICES_LIMIT`), no en
 * toda la tabla: es un resumen de lo visible, no un recuento.
 */
export function agruparAvisos(notices: AppNotice[]): AppNotice[] {
  const out: AppNotice[] = [];
  const cabeza = new Map<string, number>();
  for (const n of notices) {
    if (!n.grupo) {
      out.push(n);
      continue;
    }
    const clave = `${n.grupo}:${n.read ? "leido" : "nuevo"}`;
    const i = cabeza.get(clave);
    if (i === undefined) {
      cabeza.set(clave, out.length);
      out.push(n);
      continue;
    }
    const primero = out[i];
    const ids = [...primero.ids, ...n.ids];
    const clase = primero.clase ?? n.clase;
    out[i] = {
      ...primero,
      ids,
      clase,
      text: clase
        ? `${ids.length} alumnos se inscribieron en «${clase}»`
        : `${ids.length} alumnos se inscribieron en tu clase grupal`,
    };
  }
  return out;
}
