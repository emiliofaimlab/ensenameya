/**
 * EL MAPEO PURO DE PAYPAL — separado del adaptador a propósito.
 *
 * No es una capa: es que `paypal-provider.ts` lleva `import "server-only"` y con
 * eso su lógica no se puede correr desde un script de node. Estas funciones son
 * las que deciden si un tutor cobró y qué se le cobra a un alumno, y merecen una
 * comprobación que se pueda ejecutar. Ver `paypal-mapeo.check.ts`.
 */
import type { PayoutResult } from "./port";

export class PaypalError extends Error {
  // Campos explícitos y no propiedades de parámetro: `node --experimental-strip-types`
  // borra tipos, no transforma sintaxis, y `readonly x: T` en el constructor lo
  // hace fallar. Lo que corre la comprobación de este fichero es ese node.
  status: number;
  cuerpo: unknown;
  constructor(status: number, cuerpo: unknown, mensaje: string) {
    super(mensaje);
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

export type LotePaypal = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: Array<{
    transaction_status: string;
    payout_item_id: string;
    errors?: { name?: string; message?: string };
  }>;
};

/**
 * El lote ya existe: PayPal lo dice en un 400 y trae su URL en `details[].link`.
 * Devuelve el `payout_batch_id`, o `null` si el 400 es por cualquier otra cosa.
 *
 * ⚠️ Se lee el ENLACE y no se compone la URL: si PayPal cambiara el formato del
 * id, componerla nos dejaría preguntando por un lote que no existe y tratando
 * una orden viva como inexistente. El enlace lo da él.
 */
export function loteYaExistente(e: unknown): string | null {
  if (!(e instanceof PaypalError) || e.status !== 400) return null;
  const detalles = (e.cuerpo as { details?: Array<Record<string, unknown>> })?.details ?? [];
  for (const d of detalles) {
    if (d.field !== "SENDER_BATCH_ID") continue;
    const enlaces = (d.link as Array<{ href?: string }> | undefined) ?? [];
    const href = enlaces[0]?.href;
    if (href) return href.split("/").pop() ?? null;
  }
  return null;
}

/**
 * 🔴 EL LOTE YA EXISTE PERO PAYPAL NO DICE CUÁL.
 *
 * Mismo 400 de `SENDER_BATCH_ID` duplicado, sin el `details[].link` que trae su
 * id. `loteYaExistente` devuelve `null` ahí —y hace bien: componer la URL a mano
 * nos dejaría preguntando por un lote que no existe—, pero ese `null` es
 * indistinguible del de un 400 por cualquier otra cosa, y ahí estaba el fallo:
 * la orden acababa clasificada como RECHAZADA, o sea «el proveedor no creó
 * nada», cuando el mensaje dice literalmente lo contrario.
 *
 * Con el descenso de rieles (AUD-01) eso pasó de ser un fallo latente a uno
 * caro: una orden «rechazada» puede bajar al siguiente riel y pagar otra vez el
 * dinero que este lote ya puede estar pagando.
 *
 * Quien pregunta esto tiene que devolver `en-duda`: hay un pago que conciliar y
 * no lo podemos identificar solos. Es la única salida honesta.
 */
export function loteDuplicadoSinEnlace(e: unknown): boolean {
  if (!(e instanceof PaypalError) || e.status !== 400) return false;
  const detalles = (e.cuerpo as { details?: Array<Record<string, unknown>> })?.details ?? [];
  return detalles.some((d) => {
    if (d.field !== "SENDER_BATCH_ID") return false;
    const enlaces = (d.link as Array<{ href?: string }> | undefined) ?? [];
    // Solo los que NO traen enlace: los que lo traen ya los adopta
    // `loteYaExistente`, que es el camino bueno.
    return !enlaces[0]?.href;
  });
}

/** PayPal habla en unidad mayor con dos decimales. `payouts.amount` es menor. */
export function aDecimal(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}


/**
 * DE LOS ESTADOS DE PAYPAL A LOS CUATRO DESENLACES QUE LA FILA ADMITE.
 *
 * Manda el estado del ITEM, no el del lote: mandamos un item por lote, y el lote
 * puede decir `SUCCESS` con el item `UNCLAIMED`. Escribir 'paid' ahí mandaría el
 * correo NTF-12 «se pagó tu liquidación» a un tutor que no tiene el dinero.
 *
 * ⚠️ `UNCLAIMED` es el que más se malinterpreta: PayPal aceptó y retiene el pago
 * 30 días esperando a que el destinatario reclame; si no lo hace, lo devuelve.
 * No es un fallo (todavía) y no es un pago (todavía) → 'enviado', que deja la
 * orden en 'processing' y la sigue mirando. Es exactamente el caso de un tutor
 * cuyo correo no tiene cuenta de PayPal.
 */
export function desenlace(lote: LotePaypal, marca: string, adoptado: boolean): PayoutResult {
  const id = lote.batch_header.payout_batch_id;
  const item = lote.items?.[0];
  const estado = item?.transaction_status ?? lote.batch_header.batch_status;
  const detalle = `${lote.batch_header.batch_status}/${estado}`;

  switch (estado) {
    case "SUCCESS":
      return { estado: "pagado", payoutId: id, detalle, adoptado };

    case "PENDING":
    case "PROCESSING":
    case "ONHOLD":
    case "UNCLAIMED":
      return { estado: "enviado", payoutId: id, detalle, adoptado };

    // El identificador está muerto: no pagó y no va a pagar. La orden puede
    // volver a la cola CON UN INTENTO NUEVO — y por eso no es 'rechazado'.
    case "DENIED":
    case "FAILED":
    case "BLOCKED":
    case "RETURNED":
    case "REVERSED":
    case "REFUNDED":
    case "CANCELED":
      return {
        estado: "difunto",
        payoutId: id,
        detalle,
        mensaje: item?.errors?.message ?? item?.errors?.name ?? `PayPal: ${detalle}`,
      };

    default:
      // Un estado que PayPal no tenía cuando esto se escribió. NO se adivina:
      // 'enviado' deja la orden en seguimiento y no miente sobre el dinero.
      return { estado: "enviado", payoutId: id, detalle: `${detalle} (desconocido)`, adoptado };
  }
}



/**
 * ── A QUIÉN SE LE PAGA, Y CON QUÉ FORMA DE IDENTIFICARLO ────────────────────
 *
 * 🔴 SE PREFIERE EL ID CONECTADO AL CORREO, SIEMPRE, y no es una opinión:
 *
 *     receptor = correo tecleado   → UNCLAIMED  (4 de 4, 4-sep-2026)
 *     receptor = id de cuenta      → SUCCESS    (inmediato, misma cuenta)
 *
 * Un correo solo entrega si está CONFIRMADO en una cuenta de PayPal, y eso no
 * se puede comprobar al guardarlo. El id lo firma PayPal en el OAuth: existe,
 * es de esa persona y entrega.
 *
 * ⚠️ El correo NO desaparece. Es el respaldo de quien no conecte su cuenta, y
 * la única razón de que esta función tenga dos ramas en vez de una.
 */
export type BeneficiarioPaypal = {
  holder_name?: string | null;
  handle?: string | null;
  verified_account_id?: string | null;
};

export type Receptor =
  | { recipient_type: "PAYPAL_ID"; receiver: string; conectada: true }
  | { recipient_type: "EMAIL"; receiver: string; conectada: false };

export function receptorDe(b: BeneficiarioPaypal): Receptor | null {
  const id = b.verified_account_id?.trim();
  if (id) return { recipient_type: "PAYPAL_ID", receiver: id, conectada: true };

  const correo = b.handle?.trim();
  if (correo) return { recipient_type: "EMAIL", receiver: correo, conectada: false };

  // Ni una cosa ni la otra: quien llame tiene que devolver `sin-datos`, no
  // inventarse un receptor. Un payout a la nada es dinero perdido de verdad.
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// EL COBRO — PayPal deja de ser solo el que paga (15-sep-2026)
// ════════════════════════════════════════════════════════════════════════════
//
// ── LO QUE SE MIDIÓ, porque esto decide la forma del adaptador ─────────────
// Contra el sandbox, con las claves que ya estaban en `.env.local`:
//
//   · `POST /v2/checkout/orders` de 12,00 USD → 200 `PAYER_ACTION_REQUIRED` y
//     un enlace `www.sandbox.paypal.com/checkoutnow?token=…`.
//   · La MISMA llamada con el mismo `PayPal-Request-Id` → **el mismo id de
//     orden**, no una orden nueva.
//
// 🔑 Ese segundo punto es el que hace que este cobro se parezca a Stripe y no a
// dLocal Go. Allí repetir el `order_id` da `5009 Order id is duplicated` —un
// 400 seco— y por eso su adaptador tiene que EMULAR la idempotencia con memoria
// en nuestra base (`sujetoDelCobro`, `refGuardada`, `sellarRef`: 250 líneas).
// Aquí la cabecera es la memoria: recargar el checkout devuelve la misma orden
// porque `idempotencyKey` es determinista por sujeto. **No se escribe nada de
// eso**, igual que no se escribió el barrido de huérfanos del payout y por el
// mismo motivo.
//
// ponytail: el techo es que dependemos de `PayPal-Request-Id`. Si un día dejara
// de deduplicar se notaría enseguida —dos órdenes vivas para una reserva— y
// entonces tocaría sellar `provider_payment_id` antes de redirigir, como dLocal.

/** Lo que responde `POST /v2/checkout/orders`, en lo que nos importa. */
export type OrdenPaypal = {
  id: string;
  status: string;
  links?: Array<{ href?: string; rel?: string }>;
};

/**
 * Lo que este mapeo necesita de un `ChargeInput`. Se declara aparte en vez de
 * importar el tipo del puerto porque `port.ts` lleva `import "server-only"` y
 * este fichero tiene que poder correr bajo `node --experimental-strip-types`.
 * El compilador ata las dos formas en el adaptador, que sí importa las dos.
 */
export type CobroPaypal = {
  ref: { tipo: "booking" | "order"; id: string };
  lineas: Array<{ concepto: string; amountMinor: number }>;
  currency: string;
  returnUrl: string;
};

/** PayPal corta `description` y `custom_id` en 127 caracteres. */
const TOPE = 127;

/**
 * 🔑 A QUIÉN SE ACREDITA ESTE DINERO CUANDO VUELVA EL WEBHOOK.
 *
 * Va con el tipo DENTRO (`booking-…` / `order-…`) y no como un uuid pelado, que
 * es lo que hace Stripe con las reservas por razones históricas. Un uuid sin
 * tipo es un `string` con dos significados posibles, y de eso ya avisa `CobroRef`
 * en el puerto: así es como se confirma una reserva con el id de un pedido.
 */
export function refExterna(ref: CobroPaypal["ref"]): string {
  return `${ref.tipo}-${ref.id}`;
}

/** El camino de vuelta, para el webhook. `null` si no es nuestro. */
export function refDeCustomId(custom: string | null | undefined): CobroPaypal["ref"] | null {
  const m = /^(booking|order)-([0-9a-f-]{36})$/i.exec((custom ?? "").trim());
  return m ? { tipo: m[1] as "booking" | "order", id: m[2] } : null;
}

/**
 * El cuerpo del `POST /v2/checkout/orders`.
 *
 * ⚠️ SIN `items` NI `breakdown`, Y ES DELIBERADO. PayPal exige que la suma de
 * `items[].unit_amount × quantity` cuadre al céntimo con `amount.breakdown.
 * item_total` y que ese cuadre con `amount.value`, o responde 422 y no cobra
 * nadie. Es aritmética duplicada para pintar un desglose que el alumno ya tiene
 * delante en NUESTRA pantalla — la misma que Stripe tampoco le enseña, porque
 * con `ui_mode:'form'` sus `line_items` no se ven. El desglose que se lee es el
 * nuestro; aquí solo viaja el total, que es lo único que se cobra.
 *
 * `cancel_url` = `return_url` a propósito: cancelar en PayPal devuelve al
 * checkout, que es donde se puede reintentar. El puerto no lleva un campo para
 * eso porque los otros dos rieles no tienen a dónde cancelar (el formulario se
 * monta dentro).
 */
export function ordenDeCobro(input: CobroPaypal): Record<string, unknown> {
  const total = input.lineas.reduce((s, l) => s + l.amountMinor, 0);
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: refExterna(input.ref),
        description: input.lineas.map((l) => l.concepto).join(" · ").slice(0, TOPE),
        amount: { currency_code: input.currency, value: aDecimal(total) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Enséñame Ya",
          locale: "es-ES",
          // Sin dirección: no vendemos nada que se envíe, y pedirla sería un
          // paso más y un dato personal de más.
          shipping_preference: "NO_SHIPPING",
          // «Pagar ahora» en vez de «Continuar»: se cobra al aprobar, no hay
          // una pantalla nuestra después donde confirmar otra vez.
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.returnUrl,
        },
      },
    },
  };
}

