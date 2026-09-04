/**
 * CONNECT — LA CLASIFICACIÓN, SEPARADA DEL SDK.
 *
 * Igual que `paypal-mapeo.ts` y por el mismo motivo: decidir si una orden va a
 * 'failed', vuelve a la cola o se queda quieta es la decisión que mueve (o
 * entierra) el dinero de un tutor, y tiene que poder ejecutarse en un
 * `--experimental-strip-types` sin credenciales ni red. Este archivo no importa
 * `stripe` a propósito: recibe la FORMA del error, no el error.
 *
 * ── LO QUE HACE A ESTE RIEL DISTINTO DE dLOCAL ──────────────────────────────
 *
 * Stripe tiene claves de idempotencia de verdad y `transfer_group`, así que
 * aquí NO hay barrido de páginas ni `en-duda` por no poder demostrar nada:
 *
 *   · reintentar `transfers.create` con la misma clave devuelve LA MISMA
 *     transferencia, no una segunda;
 *   · y si la clave ha caducado (Stripe las guarda 24 h), `transfers.list({
 *     transfer_group })` la encuentra por su marca en UNA llamada, sin paginar,
 *     porque el filtro es exacto.
 *
 * Por eso `sin-rastro` sí se puede DEMOSTRAR en este riel: una lista vacía
 * filtrada por una marca única es una prueba, no un «no lo encontré».
 */

/** La forma de un error de Stripe, sin el SDK. */
export type ErrorStripe = {
  type?: string;
  code?: string;
  statusCode?: number;
  message?: string;
};

/**
 * Qué hacer con un error de `transfers.create`. Los nombres son los estados de
 * `PayoutResult`; traducirlos es una línea en el adaptador.
 *
 * 🔴 EL CRITERIO ES «¿REPETIRLO MAÑANA DA OTRA COSA?», y de ahí sale todo:
 *
 *   · `sin-credencial` — 401/403. No es de esta orden, es del job entero.
 *   · `sin-fondos` — el balance no da. Es dinero que se debe: vuelve a la cola,
 *     nunca 'failed'.
 *   · `transitorio` — 429, 5xx, red. Fue el momento.
 *   · `rechazado` — el destino no existe, no acepta transferencias o le falta
 *     la capability. Repetirlo da lo mismo hasta que alguien lo arregle.
 *
 * ⚠️ EL DEFECTO ES `transitorio` Y NO `rechazado`, al revés de lo que pide el
 * instinto. Un error que no reconocemos puede ser cualquier cosa; mandarlo a
 * 'failed' entierra el pago de un tutor sin que nadie mire, mientras que
 * devolverlo a la cola lo hace ruidoso. El coste de equivocarse no es simétrico.
 */
export function verdictoDeTransferencia(e: ErrorStripe): Verdicto {
  const status = e.statusCode ?? 0;

  if (status === 401 || status === 403 || e.type === "StripeAuthenticationError"
      || e.type === "StripePermissionError") {
    return "sin-credencial";
  }
  if (e.code === "balance_insufficient") return "sin-fondos";
  // 🔴 EL ALTA A MEDIAS NO ES UN RECHAZO, y este código estuvo en la lista de
  // abajo hasta que se midió: `transfers.create` contra una cuenta recién
  // creada devuelve exactamente esto (400 `insufficient_capabilities_for
  // _transfer`, medido el 4-sep-2026 contra CO, ES y MX en test mode).
  //
  // Se arregla solo en cuanto el tutor termine su alta en Stripe, así que
  // mandarlo a 'failed' enterraría un pago por una razón temporal y obligaría a
  // un admin a resucitarlo. El adaptador ya pregunta antes con
  // `cuentaConectadaLista`; esto es la red por si la capability se cae ENTRE la
  // pregunta y la transferencia.
  if (e.code === "insufficient_capabilities_for_transfer") return "sin-datos";
  if (status === 429 || e.type === "StripeRateLimitError") return "transitorio";
  if (status >= 500 || e.type === "StripeConnectionError" || e.type === "StripeAPIError") {
    return "transitorio";
  }
  // 400 con un código que señala al DESTINO: la orden no va a mejorar sola.
  if (status === 400 && e.code && CODIGOS_DEL_DESTINO.has(e.code)) return "rechazado";
  if (e.type === "StripeInvalidRequestError" && status === 400) return "rechazado";

  return "transitorio";
}

export type Verdicto =
  | "sin-credencial"
  | "sin-fondos"
  | "sin-datos"
  | "transitorio"
  | "rechazado";

/**
 * Los que dicen «el problema es a quién le pagas». No es una lista exhaustiva
 * de los códigos de Stripe y no pretende serlo: cualquier
 * `StripeInvalidRequestError` con 400 ya cae en `rechazado` por la regla de
 * abajo. Están nombrados porque son los que se van a ver de verdad, y verlos
 * escritos ahorra abrir el panel para entender un 'failed'.
 */
const CODIGOS_DEL_DESTINO = new Set([
  "account_invalid",              // el acct_ no existe o no es nuestro
  "account_country_invalid_address",
  "transfers_not_allowed",        // a esta cuenta no se le puede transferir
  "parameter_invalid_empty",
]);

/**
 * ¿Esta transferencia sigue viva?
 *
 * `reversed` es lo único que la mata: una transferencia revertida NO pagó, y la
 * orden puede volver a la cola con un intento nuevo (`difunto`). Una
 * transferencia parcialmente revertida (`amount_reversed` entre 0 y `amount`)
 * NO es difunta: parte del dinero llegó, y volver a mandarla entera pagaría de
 * más.
 *
 * ponytail: se mira la transferencia y no el payout que la cuenta conectada
 * hace después a su banco. El techo: sabemos que el dinero es del tutor, no que
 * su banco lo tenga. El día que eso importe se consulta
 * `payouts.list({stripeAccount})`, que es otra llamada y otra historia.
 */
export function estadoDeTransferencia(t: { reversed?: boolean; amount_reversed?: number; amount?: number }):
  "viva" | "difunta" | "revertida-en-parte" {
  if (t.reversed === true) return "difunta";
  const revertido = t.amount_reversed ?? 0;
  if (revertido > 0 && revertido < (t.amount ?? 0)) return "revertida-en-parte";
  return "viva";
}
