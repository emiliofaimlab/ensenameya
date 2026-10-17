// D2 · reenvía en LOCAL el aviso de pago de dLocal Go (sandbox).
//
//   node --env-file=.env.local scripts/dlocal-aviso-local.mjs DP-273608 [http://localhost:3002]
//
// En local dLocal no puede llamar a nuestro webhook (la `notification_url` es
// una dirección de tu máquina), así que un pago transparente se queda `pending`
// y su apartado de 7 minutos caduca con el dinero cobrado en el sandbox. Esto
// manda el MISMO aviso que mandaría dLocal: el cuerpo es solo el `payment_id`,
// firmado como lo verifica `lib/dlocalgo.ts` (HMAC-SHA256 de apiKey + cuerpo
// con la clave secreta). El webhook vuelve a preguntarle el estado a la API de
// dLocal, así que no se puede «aprobar» un pago que no se pagó.
//
// ⚠️ Solo contra el sandbox: con las claves de producción en `.env.local` esto
// confirmaría un cobro real. Mirar `DLOCALGO_API_BASE` antes de usarlo.
import { createHmac } from "node:crypto";

const [paymentId, base = "http://localhost:3000"] = process.argv.slice(2);
const { DLOCALGO_API_KEY: apiKey, DLOCALGO_SECRET_KEY: secret, DLOCALGO_API_BASE } = process.env;

if (!paymentId?.startsWith("DP-")) {
  console.error("Uso: node --env-file=.env.local scripts/dlocal-aviso-local.mjs DP-123 [origen]");
  process.exit(1);
}
if (!apiKey || !secret) {
  console.error("Faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY (¿--env-file=.env.local?).");
  process.exit(1);
}
if (DLOCALGO_API_BASE && !DLOCALGO_API_BASE.includes("sbx")) {
  console.error(`DLOCALGO_API_BASE=${DLOCALGO_API_BASE} no es el sandbox: no lo mando.`);
  process.exit(1);
}

const body = JSON.stringify({ payment_id: paymentId });
const firma = createHmac("sha256", secret).update(apiKey + body, "utf8").digest("hex");
const res = await fetch(`${base}/api/webhooks/dlocalgo`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `V2-HMAC-SHA256, Signature: ${firma}` },
  body,
});
console.log(res.status, await res.text());
