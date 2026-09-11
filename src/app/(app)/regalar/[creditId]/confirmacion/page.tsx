import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckIcon, ClockIcon, GiftIcon, MailIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { Precio } from "@/components/precio/precio";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { COMPANY } from "@/lib/company";
import { diasParaAgendar } from "../../gift-policy";

export const metadata = { title: "Regalo confirmado · Enséñame Ya" };

/**
 * US-REG · **DONDE ATERRIZA LA PASARELA DESPUÉS DE COBRAR EL REGALO.**
 *
 * 🔴 ESTA RUTA ES UN CONTRATO, NO UNA PANTALLA CUALQUIERA. La URL la fija
 * `/api/pagos/checkout` en el `returnPath` del cobro del regalo
 * (`/regalar/<creditId>/confirmacion`), y es a donde Stripe y dLocal mandan a la
 * persona en cuanto paga. Si se renombra aquí sin renombrarla allí, quien pague
 * un regalo acaba en un 404 con el dinero ya cobrado. Ver la cabecera de
 * `cobroDeRegalo` en ese fichero.
 *
 * ⚠️ **SE PUEDE LLEGAR ANTES QUE EL WEBHOOK, Y SE DICE.** La pasarela redirige
 * en cuanto cobra; quien activa el regalo es `confirm_gift_payment` desde el
 * webhook, que llega por otro camino y a su ritmo. Mientras el crédito siga en
 * `pending_payment` esta pantalla NO dice «listo»: dice que se está
 * confirmando. Es el mismo criterio que `/reservas/<id>/confirmacion`, y por el
 * mismo motivo — prometer algo que todavía no ha pasado es peor que esperar.
 *
 * ⚠️ **Y NO CONFIRMA NADA.** Aquí no se llama a ninguna RPC: el dinero lo mueven
 * el webhook y las funciones `service_role`. Esta pantalla solo LEE
 * `mis_regalos_comprados`, que además es quien autoriza (filtra por
 * `purchased_by = auth.uid()`): el regalo de otra persona no aparece y eso ya
 * es un 404.
 *
 * ⚠️ **SIN `redirect()`, A PROPÓSITO.** A esta URL se llega desde fuera del
 * sitio (la pasarela) y también por navegación de cliente desde `(app)`; un
 * rebote de servidor en el segundo caso deja la pantalla EN BLANCO con el RSC
 * pedido en bucle (regla de oro 13). Los tres desenlaces se pintan en su sitio.
 */
