import "server-only";

import type { LocalProvider } from "./port";

/**
 * EL PROVEEDOR SIMULADO — el segundo adaptador, y el que demuestra que el
 * puerto no está inventado para un solo caso.
 *
 * Es el que lleva funcionando desde el principio: con
 * `payment_routing_rules.charge_provider = 'simulated'`, `create_booking`
 * congela `payments.provider = 'simulated'` y el cobro no sale de casa — lo
 * cierra el propio navegador llamando a `confirm_simulated_payment`, que exige
 * ser dueño de la reserva **y** que el pago sea de este proveedor (regla de
 * oro 2). No hay PSP, no hay Session, no hay webhook.
 *
 * ⚠️ POR QUÉ IMPLEMENTA `PaymentProvider` Y NO `PspProvider`. Porque no sabe
 * hacer lo del PSP y no vamos a fingir que sí: un `refund()` que lanza y un
 * `verifyWebhook()` que lanza son métodos muertos con otro nombre. El job de
 * reembolsos ya lo dice a su manera —filtra por `provider = 'stripe'` y cuenta
 * aparte lo que quede de otros—; esto es lo mismo, dicho en el tipo.
 *
 * ⚠️ Y ES EL CAJÓN DE SASTRE. `adapterFor` devuelve ESTE para cualquier clave
 * que no sea 'stripe', que es exactamente lo que hacía el `if (payment.provider
 * !== "stripe")` del checkout antes de este refactor. O sea: poner 'dlocal' en
 * `payment_routing_rules` HOY no rutea a dLocal, cae aquí. No regala nada —el
 * `confirm_simulated_payment` del navegador rebota porque el pago no es
 * 'simulated'—, pero deja al alumno con un checkout que no se puede terminar.
 * Activar un proveedor en la tabla antes que su adaptador es el orden
 * equivocado, y este comentario existe para que se lea antes de hacerlo.
 */
export const simulatedProvider: LocalProvider = {
  key: "simulated",
  // No hay credencial que poner ni API a la que llamar: el interruptor del
  // simulado es la fila de `payment_routing_rules`, no una variable de entorno.
  opensRemoteCheckout: false,
};
