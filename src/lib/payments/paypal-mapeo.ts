/**
 * EL MAPEO PURO DE PAYPAL — separado del adaptador a propósito.
 *
 * No es una capa: es que `paypal-provider.ts` lleva `import "server-only"` y con
 * eso su lógica no se puede correr desde un script de node. Estas tres funciones
 * son las que deciden si un tutor cobró, y merecen una comprobación que se pueda
 * ejecutar. Ver `paypal-mapeo.check.ts`.
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