export default async function ConfirmacionDelRegaloPage({
  params,
}: {
  params: Promise<{ creditId: string }>;
}) {
  const [{ creditId }, { user, roles }, tz] = await Promise.all([
    params,
    requireUser(),
    getUserTimezone(),
  ]);

  const supabase = await createClient();

  // Se mira el `error` además del `data` (regla de oro 10): convertir un fallo
  // de consulta en «ese regalo no existe» sería un 404 mentiroso justo después
  // de cobrar, que es el peor momento posible para uno.
  const { data: regalo, error } = await supabase
    .from("mis_regalos_comprados")
    .select("id, status, amount, currency, product_id, beneficiary_email, expires_at")
    .eq("id", creditId)
    .maybeSingle();

  if (error) {
    console.error("[regalar/confirmacion] no se pudo leer el regalo:", {
      regalo: creditId,
      error: error.message,
    });
    throw new Error("No pudimos comprobar tu regalo. Recarga la página.");
  }
  if (!regalo) notFound();

  const [producto, dias, menu] = await Promise.all([
    regalo.product_id ? getProductDetail(regalo.product_id) : Promise.resolve(null),
    diasParaAgendar(),
    panelMenu(user.id, roles),
  ]);

  /** Todavía sin activar: la pasarela ya cobró pero el webhook no ha llegado. */
  const pagoPendiente = regalo.status === "pending_payment";
  /** Activo (o ya canjeado): el regalo existe y su destinatario puede usarlo. */
  const listo = regalo.status === "active" || regalo.status === "consumed";

  const vence =
    regalo.status === "active" && regalo.expires_at
      ? new Date(regalo.expires_at).toLocaleDateString("es", {
          day: "numeric",
          month: "short",
          year: "numeric",
          // Sin `timeZone` explícito el SSR usa la del servidor (UTC en Vercel)
          // y la fecha puede saltar un día (RN-01 / RN-02).
          timeZone: tz,
        })
      : null;

  return (
    <PanelShell items={menu.items} badges={menu.badges}>
      <PanelCard className="mx-auto w-full max-w-[620px] sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span
            className={`grid size-14 place-items-center rounded-full ${
              listo ? "bg-[#d9f0de] text-[#1f7043]" : "bg-[#faedcc] text-[#805710]"
            }`}
          >
            {listo ? (
              <CheckIcon className="size-7" aria-hidden />
            ) : (
              <ClockIcon className="size-7" aria-hidden />
            )}
          </span>

          <PanelCardTitle className="mt-4 text-[24px]">
            {listo
              ? "Tu regalo está listo"
              : pagoPendiente
                ? "Estamos confirmando tu pago"
                : "Este regalo ya no está activo"}
          </PanelCardTitle>

          <p className="mt-2 text-[13px] text-pretty text-[#6b6b6b]">
            {listo ? (
              <>
                Ya avisamos a{" "}
                <span className="font-medium text-[#333333]">
                  {regalo.beneficiary_email}
                </span>
                . Le aparece en «Mis reservas» y elige el día y la hora con su
                tutor.
              </>
            ) : pagoPendiente ? (
              <>
                El cobro se hizo, pero la confirmación llega por otro camino y
                puede tardar un momento. Recarga esta página en unos segundos; si
                dentro de un rato sigue igual, escríbenos a {COMPANY.email}.
              </>
            ) : (
              <>
                Míralo en «Mis regalos» para ver qué pasó con él. Si crees que es
                un error, escríbenos a {COMPANY.email}.
              </>
            )}
          </p>
        </div>

        <div className="mt-6 rounded-[12px] bg-muted p-4">
          <p className="flex items-start gap-2 text-[15px] font-semibold text-balance text-[#19191f]">
            <GiftIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            {producto?.title ?? "Mentoría de regalo"}
          </p>
          {producto ? (
            <p className="mt-0.5 pl-6 text-[13px] text-[#6b6b6b]">
              con{" "}
              {producto.tutor.displayName ?? producto.tutor.headline ?? "su tutor"}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-3">
            <span className="text-[13px] text-[#6b6b6b]">Pagado</span>
            <span className="text-right">
              <Precio
                amountMinor={regalo.amount ?? 0}
                currency={regalo.currency ?? "USD"}
                className="text-[19px] leading-none font-bold text-[#19191f]"
                notaClassName="mt-1 text-[11px] text-[#666666]"
              />
            </span>
          </div>
        </div>

        {/* El plazo solo se promete cuando YA es de verdad: en `active`,
            `expires_at` es la caducidad que escribió `confirm_gift_payment` con
            `gift_expiry_days()`. Mientras el pago esté pendiente, esa columna
            todavía guarda el plazo de ABANDONO del cobro (30 días) y enseñarlo
            aquí sería prometer una validez que aún no existe. */}
        {listo ? (
          <ul className="mt-5 flex flex-col gap-2.5 text-[13px] text-[#4b4b4b]">
            <li className="flex items-start gap-2">
              <MailIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              Le escribimos a su correo con el regalo y tu dedicatoria.
            </li>
            <li className="flex items-start gap-2">
              <ClockIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              {vence
                ? `Tiene hasta el ${vence} para agendarlo${dias === null ? "" : ` (${dias} días)`}. Le avisamos antes de que venza.`
                : "Tiene un plazo para agendarlo y le avisamos antes de que venza; la fecha exacta está en «Mis regalos»."}
            </li>
          </ul>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild className="h-11 rounded-[10px] px-5 font-semibold">
            <Link href="/regalar/mis-regalos">Ver mis regalos</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-[10px] px-5">
            <Link href="/regalar">Regalar otra mentoría</Link>
          </Button>
        </div>
      </PanelCard>
    </PanelShell>
  );
}
