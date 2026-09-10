import assert from "node:assert/strict";

import { renderEmail } from "./email-templates.ts";
import { rutaFor, toNotice } from "./notifications.ts";

/**
 * Comprobación mínima del renderizado de los correos. Sin framework: se corre
 * con `npm run check:email` y falla con un exit code si algo se rompe.
 *
 * Existe porque el job trata "no se pudo renderizar" y "el proveedor rechazó"
 * como el mismo fallo permanente, así que desde fuera no se distinguen. Sin
 * esto, una plantilla mal escrita se vería exactamente igual que una API key
 * caducada — y el aviso se marcaría `failed` sin que nadie supiera por qué.
 */
// El dominio oficial desde el 10-sep. Era `ensenameya.vercel.app`, que a partir
// de hoy es un 308 hacia aquí: un fixture que apunta al host viejo sigue pasando
// las aserciones —solo comprueban que la base aparezca— pero deja escrito en el
// contrato un dominio que ya no es el de la app.
const BASE = "https://ensenameya.com";

// Las 12 plantillas de correo del Doc 7 tienen que existir. Si alguien añade un
// `enqueue_notification` con una plantilla nueva y no la registra aquí, el
// correo se marca fallido en silencio: esta lista es el contrato.
const TEMPLATES = [
  "booking_confirmed_student",
  "booking_new_tutor",
  "cancellation",
  "review_request",
  "payment_receipt",
  "refund_processed",
  "payment_failed",
  "tutor_review_result",
  "identity_in_review",
  "payout_paid",
  "payout_unclaimed",
  "recording_ready",
  "new_message",
  "admin_message",
];

for (const template of TEMPLATES) {
  const r = renderEmail({ template, payload: {}, nombre: "Lucía Fernández", baseUrl: BASE });
  assert.ok(r, `la plantilla "${template}" no renderiza`);
  assert.ok(r.subject.length > 0, `"${template}" sin asunto`);
  assert.ok(r.html.includes(BASE), `"${template}" sin enlace a la app`);
  assert.ok(r.text.includes("Lucía"), `"${template}" no saluda por el nombre`);
  // `rutaFor` la comparte la campana (US-1203): una plantilla sin destino se
  // pinta como aviso in-app que no se puede clicar.
  assert.ok(rutaFor(template, {}).startsWith("/"), `"${template}" sin destino`);
}

// Una plantilla que no existe devuelve null, que es lo que el job lee para
// marcar fallo permanente en vez de reintentar cada 5 minutos para siempre.
assert.equal(
  renderEmail({ template: "no_existe", payload: {}, nombre: "", baseUrl: BASE }),
  null,
);

