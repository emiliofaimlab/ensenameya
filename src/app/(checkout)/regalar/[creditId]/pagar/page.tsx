import Link from "next/link";
import { notFound } from "next/navigation";
import { GiftIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/lib/catalog/queries";
import { Precio } from "@/components/precio/precio";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { diasParaAgendar } from "@/app/(app)/regalar/gift-policy";
import { PagoDelRegalo } from "./pago-del-regalo";

export const metadata = { title: "Confirmar pago · Enséñame Ya" };

/**
 * US-REG · **EL COBRO DEL REGALO** — la cuarta pantalla donde se cobra.
 *
 * N-37 · cuelga de `(checkout)` y no de `(app)`, igual que sus tres hermanas
 * (`/reservar/<id>/checkout`, `/reservas/<id>/pagar`, `/pedidos/<id>/pagar`):
 * sin cabecera, sin menú, sin pie y sin chat. El porqué —y la trampa de los
 * layouts anidados que obliga a que sea un grupo de rutas en la RAÍZ y no un
 * `layout.tsx` dentro de `(app)`— está en `src/app/(checkout)/layout.tsx`.
 * Aislar tres de los cuatro sitios donde se cobra y dejar el cuarto con ocho
 * salidas alrededor sería tener dos experiencias de pago para el mismo dinero.
 *
 * ⚠️ **ESTA PANTALLA NO CREA NADA.** Cuando se llega aquí, `comprar_regalo` ya
 * corrió desde `/regalar/mentoria/<productId>`: existe la fila de `credits` en
 * `pending_payment`, con el importe congelado en servidor y el riel elegido por
 * el país del comprador. Aquí solo se ABRE el cobro, que es lo mismo que hace
 * `order-payment.tsx` con un pedido.
 *
 * ⚠️ **Y NO HAY HORARIO, NI RETENCIÓN, NI CONTADOR.** Es la diferencia con las
 * otras tres: un regalo no bloquea el hueco de nadie, así que no hay nada que
 * se pueda perder mientras se rellena la tarjeta y `HoldCountdown` no pinta
 * nada aquí. Lo que sí caduca es el regalo SIN PAGAR, a los 30 días, y lo barre
 * `caducar_creditos()`; eso no es un reloj de esta pantalla.
 *
 * ⚠️ **LA AUTORIZACIÓN ES LA RLS, NO UN `if` DE ESTE FICHERO.** El regalo se
 * lee por `mis_regalos_comprados`, que filtra por `purchased_by = auth.uid()`
 * (`security_invoker`, hereda `credits_select_comprador`): el regalo de otra
 * persona sencillamente no aparece, y aquí eso ya es un 404. Se lee por la
 * VISTA y no por la tabla a propósito — `credits` tiene `grant select` POR
 * COLUMNAS y un `.select("*")` sobre ella responde `permission denied`.
 *
 * ⚠️ **UN REGALO YA PAGADO NO REDIRIGE: SE EXPLICA Y SE ENLAZA.** Las hermanas
 * hacen `redirect()` a su confirmación, y aquí se llega por navegación de
 * CLIENTE desde `(app)` —`router.push` del formulario, el botón «Pagar» de «Mis
 * regalos»—, que es exactamente la combinación de la regla de oro 13: un
 * `redirect()` de servidor alcanzado cruzando de grupo de rutas deja la
 * pantalla EN BLANCO y el RSC pedido en bucle (medido: 1367 peticiones en 5
 * segundos). Pintar el desenlace en su sitio cuesta diez líneas y no tiene esa
 * forma de fallo.
 *
 * ⚠️ Y la URL de esta pantalla también es un contrato: `/api/pagos/checkout`
 * comparte prefijo con ella al componer el `returnPath` del cobro
 * (`/regalar/<creditId>/confirmacion`). Las dos viven bajo `/regalar/<creditId>`
 * —el crédito, no el producto— mientras que elegir a quién se le regala vive
 * bajo `/regalar/mentoria/<productId>`. No es cosmético: dos segmentos
 * dinámicos con NOMBRES distintos en la misma posición de la ruta hacen que
 * Next se niegue a compilar, así que el nombre `[creditId]` de aquí y el de la
 * confirmación tienen que seguir siendo el mismo.
 */
export default async function PagarRegaloPage({
  params,
}: {
  params: Promise<{ creditId: string }>;
}) {
  const [{ creditId }] = await Promise.all([params, requireUser()]);

  const supabase = await createClient();

  // Se mira el `error` además del `data` (regla de oro 10): un `const { data }`
  // convertiría un fallo de la consulta en «ese regalo no existe», que es un 404
  // mentiroso sobre un regalo que sí es tuyo y que estás a punto de pagar.
  const { data: regalo, error } = await supabase
    .from("mis_regalos_comprados")
    .select("id, status, amount, currency, product_id, beneficiary_email, gift_message")
    .eq("id", creditId)
    .maybeSingle();

  if (error) {
    console.error("[regalar/pagar] no se pudo leer el regalo:", {
      regalo: creditId,
      error: error.message,
    });
    throw new Error("No pudimos comprobar tu regalo. Vuelve a intentarlo.");
  }
  if (!regalo) notFound();

  const [producto, dias] = await Promise.all([
    // Puede devolver `null` si la mentoría se despublicó entre el regalo y el
    // pago. No se bloquea el cobro por eso —el crédito sigue atado a su
    // `product_id` y el precio ya está congelado—, pero el resumen dice lo que
    // sabe y no se inventa un título.
    regalo.product_id ? getProductDetail(regalo.product_id) : Promise.resolve(null),
    diasParaAgendar(),
  ]);

  const pagable = regalo.status === "pending_payment";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/regalar/mis-regalos"
          className="mb-4 flex w-fit items-center gap-1.5 text-sm text-[#6b6b6b] transition-colors hover:text-foreground"
        >
          Volver a mis regalos
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Confirmar pago
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Estás pagando una mentoría de regalo. El cobro lo procesa nuestro
          proveedor de pagos.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <PanelCard className="sm:p-6">
          <PanelCardTitle className="flex items-center gap-2 text-[17px]">
            <GiftIcon className="size-[17px] shrink-0 text-brand" aria-hidden />
            Tu regalo
          </PanelCardTitle>

          {/* Con `ui_mode: 'form'` Stripe pinta SOLO los campos de la tarjeta
              (MN-01), así que este resumen es el ÚNICO sitio donde se dice qué se
              está comprando. Si alguien lo quita, se paga a ciegas. */}
          <p className="mt-4 text-[15px] font-semibold text-balance text-[#19191f]">
            {producto?.title ?? "Mentoría de regalo"}
          </p>
          {producto ? (
            <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
              con{" "}
              {producto.tutor.displayName ?? producto.tutor.headline ?? "tu tutor"}
              {producto.sessionDurationMin
                ? ` · ${producto.sessionDurationMin} min`
                : ""}
            </p>
          ) : null}

          <dl className="mt-4 flex flex-col gap-2 border-t border-[#e0e0e0] pt-4 text-[13px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-[#6b6b6b]">Para</dt>
              {/* El correo tal cual se tecleó (ya normalizado por la RPC). NO se
                  dice si tiene cuenta: eso es un oráculo de existencia, y por eso
                  la vista ni siquiera expone `beneficiary_id`. */}
              <dd className="min-w-0 truncate font-medium text-[#333333]">
                {regalo.beneficiary_email ?? "—"}
              </dd>
            </div>
          </dl>

          {regalo.gift_message ? (
            <blockquote className="mt-3 rounded-[10px] bg-muted px-3.5 py-3 text-[12.5px] text-pretty text-[#595959]">
              «{regalo.gift_message}»
            </blockquote>
          ) : null}

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-4">
            <span className="text-base font-semibold text-[#19191f]">Total</span>
            <span className="text-right">
              {/* El importe viene de `credits.amount`, que congeló la RPC. Se
                  pinta para que se vea qué se paga; quien decide lo que se cobra
                  es el Route Handler leyendo esa MISMA columna (regla de oro 2). */}
              <Precio
                amountMinor={regalo.amount ?? 0}
                currency={regalo.currency ?? "USD"}
                className="text-[26px] leading-none font-bold text-brand"
                notaClassName="mt-1"
              />
            </span>
          </div>

          <p className="mt-4 border-t border-[#e0e0e0] pt-4 text-[12.5px] text-pretty text-[#595959]">
            Quien lo reciba elige el día y la hora con ese tutor.{" "}
            {dias === null
              ? "El regalo tiene un plazo para agendarse"
              : `Tiene ${dias} días para agendarlo`}{" "}
            desde que confirmemos este pago, y le avisamos por correo antes de
            que venza.
          </p>
        </PanelCard>

        <PanelCard>
          <PanelCardTitle className="text-[15px]">Método de pago</PanelCardTitle>

          {pagable ? (
            <PagoDelRegalo
              creditId={regalo.id!}
              total={regalo.amount ?? 0}
              currency={regalo.currency ?? "USD"}
            />
          ) : (
            /* Ni `redirect()` ni 404: aquí se llega por navegación de cliente
               desde `(app)` y un rebote de servidor cruzando de grupo deja la
               pantalla en blanco (regla de oro 13). Se cuenta el desenlace y se
               ofrece la salida. */
            <div className="mt-3.5 rounded-xl border border-dashed border-[#e0e0e0] p-5">
              <p role="alert" className="text-[13px] text-[#595959]">
                {regalo.status === "active" || regalo.status === "consumed"
                  ? "Este regalo ya está pagado."
                  : "Este regalo ya no se puede pagar. Revísalo en «Mis regalos» y, si quieres, empieza uno nuevo."}
              </p>
              {/* Al ya pagado se le lleva a SU confirmación —que es donde se
                  cuenta qué pasa ahora— y al resto a la lista, que es donde se
                  ve por qué dejó de ser pagable. El comentario va FUERA del
                  `Button`: con `asChild`, Radix exige un único hijo. */}
              <Button asChild variant="outline" className="mt-3.5 h-11 rounded-[10px]">
                <Link
                  href={
                    regalo.status === "active" || regalo.status === "consumed"
                      ? `/regalar/${regalo.id}/confirmacion`
                      : "/regalar/mis-regalos"
                  }
                >
                  {regalo.status === "active" || regalo.status === "consumed"
                    ? "Ver el regalo"
                    : "Ir a mis regalos"}
                </Link>
              </Button>
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}
