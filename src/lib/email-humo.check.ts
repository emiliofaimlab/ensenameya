import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

import { renderEmail, type Contexto } from "./email-templates.ts";

/**
 * Doc 33 · prueba de HUMO de todas las plantillas. No es el contrato —ese es
 * `email-templates.check.ts`— sino la red que caza lo que el rediseño hace
 * posible por primera vez: meter DATOS dentro del correo.
 *
 * El fallo típico de eso no es una excepción, es un «undefined» impreso en
 * negrita en el recibo de alguien. Por eso cada plantilla se renderiza DOS
 * veces: con el contexto vacío (una notificación encolada antes de este cambio,
 * o cuya reserva ya no existe) y con el contexto lleno.
 *
 * ⚠️ UN PAYLOAD POR PLANTILLA NO ALCANZA PARA LAS QUE SE BIFURCAN. `PAYLOADS`
 * es un mapa, así que cada plantilla entra una sola vez en el bucle y las ramas
 * que ese payload no toca se quedan sin renderizar nunca — y son ramas enteras:
 * el `reward_earned` del tutor, el `gift_expired` del destinatario. Las cubre
 * `VARIANTES`, más abajo, con el mismo filtro de veneno.
 *
 * Con `SALIDA_CORREOS=<dir>` escribe además un HTML por plantilla para mirarlos.
 */
const BASE = "https://ensenameya.com";
const AHORA = new Date("2026-09-14T12:00:00Z");

const LLENO: Contexto = {
  clase: "Cálculo diferencial: límites y derivadas",
  tutor: "Andrés Mejía",
  alumno: "Lucía Fernández",
  inicio: "2026-09-15T23:00:00Z",
  duracion_min: 60,
  importe: 2400,
  neto_tutor: 1920,
  moneda: "USD",
  limite: "2026-09-11T23:00:00Z",
  sesion_id: "s-2231",
  tutor_id: "t-119",
  product_id: "p-4417",
  cancelado_por: "tutor",
  reembolso: 2400,
  metodo: "Visa ···· 4242",
  cuenta: "8821",
  motivo: "El documento de identidad llegó cortado y no se lee el número.",
  dias: 12,
  payout: {
    ref: "LQ-0318",
    bruto: 12000,
    comision: 2400,
    neto: 9600,
    moneda: "USD",
    sesiones: 5,
    desde: "2026-09-01T00:00:00Z",
    hasta: "2026-09-10T00:00:00Z",
  },
  pedido: {
    ref: "EY-2419",
    total: 6200,
    moneda: "USD",
    pendientes: 2,
    lineas: [
      { titulo: "Cálculo diferencial: límites y derivadas", sub: "Andrés Mejía · 15 sep, 18:00", importe: 2400 },
      { titulo: "Álgebra lineal: matrices y determinantes", sub: "Andrés Mejía · 17 sep, 18:00", importe: 2400 },
      { titulo: "Repaso exprés de derivadas", sub: "Marta Ruiz · 19 sep, 09:00", importe: 1400 },
    ],
  },
  resena: {
    rating: 5,
    autor: "Lucía F.",
    media: 4.9,
    total: 23,
    comment:
      "Explica con una paciencia que no había visto. Salí entendiendo derivadas de verdad, no repitiendo fórmulas.",
  },
  contacto: {
    nombre: "Lucía Fernández",
    correo: "lucia.f@ejemplo.com",
    tipo: "Soporte",
    sesion: "Iniciada · alumna (a1f2…)",
    recibido: "10 sep, 11:42",
    mensaje:
      "No consigo entrar a la sala de mi clase de mañana, me dice que el enlace no está disponible todavía.",
    adjuntos: [
      { nombre: "captura-sala.png", tamano: "240 KB" },
      { nombre: "consola.txt", tamano: "4 KB" },
    ],
  },
  alertas: {
    total: 16800,
    moneda: "USD",
    desde: "2026-09-14T14:00:00Z",
    hasta: "2026-09-14T15:00:00Z",
    lineas: [
      { titulo: "Payout rechazado · Wise", sub: "Andrés Mejía · LQ-0318", importe: 9600 },
      { titulo: "Payout rechazado · Wise", sub: "Marta Ruiz · LQ-0319", importe: 4800 },
      { titulo: "Disputa abierta · Stripe", sub: "Pedido EY-2402 · vence en 6 días", importe: 2400 },
    ],
  },
};