// El importe se formatea cuando viene, y no rompe cuando no.
const conImporte = renderEmail({
  template: "payment_receipt",
  payload: { amount: 2500, currency: "USD" },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(conImporte!.text.includes("25"), "no formateó el importe");

const sinImporte = renderEmail({
  template: "payment_receipt",
  payload: {},
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(!sinImporte!.text.includes("undefined"), "coló un undefined sin importe");

// El enlace sale del payload que dejan los triggers, no de la plantilla.
const aReserva = renderEmail({
  template: "cancellation",
  payload: { booking_id: "abc-123" },
  nombre: "",
  baseUrl: BASE,
});
assert.ok(aReserva!.text.includes("/reservas/abc-123"), "el enlace no apunta a la reserva");

// Con reserva manda la reserva. Es lo que hace que los avisos de dinero
// (NTF-04/10/15, con `booking_id` en el payload desde `20260831120000`) lleven
// al detalle del pago y no a «Métodos de pago», que son las tarjetas guardadas.
assert.equal(
  rutaFor("refund_processed", { payment_id: "pay-1", booking_id: "bk-2" }),
  "/reservas/bk-2",
);

// ── NTF-23 · UN CORREO DE PAYPAL A QUIEN COBRA POR TRANSFERENCIA ────────────
//
// 🔴 EL FALLO QUE ESTE BLOQUE EXISTE PARA CAZAR, y que estuvo vivo el 7-sep-2026:
// `avisar_payouts_sin_reclamar` barre TODA orden en `processing` sin mirar el
// riel —a propósito, lo dice su migración— y la plantilla estaba escrita entera
// para PayPal. En cuanto Wise empezó a pagar (`20260907120000`), un tutor
// colombiano con cuenta bancaria recibía «no ha llegado a tu cuenta de PayPal» y
// «comprueba el correo que nos diste», por un dinero que en su riel nadie tiene
// que reclamar.
//
// Es exactamente la clase de fallo que no rompe nada: renderiza, se envía, y el
// único que se entera es el tutor que lee una instrucción imposible.
const wiseSinLlegar = renderEmail({
  template: "payout_unclaimed",
  payload: { payout_id: "po-1", amount: 15000, currency: "COP", dias: 7, provider: "wise" },
  nombre: "Camilo",
  baseUrl: BASE,
});
assert.ok(
  !/paypal/i.test(wiseSinLlegar!.text),
  "NTF-23 le habla de PayPal a un tutor que cobra por Wise",
);
assert.ok(
  !/paypal/i.test(wiseSinLlegar!.subject),
  "el asunto de NTF-23 nombra PayPal en un riel bancario",
);
// Y tampoco le manda a arreglar sus datos ni a reclamar nada: en una
// transferencia no hay nada que reclamar y los datos que dio ya sirvieron para
// emitir la orden.
assert.ok(
  !/reclam/i.test(wiseSinLlegar!.text),
  "NTF-23 le pide reclamar un pago a quien cobra por transferencia",
);

// El riel manual y el reintento del admin dejan `payouts.provider` a null, así
// que un payload sin proveedor tiene que caer al cuerpo neutro — nunca al de
// PayPal, que es el que dice cosas que solo valen allí.
const sinRiel = renderEmail({
  template: "payout_unclaimed",
  payload: { payout_id: "po-2", amount: 15000, currency: "COP", dias: 7 },
  nombre: "Camilo",
  baseUrl: BASE,
});
assert.ok(!/paypal/i.test(sinRiel!.text), "NTF-23 sin proveedor cayó en el cuerpo de PayPal");

// …y con PayPal SÍ se dice lo de PayPal: la rama neutra no puede haberse comido
// el único aviso que salva un pago antes de que se devuelva a los 30 días.
const paypalSinReclamar = renderEmail({
  template: "payout_unclaimed",
  payload: { payout_id: "po-3", amount: 15000, currency: "USD", dias: 7, provider: "paypal" },
  nombre: "Camilo",
  baseUrl: BASE,
});
assert.ok(
  paypalSinReclamar!.text.includes("PayPal"),
  "NTF-23 dejó de contar lo de PayPal en el riel de PayPal",
);
assert.ok(
  paypalSinReclamar!.text.includes("30 días"),
  "NTF-23 ya no avisa del plazo en que PayPal devuelve el pago",
);

// ⚠️ Y LA PRIMERA FRASE NO PUEDE DECIR QUE SE ENVIÓ EL DINERO. En Wise la
// transferencia se crea y se fondea después: al día 7 está creada y el dinero
// NO ha salido, así que «Enviamos tu liquidación» —lo que decía este correo
// hasta el 7-sep— era falso justo en el riel que lo destapó.
for (const r of [wiseSinLlegar!, sinRiel!, paypalSinReclamar!]) {
  assert.ok(!/^Hola[^]*Enviamos tu liquidación/.test(r.text), "NTF-23 afirma un envío que puede no haber ocurrido");
}

// La campana pinta la MISMA fila que manda el correo —sin mirar el canal, ver
// el comentario de `new_message` en `notifications.ts`—, así que el texto corto
// arrastraba el mismo fallo. Se comprueba aquí porque el `rutaFor` de ese módulo
// ya vive en este fichero.
const campanaWise = toNotice({
  id: "n-1", type: "NTF-23", template: "payout_unclaimed",
  payload: { payout_id: "po-1", provider: "wise" },
  created_at: "2026-09-07T10:00:00Z", read_at: null,
});
assert.ok(!/reclam/i.test(campanaWise.text), "la campana le pide reclamar a un tutor de Wise");
assert.equal(campanaWise.href, "/tutor/payouts", "el aviso de payout no lleva a los cobros");
const campanaPaypal = toNotice({
  id: "n-2", type: "NTF-23", template: "payout_unclaimed",
  payload: { payout_id: "po-3", provider: "paypal" },
  created_at: "2026-09-07T10:00:00Z", read_at: null,
});
assert.ok(/reclames/.test(campanaPaypal.text), "la campana perdió el aviso de PayPal");

// NTF-21 · el correo del mensaje nuevo lleva al HILO, no al panel.
const aHilo = renderEmail({
  template: "new_message",
  payload: { conversation_id: "conv-9" },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(aHilo!.text.includes("/chat/conv-9"), "el aviso de mensaje no lleva al hilo");

// …y NO lleva el contenido del mensaje ni quién lo escribió, pase lo que pase
// en el payload. Es la razón de ser de la plantilla: un correo se reenvía.
const fisgon = renderEmail({
  template: "new_message",
  payload: { conversation_id: "conv-9", body: "mi IBAN es ES12", from: "Marcos" },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(!fisgon!.text.includes("IBAN"), "el correo coló el cuerpo del mensaje");
assert.ok(!fisgon!.text.includes("Marcos"), "el correo coló el nombre del remitente");

// Sin nombre, saluda igual: `full_name` puede venir vacío de profiles.
const anonimo = renderEmail({ template: "review_request", payload: {}, nombre: "", baseUrl: BASE });
assert.ok(anonimo!.text.startsWith("Hola,"), "el saludo sin nombre queda roto");

// NTF-22 · el mensaje del admin SÍ viaja en el correo (es su razón de ser), y
// llega escapado. Es la única plantilla con cuerpo libre del proyecto.
const delAdmin = renderEmail({
  template: "admin_message",
  payload: { mensaje: "Hola:\nrevisa <b>esto</b> & responde." },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(delAdmin!.text.includes("revisa <b>esto</b>"), "el texto plano no lleva el mensaje");
assert.ok(delAdmin!.html.includes("&lt;b&gt;esto&lt;/b&gt;"), "el HTML no escapó el mensaje");
assert.ok(!delAdmin!.html.includes("<b>esto</b>"), "coló HTML del admin sin escapar");
assert.ok(delAdmin!.html.includes("&amp;"), "no escapó el ampersand");
assert.ok(delAdmin!.html.includes("<br>"), "los saltos de línea no llegaron al HTML");
assert.ok(delAdmin!.text.includes("/account"), "el enlace del admin no va a /account");

// El nombre también sale de datos del usuario y también se escapa.
const nombreRaro = renderEmail({
  template: "review_request",
  payload: {},
  nombre: "<script>x</script> Pérez",
  baseUrl: BASE,
});
assert.ok(!nombreRaro!.html.includes("<script>"), "coló un script por el nombre");

console.log(`OK · ${TEMPLATES.length} plantillas + 29 casos borde`);
