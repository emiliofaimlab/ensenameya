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

// Las 11 plantillas de correo del Doc 7 tienen que existir. Si alguien añade un
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

// Sin nombre, saluda igual: `full_name` puede venir vacío de profiles.
const anonimo = renderEmail({ template: "review_request", payload: {}, nombre: "", baseUrl: BASE });
assert.ok(anonimo!.text.startsWith("Hola,"), "el saludo sin nombre queda roto");

console.log(`OK · ${TEMPLATES.length} plantillas + 5 casos borde`);