/**
 * A dónde se manda al alumno. `null` si esta orden ya no es pagable.
 *
 * ⚠️ SE LEE EL ENLACE, NO SE COMPONE LA URL — mismo criterio que
 * `loteYaExistente`: el `token=` de `checkoutnow` es el id de la orden HOY, y
 * componerlo a mano nos deja mandando gente a una pantalla que no existe el día
 * que eso cambie.
 *
 * Se aceptan los dos `rel` porque son el mismo enlace con dos nombres: con
 * `payment_source.paypal` dentro —lo que manda `ordenDeCobro`— PayPal lo llama
 * `payer-action`, y sin él `approve`. Medido: `payer-action`.
 *
 * `null` NO significa «falló». Significa que la orden existe y no admite
 * aprobación: típicamente porque YA se aprobó o se pagó, que es lo que devuelve
 * repetir la petición idempotente después de pagar. Quien llame tiene que tratar
 * eso como «hay un cobro vivo ahí» y NO abrir otro.
 */
export function enlaceDePago(orden: OrdenPaypal): string | null {
  const l = (orden.links ?? []).find((x) => x.rel === "payer-action" || x.rel === "approve");
  return l?.href ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// EL WEBHOOK — de lo que manda PayPal, a nuestro vocabulario
// ════════════════════════════════════════════════════════════════════════════

/** Lo que trae un evento de PayPal, en lo que este sistema mira. */
export type EventoPaypal = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    purchase_units?: Array<{
      custom_id?: string;
      amount?: { currency_code?: string; value?: string };
    }>;
  };
};

