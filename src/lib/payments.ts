import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Qué proveedor va a cobrar, según `payment_routing_rules`.
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
 * salga del tutor, esto tiene que recibirlo y filtrar igual que la RPC.
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
