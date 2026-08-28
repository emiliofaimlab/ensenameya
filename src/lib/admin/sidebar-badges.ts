import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { countUnackedAlerts } from "@/lib/admin/alertas";
import { countPendingReports } from "@/lib/admin/reports";

/**
 * Los contadores del menú lateral del admin (petición del cliente, 28-ago:
 * «en un badge al lado de reportes, incidentes, etc salga un número con
 * respecto a cuántos hay»).
 *
 * ── TRES REGLAS QUE DECIDEN QUÉ LLEVA BADGE Y QUÉ NO ────────────────────────
 *
 * **1 · Pendiente, nunca total.** El badge tiene que ser trabajo que espera una
 * decisión, no el tamaño de la tabla. Un «Pagos 1.284» no le dice nada a nadie
 * y encima nunca baja, así que el admin aprende a ignorar todos los badges —
 * incluidos los tres que sí importan.
 *
 * **2 · El criterio lo pone la PANTALLA, no este fichero.** Cada número sale de
 * la misma función que la pantalla usa para su propia cuenta
 * (`countPendingReports`, `countUnackedAlerts`); solo los tutores se cuentan
 * aquí, y con la misma condición literal que el dashboard
 * (`approval_status = 'pending'`). Inventar aquí un criterio propio garantiza
 * que el badge diga 8 y la pantalla enseñe 5.
 *
 * **3 · Cero no pinta badge.** Lo resuelve `AppSidebar`, que ignora los valores
 * a 0. Aquí se devuelven igualmente para que el mapa sea legible al depurar.
 *
 * ── LAS QUE NO LLEVAN, Y POR QUÉ ────────────────────────────────────────────
 * · **Pagos** — «en proceso» (`pending`/`authorized`) es un estado normal y
 *   transitorio de un cobro, no una cola: nadie tiene que hacer nada con él y
 *   el número nunca llegaría a cero. Sigue en el dashboard, que es donde se
 *   mira una cifra sin que te persiga.
 * · **Reservas, Categorías, Tiers, Estadísticas, Mentorías impartidas** — son
 *   consulta, no bandeja. No existe «reserva pendiente de que el admin haga
 *   algo».
 * · **Payouts** — sí es una cola, pero la decide un lote semanal y no un
 *   reporte; se deja fuera de esta tanda a propósito para no mezclar la
 *   supervisión de dinero (M7) con la moderación. Añadirla es una línea.
 * · **Reembolsos y Correos en cola** — son colas de verdad y las cuenta el
 *   dashboard, pero **no tienen entrada de menú**: no hay dónde colgar el badge.
 *
 * ⚠️ `cache()` de React, no `unstable_cache`: se memoiza por PETICIÓN, no entre
 * peticiones. Es justo lo que hace falta —un número obsoleto en una bandeja de
 * moderación es peor que uno que cuesta tres consultas— y evita que se pague
 * dos veces si algún día el layout y la pantalla lo piden a la vez.
 */
export type SidebarBadges = Record<string, number>;

export const adminSidebarBadges = cache(async (): Promise<SidebarBadges> => {
  const supabase = await createClient();

  // Las tres en paralelo: son independientes y ninguna necesita el resultado de
  // otra. En serie, esto sumaría a TODAS las pantallas del panel.
  const [{ count: tutores }, reportes, alertas] = await Promise.all([
    // Misma condición que la cola de `/admin/tutores` y que el dashboard.
    // `head: true` → no viaja ni una fila, solo el `Content-Range`.
    supabase
      .from("tutor_profiles")
      .select("profile_id", { count: "exact", head: true })
      .eq("approval_status", "pending"),
    countPendingReports(),
    countUnackedAlerts(),
  ]);

  return {
    "/admin/tutores": tutores ?? 0,
    "/admin/reportes": reportes,
    "/admin/alertas": alertas,
  };
});