/** El payload que dejaría cada trigger. Lo que NO esté aquí va con `{}`. */
const PAYLOADS: Record<string, Record<string, unknown>> = {
  payment_receipt: { payment_id: "pay-1", booking_id: "b7f3a91c", amount: 2400, currency: "USD" },
  payment_failed: { payment_id: "pay-1", booking_id: "b7f3a91c", amount: 2400, currency: "USD" },
  refund_processed: { payment_id: "pay-1", booking_id: "b7f3a91c", refunded: 2400, currency: "USD" },
  order_receipt: { order_id: "o-2419" },
  booking_pending_student: { booking_id: "b7f3a91c" },
  booking_new_tutor: { booking_id: "b7f3a91c" },
  booking_expiring_tutor: { booking_id: "b7f3a91c" },
  booking_confirmed_student: { booking_id: "b7f3a91c" },
  booking_reminder_24h: { booking_id: "b7f3a91c", session_id: "s-2231" },
  session_starting: { booking_id: "b7f3a91c", session_id: "s-2231" },
  cancellation: { booking_id: "b7f3a91c" },
  materials_ready: { booking_id: "b7f3a91c" },
  recording_ready: { booking_id: "b7f3a91c" },
  review_request: { booking_id: "b7f3a91c" },
  review_received_tutor: { booking_id: "b7f3a91c", review_id: "r-1" },
  tutor_review_result: { status: "rejected" },
  payout_paid: { payout_id: "po-1", amount: 9600, currency: "USD" },
  payout_issue: { payout_id: "po-1", status: "failed", amount: 9600, currency: "USD" },
  payout_unclaimed: { payout_id: "po-1", amount: 9600, currency: "USD", dias: 12, provider: "paypal" },
  payout_account_changed: { destino: "Transferencia bancaria" },
  new_message: { conversation_id: "c-77120" },
  admin_message: {
    mensaje:
      "Hemos recibido dos avisos sobre la puntualidad en tus últimas clases.\nAntes de tomar ninguna medida queremos escucharte.",
  },

  // ── Créditos y regalos (`20260912110000`) ─────────────────────────────────
  //
  // ⚠️ CADA UNO ES EXACTAMENTE EL `jsonb_build_object` DE SU
  // `enqueue_notification`, ni una clave más. Rellenar aquí un campo que la base
  // no encola —`expires_at` en NTF-31, el nombre de la mentoría en cualquiera de
  // los cuatro de regalo— haría pasar en verde un correo que en producción sale
  // cojo, que es justo el fallo que esta prueba existe para cazar.
  //
  // El contexto NO les añade nada: `pending_email_notifications` resuelve la
  // clase colgando de `booking_id`, y un crédito no tiene reserva todavía. Por
  // eso estos siete se leen igual con el contexto vacío que con el lleno — y por
  // eso el bucle de abajo, que los renderiza con los dos, es toda la red que hay.
  reward_earned: {
    credit_id: "cr-88f1",
    kind: "mentoria",
    amount: 2400,
    currency: "USD",
    destino: "cobro",
  },
  reward_expiring: {
    credit_id: "cr-88f1",
    kind: "saldo",
    restante: 1800,
    currency: "USD",
    expires_at: "2026-09-21T03:17:00Z",
    dias: 7,
  },
  // Sin `kind`: es literalmente lo que encola `caducar_creditos()`, y es el
  // motivo de que este correo no diga el importe.
  reward_expired: { credit_id: "cr-88f1", amount: 2400, currency: "USD" },
  gift_purchased: {
    credit_id: "cr-4d20",
    product_id: "p-4417",
    recipient_email: "emilio@ejemplo.com",
    amount: 2400,
    currency: "USD",
  },
  gift_received: {
    credit_id: "cr-4d20",
    product_id: "p-4417",
    gift_message:
      "¡Felicidades por aprobar! Te vendrá bien para el siguiente.\nUn abrazo, Lucía",
  },
  gift_expiring: {
    credit_id: "cr-4d20",
    product_id: "p-4417",
    expires_at: "2026-09-15T03:17:00Z",
    dias: 1,
  },
  // La copia de QUIEN LO COMPRÓ: la del destinatario va sin importe, y esa
  // diferencia es lo que la plantilla mira para saber a quién le habla.
  gift_expired: { credit_id: "cr-4d20", product_id: "p-4417", amount: 2400, currency: "USD" },
};

