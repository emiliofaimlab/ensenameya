import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { simulatedProvider } from "@/lib/payments/simulated-provider";
import { stripeProvider } from "@/lib/payments/stripe-provider";
import { dlocalProvider } from "@/lib/payments/dlocal-provider";
import type { AnyProvider, PspProvider } from "@/lib/payments/port";

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
 * checkout, que lo saca de `payments.provider`, y el job de reembolsos, que lo
 * saca de `refund_requests.provider` (antes filtraba la cola por
 * `provider = 'stripe'` a mano, en cuatro sitios).
 *
 * Los webhooks NO pasan por aquí y no es una omisión: cada uno es de su
 * proveedor por definición —lo que los distingue es la FIRMA, y una firma solo
 * la sabe verificar quien la emitió— así que `/api/webhooks/stripe` y
 * `/api/webhooks/dlocalgo` importan su adaptador directamente. Son dos rutas
 * porque son dos secretos, no porque hagan cosas distintas.
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
 * Los PSP que saben mover dinero, por su clave. Es el registro que `adapterFor`
 * consulta, y es también la respuesta a «¿qué proveedores existen de verdad?»
 * para el job de reembolsos, que antes lo tenía escrito a mano como
 * `.eq('provider', 'stripe')` en cuatro sitios.
 *
 * ⚠️ ESTAR AQUÍ NO ES ESTAR ENCENDIDO. Que dLocal figure en este mapa significa
 * que su adaptador existe y sabe qué hacer si le llega trabajo — no que nadie
 * le vaya a rutear un cobro. Eso lo decide `payment_routing_rules`, que sigue
 * en 'simulated' y que se cambia con un `UPDATE`, no con un despliegue (regla
 * de oro 8: las decisiones se consumen como configuración). Y si la fila
 * cambiara sin que estén las credenciales, el checkout devuelve 503 diciendo
 * cuál falta en vez de caer al simulado — que es lo que hace que encender esto
 * sea reversible.
 */
const PSPS: Record<string, PspProvider> = {
  [stripeProvider.key]: stripeProvider,
  [dlocalProvider.key]: dlocalProvider,
};

/** Las claves de los PSP reales. La usa el job de reembolsos para filtrar. */
export const PSP_KEYS: string[] = Object.keys(PSPS);

/**
 * `adapterFor` del Doc 6 §6.3: de una clave de proveedor, su adaptador.
 *
 * La clave que se le pasa en el cobro es `payments.provider` —el snapshot que
 * `create_booking` congeló— y NO la regla activa de hoy: si alguien cambia la
 * tabla mientras hay reservas a medias, esas reservas terminan por donde
 * empezaron.
 *
 * ⚠️ YA NO ES UN TERNARIO, Y ESO CIERRA UN AGUJERO REAL. Hasta hoy todo lo que
 * no fuese 'stripe' caía al simulado, así que poner 'dlocal' en
 * `payment_routing_rules` producía un checkout que no se podía terminar y **sin
 * un solo error visible** (lo avisaba `simulated-provider.ts`). Con el registro,
 * una clave conocida encuentra su adaptador y una desconocida sigue cayendo al
 * simulado — que es lo correcto para 'simulated' y para `null`, porque ninguno
 * de los dos es un proveedor: son la ausencia de uno.
 *
 * Acepta `null` porque `payments.provider` es nullable en el esquema: una fila
 * sin proveedor tampoco es un PSP, y el `!== "stripe"` de antes ya la trataba
 * así.
 */
export function adapterFor(key: string | null): AnyProvider {
  return (key && PSPS[key]) || simulatedProvider;
}

export type { AnyProvider, PaymentProvider, PspProvider } from "@/lib/payments/port";
