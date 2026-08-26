import assert from "node:assert/strict";

import { renderEmail } from "./email-templates.ts";

/**
 * Comprobación mínima del renderizado de los correos. Sin framework: se corre
 * con `npm run check:email` y falla con un exit code si algo se rompe.
 *
 * Existe porque el job trata "no se pudo renderizar" y "el proveedor rechazó"
 * como el mismo fallo permanente, así que desde fuera no se distinguen. Sin
 * esto, una plantilla mal escrita se vería exactamente igual que una API key
 * caducada — y el aviso se marcaría `failed` sin que nadie supiera por qué.
 */
const BASE = "https://ensenameya.vercel.app";

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
  "recording_ready",
  "new_message",
];

for (const template of TEMPLATES) {
  const r = renderEmail({ template, payload: {}, nombre: "Lucía Fernández", baseUrl: BASE });
  assert.ok(r, `la plantilla "${template}" no renderiza`);
  assert.ok(r.subject.length > 0, `"${template}" sin asunto`);
  assert.ok(r.html.includes(BASE), `"${template}" sin enlace a la app`);
  assert.ok(r.text.includes("Lucía"), `"${template}" no saluda por el nombre`);
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

console.log(`OK · ${TEMPLATES.length} plantillas + 8 casos borde`);
