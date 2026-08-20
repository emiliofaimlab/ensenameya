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
 * ponytail: mira la regla activa sin filtrar por país porque `create_booking`
 * hoy resuelve el payee a 'VE' fijo (20260715170000:121). El día que el país
 * salga del tutor, esto tiene que recibirlo y filtrar igual que la RPC — y
 * entonces la firma de aquí se parecerá a la del Doc 6,
 * `resolveCharge(payer, payee)`.
 */
export async function activeChargeProvider(): Promise<string> {
  const { data } = await createAdminClient()
    .from("payment_routing_rules")
    .select("charge_provider")
    .eq("is_active", true)
    .order("priority")
    .limit(1)
    .maybeSingle();

  // Sin regla no se puede reservar (`create_booking` lanza RN-33). Se asume el
  // camino conservador: enseñar el aviso de simulado antes que fingir un cobro.
  return data?.charge_provider ?? "simulated";
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