const IDS = [
  "auth_confirm_signup",
  "auth_reset_password",
  "auth_change_email",
  "welcome_student",
  "welcome_tutor",
  "guest_account_created",
  "order_receipt",
  "payment_receipt",
  "payment_failed",
  "refund_processed",
  "booking_pending_student",
  "booking_new_tutor",
  "booking_expiring_tutor",
  "booking_confirmed_student",
  "booking_reminder_24h",
  "session_starting",
  "cancellation",
  "materials_ready",
  "recording_ready",
  "review_request",
  "review_received_tutor",
  "identity_in_review",
  "tutor_review_result",
  "payout_paid",
  "payout_issue",
  "payout_unclaimed",
  "payout_account_changed",
  "account_deletion_requested",
  "account_deletion_done",
  "new_message",
  "admin_message",
  "contact_ack",
  "contact_internal",
  "admin_alert",
  "reward_earned",
  "reward_expiring",
  "reward_expired",
  "gift_purchased",
  "gift_received",
  "gift_expiring",
  "gift_expired",
];

const SALIDA = process.env.SALIDA_CORREOS;
if (SALIDA) mkdirSync(SALIDA, { recursive: true });

/**
 * Lo que se le exige a CUALQUIER correo renderizado, venga del bucle principal
 * o de `VARIANTES`. Está extraído a una función y no copiado dos veces porque
 * una rama que se comprueba con la mitad de las aserciones está peor cubierta
 * que si no se comprobara: al menos entonces se sabe.
 */
function revisar(r: ReturnType<typeof renderEmail>, quien: string): NonNullable<typeof r> {
  assert.ok(r, `la plantilla "${quien}" no renderiza`);

  for (const veneno of ["undefined", "null", "NaN", "[object Object]"]) {
    assert.ok(!r.text.includes(veneno), `"${quien}" coló «${veneno}» en el texto`);
    assert.ok(!r.html.includes(veneno), `"${quien}" coló «${veneno}» en el HTML`);
  }
  assert.ok(r.subject.trim().length > 0, `"${quien}" sin asunto`);
  // Un asunto que termina en el separador es un importe que no vino.
  assert.ok(!r.subject.trimEnd().endsWith("·"), `"${quien}" deja el separador huérfano`);
  // El botón es el mismo en todos (Doc 33 §3.2): naranja de marca con texto
  // TINTA. Blanco sobre ese naranja da 2,89:1 y falla el AA de WCAG incluso
  // para texto grande; #14141a sobre el mismo naranja da 6,36:1.
  //
  // `contact_ack` no lleva botón a propósito —es un acuse, no hay nada que
  // pulsar—, así que la comprobación se hace solo si hay uno.
  if (r.html.includes('bgcolor="#fe6a00"')) {
    assert.ok(
      r.html.includes("color:#14141a;text-decoration:none"),
      `"${quien}" pinta el texto del botón con algo que no es tinta`,
    );
  }
  return r;
}

let pintados = 0;
for (const template of IDS) {
  for (const [etiqueta, c] of [
    ["vacío", {}],
    ["lleno", LLENO],
  ] as const) {
    const r = revisar(
      renderEmail({
        template,
        payload: PAYLOADS[template] ?? {},
        nombre: "Lucía Fernández",
        baseUrl: BASE,
        contexto: c,
        timezone: "America/Bogota",
        ahora: AHORA,
      }),
      `${template} (${etiqueta})`,
    );

    if (SALIDA && etiqueta === "lleno") {
      writeFileSync(`${SALIDA}/${template}.html`, r.html, "utf8");
      pintados++;
    }
  }
}