/**
 * El gemelo de `aDecimal`. PayPal manda «78.33» y la base guarda 7833.
 *
 * ⚠️ `Math.round` Y NO `parseInt`: `78.33 * 100` es `7832.999999999999` en coma
 * flotante, y truncarlo cobra un céntimo de menos. Ese céntimo no es cosmético
 * — `confirm_payment` concilia lo cobrado contra lo debido y ABORTA si no
 * cuadra, así que un redondeo mal puesto no cobra de menos: deja la reserva sin
 * confirmar con el dinero ya cobrado.
 */
export function aMenor(valor: string | null | undefined): number | null {
  if (valor == null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * LOS CUATRO EVENTOS QUE IMPORTAN, y por qué son esos.
 *
 * ── EL CICLO REAL DE UN COBRO POR PAYPAL ───────────────────────────────────
 *
 *   1. `CHECKOUT.ORDER.APPROVED` — el alumno aprobó. Es 'cobro-en-curso' y NO
 *      'cobro-confirmado', y eso sigue siendo correcto aunque el dinero ya se
 *      haya movido (PayPal captura sola al aprobar: ver `paypal-provider.ts`).
 *      El motivo ya no es «todavía no hay dinero» sino que este evento **no
 *      trae el id de la captura ni su importe**, y sin los dos no se puede ni
 *      conciliar lo cobrado ni dejar escrito con qué reembolsar.
 *   2. la ruta llama a capturar por si acaso (normalmente: `ya-capturada`).
 *   3. `PAYMENT.CAPTURE.COMPLETED` — trae captura e importe. Esto sí acredita.
 *
 * 🔑 Y POR ESO `chargeRef` ES EL ID DE LA CAPTURA, NO EL DE LA ORDEN. De esa
 * cadena cuelga el reembolso entero: se sella en `payments.provider_payment_id`,
 * `enqueue_refund` la copia a la cola y el adaptador llama a
 * `/v2/payments/captures/{id}/refund`. Con el id de la orden ahí, todo
 * reembolso moriría con un 404 que nadie mira hasta que un alumno reclama.
 *
 * ── LO QUE NO SE TRADUCE, A PROPÓSITO ──────────────────────────────────────
 *
 * `CHECKOUT.ORDER.VOIDED` (la orden caducó sin capturar) NO es 'cobro-fallido'.
 * Un 'cobro-fallido' sobre una reserva llama a `confirm_payment(success=false)`
 * y la vence; aquí no se cobró nada, así que no hay nada que deshacer y el
 * `expire-stale-bookings` de siempre libera el hueco. Menos caminos que puedan
 * vencer una reserva es menos formas de vencerla por error.
 *
 * `PAYMENT.CAPTURE.REFUNDED` y `.REVERSED` tampoco: el reembolso ya lo escribió
 * quien lo pidió (la cola de X-02 o `refunds-process`), y una segunda mano
 * tocando esas filas desde fuera es como se descuadra un saldo.
 */
export function eventoDeWebhook(cuerpo: EventoPaypal): {
  id: string;
  rawType: string;
  kind: "cobro-confirmado" | "cobro-en-curso" | "cobro-fallido" | "otro";
  ref: CobroPaypal["ref"] | null;
  chargeRef: string | null;
  objectRef: string | null;
  amountMinor: number | null;
  currency: string | null;
} {
  const tipo = cuerpo.event_type ?? "";
  const r = cuerpo.resource ?? {};
  // El `custom_id` viaja en la captura cuando la hay, y dentro de la unidad de
  // compra cuando el evento es de la orden. Es el MISMO dato en dos sitios.
  const unidad = r.purchase_units?.[0];
  const importe = r.amount ?? unidad?.amount;

  const comun = {
    id: cuerpo.id ?? "",
    rawType: tipo,
    ref: refDeCustomId(r.custom_id ?? unidad?.custom_id),
    objectRef: r.id ?? null,
    amountMinor: aMenor(importe?.value),
    currency: importe?.currency_code ?? null,
  };

  switch (tipo) {
    case "PAYMENT.CAPTURE.COMPLETED":
      // 🔑 `chargeRef` = el id de la CAPTURA, que aquí es `resource.id`.
      return { ...comun, kind: "cobro-confirmado", chargeRef: r.id ?? null };

    case "CHECKOUT.ORDER.APPROVED":
      // Sin `chargeRef`: todavía no existe ninguna captura. `objectRef` lleva el
      // id de la orden, que es lo que necesita la llamada de captura.
      return { ...comun, kind: "cobro-en-curso", chargeRef: null };

    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      return { ...comun, kind: "cobro-fallido", chargeRef: r.id ?? null };

    default:
      return { ...comun, kind: "otro", chargeRef: null };
  }
}
