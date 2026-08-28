import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * SCR-AD14 · El CRITERIO de las alertas, en un solo sitio.
 *
 * Las alertas no son una tabla: se DERIVAN de pagos fallidos, payouts en
 * problema y cancelaciones recientes, y se apagan escribiendo un acuse en
 * `alert_acks` (decisión 29). El detalle de cómo se pintan sigue viviendo en la
 * pantalla; lo que vive aquí es lo que **no puede divergir**: qué cuenta como
 * alerta y cómo se empareja con su acuse.
 *
 * Existe porque el menú lateral empezó a llevar un contador de pendientes
 * (EY-189, 2ª tanda) y un badge que dijera «3» sobre una pantalla que enseña 5
 * es peor que no tener badge: el número deja de significar nada. Con la ventana
 * y los estados aquí, la pantalla y el badge cuentan lo mismo por construcción.
 */

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/**
 * Cuánto hacia atrás se miran pagos y cancelaciones. Los payouts NO llevan
 * ventana a propósito: un payout `on_hold` de hace dos meses sigue siendo
 * dinero retenido de alguien, y dejar de contarlo no lo desbloquea.
 */
export const ALERTAS_DIAS = 30;

/** Estados de payout que piden una decisión humana (M7). */
export const PAYOUT_PROBLEMA: PayoutStatus[] = ["failed", "on_hold"];

/** El corte de la ventana, en ISO/UTC (regla de oro 4). */
export function desdeAlertas(): string {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - ALERTAS_DIAS);
  return since.toISOString();
}

/**
 * La clave con la que una alerta encuentra su acuse. `alert_acks` guarda
 * `(kind, entity_id)` porque la alerta no tiene id propio —no existe como
 * fila—, así que su identidad es la entidad de la que sale más el tipo.
 */
export function ackKey(kind: string, entityId: string): string {
  return `${kind}:${entityId}`;
}

/**
 * Cuántas alertas están SIN reconocer ahora mismo.
 *
 * ⚠️ Cuatro consultas para un número, y no hay forma de bajarlo sin cambiar el
 * modelo: las alertas se derivan de tres tablas distintas y el acuse vive en una
 * cuarta. Se piden solo los ids —no los importes ni los nombres, que es lo que
 * la pantalla necesita y el contador no— y van en paralelo, así que cuesta un
 * viaje de red, no cuatro.
 *
 * Los `limit(20)` son los MISMOS que aplica la pantalla, a propósito: si la
 * lista se corta en 20 y el badge dijera 47, el admin atendería veinte y el
 * número se quedaría clavado sin nada que pulsar.
 *
 * Un fallo NO revienta el menú: se devuelve 0 y no se pinta badge, que es el
 * mismo compromiso que ya acepta `listReports` (una cola vacía y una consulta
 * rota se ven igual).
 */
export async function countUnackedAlerts(): Promise<number> {
  const supabase = await createClient();
  const desde = desdeAlertas();

  const [{ data: acks }, { data: pagos }, { data: payouts }, { data: cancel }] =
    await Promise.all([
      supabase.from("alert_acks").select("kind, entity_id"),
      supabase
        .from("payments")
        .select("id")
        .eq("status", "failed")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("payouts")
        .select("id")
        .in("status", PAYOUT_PROBLEMA)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("bookings")
        .select("id")
        .eq("status", "cancelled")
        .gte("cancelled_at", desde)
        .order("cancelled_at", { ascending: false })
        .limit(20),
    ]);

  const reconocidas = new Set(
    (acks ?? []).map((a) => ackKey(a.kind, a.entity_id)),
  );

  const sinReconocer = (kind: string, filas: { id: string }[] | null) =>
    (filas ?? []).filter((f) => !reconocidas.has(ackKey(kind, f.id))).length;

  return (
    sinReconocer("pago", pagos) +
    sinReconocer("payout", payouts) +
    sinReconocer("cancelacion", cancel)
  );
}
