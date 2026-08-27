import Link from "next/link";

import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PanelCard } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { ExpireForm } from "./expire-form";

export const metadata = { title: "Operaciones · Enséñame Ya" };

/**
 * RV-20 · SCR-AD18 — vencer reservas caducadas a mano.
 *
 * POR QUÉ ESTA PANTALLA EXISTE. El camino "el tutor no contesta en 24 h → la
 * reserva se cancela y el alumno recibe el 100 %" (RN-38) es de los que más
 * importa poder verificar, y no se podía verificar sin esperar un día entero.
 * La capacidad estaba: `expire_stale_bookings` recibe los dos plazos como
 * parámetros con default *precisamente* para poder probar el timeout sin
 * esperar. Lo que se perdió fue el acceso — `20260715150000` le quitó el
 * `execute` a `authenticated` porque cualquier autenticado podía vencer y
 * "reembolsar" las reservas pendientes de toda la plataforma.
 *
 * Lo que se recupera aquí es el acceso, no el grant: la función sigue siendo de
 * `service_role` y la llama el Route Handler `/api/admin/expirar-reservas`,
 * que revalida el rol en el servidor. Ver el porqué completo en ese archivo.
 *
 * POR QUÉ NO ESTÁ EN /admin/reembolsos, que es donde se ve el efecto: mezclar
 * un botón destructivo con una pantalla de consulta es cómo se pulsa sin
 * querer. Desde allí se llega por enlace, y desde aquí se vuelve con el
 * resultado en la mano.
 */
export default async function AdminOperacionesPage() {
  await requireRole("admin");
  const supabase = await createClient();

  // Cuántas hay en cada estado AHORA, sin filtrar por plazo: el contexto de
  // "sobre qué universo actúa esto". El recorte por antigüedad lo hace la
  // vista previa del formulario, que es la que sí aplica los cutoffs.
  const [{ count: sinPagar }, { count: sinAceptar }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_payment"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_acceptance"),
  ]);

  return (
    <AdminShell
      title="Operaciones"
      description="Vencer reservas caducadas a mano (RV-20). Es la única acción destructiva del panel."
    >
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Qué hace exactamente
        </h2>
        <p className="text-[13px] text-[#404040]">
          Ejecuta <code className="font-mono text-xs">expire_stale_bookings</code>,
          la misma función que el cron de la base de datos corre cada minuto.
          Recorre <strong>todas las reservas de la plataforma</strong> —no una
          selección— y hace dos cosas distintas:
        </p>
        <ul className="flex flex-col gap-2 text-[13px] text-[#404040]">
          <li className="rounded-[8px] border border-[#e0e0e0] p-3">
            <strong>Reservas sin pagar</strong> más viejas que el plazo de pago:
            se marca el cobro como fallido, se cancela la reserva y se libera el
            horario. <em>No hay reembolso</em>: nunca se llegó a cobrar.{" "}
            <span className="text-[#6b6b6b]">
              Ahora mismo hay {sinPagar ?? 0} en ese estado (sin mirar
              antigüedad).
            </span>
          </li>
          <li className="rounded-[8px] border border-[#e8b4b4] bg-[#fdf0f0] p-3">
            <strong>Reservas pagadas esperando al tutor</strong> más viejas que
            el plazo de aceptación: se cancelan y se{" "}
            <strong>encola el reembolso del 100 %</strong> (RN-38), que sale de
            verdad contra el PSP cuando corra el job. Al alumno le llega el
            aviso de cancelación.{" "}
            <span className="text-[#8f2b2b]">
              Ahora mismo hay {sinAceptar ?? 0} en ese estado (sin mirar
              antigüedad).
            </span>
          </li>
        </ul>
        <p className="text-[13px] text-[#6b6b6b]">
          Los reembolsos que genere aparecen en{" "}
          <Link
            href="/admin/reembolsos"
            className="font-semibold text-brand hover:underline"
          >
            la cola de reembolsos
          </Link>
          , encolados. Encolar no es pagar: el dinero sale cuando corra{" "}
          <code className="font-mono text-xs">/api/cron/refunds-process</code>.
        </p>
      </PanelCard>

      <ExpireForm />

      <p className="text-xs text-[#6b6b6b]">
        Con los plazos reales (24 h y 7 min) esto no hace nada que el cron no
        vaya a hacer solo en el próximo minuto: sirve para no esperar. Los
        plazos cortos existen para verificar el camino completo —cancelación,
        aviso y reembolso— sin tener que dejar pasar un día.
      </p>
    </AdminShell>
  );
}
