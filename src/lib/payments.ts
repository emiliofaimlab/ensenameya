import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { simulatedProvider } from "@/lib/payments/simulated-provider";
import { stripeProvider } from "@/lib/payments/stripe-provider";
import type { AnyProvider } from "@/lib/payments/port";

/**
 * EL ENRUTADOR DE PAGOS — el `PaymentRouter` del Doc 6 §6.2, en la forma que el
 * proyecto usa de verdad: dos funciones, no una clase con estado.
 *
 * El puerto y los adaptadores viven en `src/lib/payments/`; aquí está lo que
 * ELIGE entre ellos. Que haya un `payments.ts` **y** una carpeta `payments/` es
 * a propósito: `@/lib/payments` sigue resolviendo a este archivo, así que las
 * pantallas que ya importaban `activeChargeProvider` no se han tocado.
 *
 * Por aquí pasa quien tiene que resolver el proveedor DESDE EL DATO: el
 * checkout, que lo saca de `payments.provider`. Los dos endpoints que son de
 * Stripe por definición —`/api/webhooks/stripe` y el job de reembolsos, que
 * filtra la cola por `provider = 'stripe'`— importan su adaptador directamente,
 * porque no hay nada que elegir: dLocal traerá su propio webhook.
 *
 * Del Doc 6 falta `resolvePayout(payee_country)`, y falta porque no hay a quién
 * resolver: no existe adaptador de payouts en el repo (ver `port.ts`).
 */

/**
 * `resolveCharge` en su forma de dato: qué proveedor va a cobrar, según
 * `payment_routing_rules`.
 *
 * Existe porque la pantalla de checkout tiene que DECIR la verdad antes de que
 * el alumno pulse: con el proveedor simulado enseña el aviso de entorno de
 * pruebas y el botón de simular fallo; con Stripe, ninguna de las dos cosas.
 * Sin esto la interfaz se queda contando lo que era, que es exactamente el bug
 * que apareció al encender Stripe en la preview.
 *
 * Va con `service_role` porque la tabla no está concedida a `authenticated`:
 * es configuración de plataforma, y el runtime la lee dentro de las RPC.
 *
 * ⚠️ HAY QUE PASARLE EL PAÍS DEL TUTOR, y desde A0 (`20260901140000`) no es
 * opcional. Hasta esa migración la tabla tenía UNA fila y mirar «la activa» sin
 * filtrar daba siempre la respuesta correcta por accidente; ahora tiene diez —
 * ocho países de dLocal Go, Venezuela y la del tutor que aún no ha declarado
 * país— y un `order by priority limit 1` sin filtro devolvería la de cualquiera.
 * Se filtra exactamente igual que `create_booking_line`, que es lo que de verdad
 * congela `payments.provider`: si esta función y la RPC no coinciden, la
 * pantalla promete una pasarela y cobra otra.
 *
 * `payeeCountry` null NO es «da igual el país»: es el tutor que no lo ha
 * declarado, y tiene su propia fila (`payee_country` null). Por eso el filtro es
 * `.is(...)` y no «sin filtro».
 */
export async function activeChargeProvider(
  payeeCountry: string | null,
): Promise<string> {
  const base = createAdminClient()
    .from("payment_routing_rules")
    .select("charge_provider")
    .eq("is_active", true)
    // El comodín de esta tabla es el PAGADOR, y solo él: la RPC filtra por
    // `payer_country is null` y una fila con país de pagador no la ve nadie.
    .is("payer_country", null);

  const { data } = await (
    payeeCountry
      ? base.eq("payee_country", payeeCountry)
      : base.is("payee_country", null)
  )
    .order("priority")
    .limit(1)
    .maybeSingle();

  // Sin regla no se puede reservar (`create_booking` lanza RN-33). Se asume el
  // camino conservador: enseñar el aviso de simulado antes que fingir un cobro.
  return data?.charge_provider ?? "simulated";
}

/**
 * A0 · LOS PAÍSES A LOS QUE DE VERDAD PODEMOS TRANSFERIR.
 *
 * Es la lista que se le ofrece al tutor para declarar su país de cobro, y sale
 * de la tabla de ruteo en vez de estar escrita en el formulario por un motivo
 * concreto: declarar un país sin regla activa deja sus mentorías sin vender
 * (RN-33, «sin ruta de pago disponible para el destino»). Una lista a mano en el
 * TSX se desincroniza el día que alguien active o desactive una fila, y lo que
 * se rompe entonces no es un desplegable: es el checkout de ese tutor.
 *
 * ⚠️ SE EXCLUYE `payout_provider = 'simulated'`, que es lo que separa «tenemos
 * regla» de «podemos pagarte». Hoy eso deja fuera a Venezuela —que conserva
 * fila para no dejar sin vender a quien ya la tenga declarada, pero donde no
 * transfiere ni dLocal Go ni Stripe— y deja fuera a Colombia por no tener fila
 * ninguna. Es el mismo criterio con el que `adapterFor` trata 'simulated': no
 * es un proveedor, es la ausencia de uno.
 *
 * También se excluye la fila con `payee_country` null: es la regla del tutor que
 * NO ha declarado país, no un país que se pueda elegir.
 */
export async function payoutCountries(): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("payment_routing_rules")
    .select("payee_country")
    .eq("is_active", true)
    .is("payer_country", null)
    .not("payee_country", "is", null)
    .neq("payout_provider", "simulated")
    .order("payee_country");

  const codigos = (data ?? [])
    .map((r) => r.payee_country)
    .filter((c): c is string => Boolean(c));
  // Un país podría tener varias filas activas (distinta prioridad); al tutor se
  // le ofrece una vez.
  return [...new Set(codigos)];
}

/**
 * `adapterFor` del Doc 6 §6.3: de una clave de proveedor, su adaptador.
 *
 * La clave que se le pasa en el cobro es `payments.provider` —el snapshot que
 * `create_booking` congeló— y NO la regla activa de hoy: si alguien cambia la
 * tabla mientras hay reservas a medias, esas reservas terminan por donde
 * empezaron.
 *
 * Todo lo que no sea 'stripe' cae al simulado, igual que antes de que esto
 * fuera una función. Lee la advertencia de `simulated-provider.ts`: no es lo
 * mismo que "no hay proveedor", y añadir dLocal a la tabla sin su adaptador
 * pasa por aquí sin hacer ruido.
 *
 * Acepta `null` porque `payments.provider` es nullable en el esquema: una fila
 * sin proveedor tampoco es Stripe, y el `!== "stripe"` de antes ya la trataba
 * así.
 */
export function adapterFor(key: string | null): AnyProvider {
  return key === stripeProvider.key ? stripeProvider : simulatedProvider;
}

export type { AnyProvider, PaymentProvider, PspProvider } from "@/lib/payments/port";