// ── Las ramas que un solo payload por plantilla no alcanza ──────────────────
//
// `PAYLOADS` es un mapa: una entrada por plantilla, así que las que se bifurcan
// por el CONTENIDO del payload dejan sin renderizar todo lo demás. Y no son
// matices de redacción, son correos enteros —el tutor al que su recompensa le
// llega sola, el destinatario al que le caducó un regalo que no pagó—, cada uno
// con sus propios enlaces e importes. Aquí se renderizan con el mismo filtro.
const VARIANTES: [string, string, Record<string, unknown>][] = [
  // NTF-31 · las tres formas de la misma fila de `credits`. `destino` manda
  // sobre `kind`: con 'payout' no hay nada que canjear ni fecha que caducar.
  [
    "reward_earned · tutor (destino=payout)",
    "reward_earned",
    { credit_id: "cr-1", kind: "saldo", amount: 5000, currency: "USD", destino: "payout" },
  ],
  [
    "reward_earned · alumno con saldo",
    "reward_earned",
    { credit_id: "cr-1", kind: "saldo", amount: 5000, currency: "USD", destino: "cobro" },
  ],
  // NTF-32 · el tramo de 1 día dice «mañana» y el de 7 dice «en 7 días».
  [
    "reward_expiring · mentoría a 1 día",
    "reward_expiring",
    {
      credit_id: "cr-1",
      kind: "mentoria",
      restante: 2400,
      currency: "USD",
      expires_at: "2026-09-15T03:17:00Z",
      dias: 1,
    },
  ],
  // NTF-36 · el mismo correo a 7 días, que es el otro tramo de la clave.
  [
    "gift_expiring · a 7 días",
    "gift_expiring",
    { credit_id: "cr-2", product_id: "p-4417", expires_at: "2026-09-21T03:17:00Z", dias: 7 },
  ],
  // 🔴 NTF-37 · la copia del DESTINATARIO: sin `amount`, que es lo único que la
  // distingue de la del comprador. Si esta rama dejara de existir, a quien
  // recibió el regalo le llegaría un correo hablándole del dinero que no puso.
  ["gift_expired · destinatario", "gift_expired", { credit_id: "cr-2", product_id: "p-4417" }],
];

for (const [quien, template, payload] of VARIANTES) {
  for (const [etiqueta, c] of [
    ["vacío", {}],
    ["lleno", LLENO],
  ] as const) {
    revisar(
      renderEmail({
        template,
        payload,
        nombre: "Lucía Fernández",
        baseUrl: BASE,
        contexto: c,
        timezone: "America/Bogota",
        ahora: AHORA,
      }),
      `${quien} (${etiqueta})`,
    );
  }
}

// ── RN-35 · la hora es la del DESTINATARIO ──────────────────────────────────
// El mismo instante en dos husos tiene que dar dos horas distintas. Si esta
// aserción pasa con las dos iguales, el huso se está ignorando y el
// recordatorio manda a la gente a una clase a la hora equivocada.
const enBogota = renderEmail({
  template: "booking_reminder_24h",
  payload: { booking_id: "b1" },
  nombre: "Ana",
  baseUrl: BASE,
  contexto: LLENO,
  timezone: "America/Bogota",
  ahora: AHORA,
})!;
const enMadrid = renderEmail({
  template: "booking_reminder_24h",
  payload: { booking_id: "b1" },
  nombre: "Ana",
  baseUrl: BASE,
  contexto: LLENO,
  timezone: "Europe/Madrid",
  ahora: AHORA,
})!;
assert.notEqual(
  enBogota.subject,
  enMadrid.subject,
  "el recordatorio da la misma hora en Bogotá y en Madrid",
);

// Y la ficha de la clase aparece cuando el contexto la trae — que es la mitad
// entera del rediseño.
const conFicha = renderEmail({
  template: "booking_confirmed_student",
  payload: { booking_id: "b1" },
  nombre: "Ana",
  baseUrl: BASE,
  contexto: LLENO,
  timezone: "America/Bogota",
  ahora: AHORA,
})!;
assert.ok(conFicha.html.includes("Cálculo diferencial"), "la ficha de la clase no llegó al correo");
assert.ok(conFicha.text.includes("60 minutos"), "la duración no llegó al texto plano");

console.log(
  `OK · ${IDS.length} plantillas + ${VARIANTES.length} ramas × 2 contextos` +
    `${SALIDA ? ` · ${pintados} escritas en ${SALIDA}` : ""}`,
);
