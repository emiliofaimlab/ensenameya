import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PanelCard } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Interruptores, type MetodoRow } from "./interruptores";

export const metadata = { title: "Métodos de cobro · Enséñame Ya" };

/**
 * Qué métodos de cobro se le ofrecen al tutor — encender y apagar tarjetas.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * El interruptor lleva en la base desde el 2-sep: `payout_manual_channels`
 * .is_active, con su `comment on column` diciendo «apagar un canal es un
 * UPDATE, no una migración». Funciona de verdad —`metodosDelPais` construye las
 * tarjetas recorriendo los canales activos, así que uno apagado desaparece— y
 * sin embargo apagarlo exigía entrar a la base. Esto es esa puerta.
 *
 * El caso que lo pidió es PayPal (su app de producción sigue pendiente de
 * aprobación y el botón «Conectar» lleva a un error, para cualquier tutor), y
 * el que ya estaba previsto es Binance («solo a petición», con el tema de la
 * licencia de transmisión de dinero en `docs/PAGOS-Y-PAYOUTS.md` §4). Los dos
 * se resuelven ahora con una casilla.
 *
 * ── LO QUE ESTA PANTALLA NO PUEDE APAGAR, Y ES A PROPÓSITO ──────────────────
 *
 * **Transferencia bancaria.** No es un canal de esta tabla: es la familia
 * `banco` del ruteo, la que alcanza los 55 países por Wise, dLocal y Stripe y
 * la ÚNICA automática en casi todos. Apagarla no sería esconder una tarjeta,
 * sería dejar sin forma de cobrar a todos los tutores menos los venezolanos. Si
 * algún día hay que quitarla de un país, eso es tocar `payment_routing_rules`,
 * o sea una migración (regla de oro 5), no una casilla.
 *
 * ⚠️ No lleva `loading.tsx` propio: `(app)/admin/loading.tsx` cubre todo lo que
 * cuelga de `/admin/*`.
 */
export default async function AdminMetodosDeCobroPage() {
  await requireRole("admin");
  const supabase = await createClient();

  // Con la sesión del admin, no con `service_role`: la política
  // `payout_manual_channels_select_auth` deja leer el catálogo entero a
  // cualquier autenticado, así que aquí la clave de servicio no aportaría nada.
  const { data, error } = await supabase
    .from("payout_manual_channels")
    .select("channel, label, help, is_active, sort_order")
    .order("sort_order");

  // Regla de oro 10: sin mirar el `error`, un fallo de lectura se pintaría como
  // «no hay métodos», que en esta pantalla se lee como «están todos apagados» —
  // exactamente la mentira que haría ir a tocar la base.
  const metodos: MetodoRow[] = error ? [] : (data ?? []);

  return (
    <AdminShell
      title="Métodos de cobro"
      description="Qué tarjetas ve el tutor en «Mis cuentas». Apagar una no borra nada: deja de ofrecerse."
    >
      {error ? (
        <PanelCard className="border-[1.5px] border-[#f0bfbf] bg-[#fff8f8]">
          <p className="text-[13px] text-[#404040]">
            No se pudo leer el catálogo de métodos: {error.message}
          </p>
        </PanelCard>
      ) : (
        <Interruptores metodos={metodos} />
      )}

      <PanelCard className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-[#19191f]">
          Qué pasa al apagar uno
        </h2>
        <ul className="flex flex-col gap-2 text-[13px] leading-[1.6] text-[#404040]">
          <li>
            La tarjeta <strong>deja de aparecer</strong> en «Mis cuentas» del
            tutor, en los países donde el ruteo la ofrecía.
          </li>
          <li>
            <strong>No se borra nada.</strong> Los tutores que ya tuvieran ese
            destino guardado lo conservan, y si el método vuelve a encenderse
            sigue ahí tal cual.
          </li>
          <li>
            Los <strong>pagos ya programados</strong> por ese método no se
            cancelan: esto decide qué se ofrece de aquí en adelante, no lo que
            ya estaba en marcha.
          </li>
          <li>
            <strong>Transferencia bancaria no está en esta lista</strong>, y no
            es un olvido: es la única vía automática en casi todos los países.
            Quitarla es cambiar el ruteo, no esconder una tarjeta.
          </li>
        </ul>
      </PanelCard>
    </AdminShell>
  );
}
