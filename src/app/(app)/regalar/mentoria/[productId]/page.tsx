import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClockIcon, HourglassIcon, VideoIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import { getProductDetail } from "@/lib/catalog/queries";
import { priceDisplay, sessionsLabel } from "@/lib/catalog/format";
import { ProductCover } from "@/components/catalog/product-cover";
import { Precio } from "@/components/precio/precio";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { diasParaAgendar } from "../../gift-policy";
import { FormularioDeRegalo } from "./formulario-de-regalo";

export const metadata = { title: "Confirmar el regalo · Enséñame Ya" };

/**
 * US-REG · PASO 2 — **A QUIÉN VA Y CON QUÉ DEDICATORIA.**
 *
 * Es la pantalla de confirmar el regalo: se ve exactamente qué se regala, por
 * cuánto, y se dice a qué correo va. No cobra nada — al enviar, el formulario
 * llama a `comprar_regalo` y de ahí se sale al pago, que vive aislado en
 * `(checkout)` (`/regalar/<creditId>/pagar`, N-37).
 *
 * ⚠️ **AQUÍ NO SE ELIGE HORARIO, Y LA PANTALLA LO DICE.** Es la diferencia
 * entera con `/reservar/<productId>`: un regalo no bloquea el hueco de nadie —
 * `comprar_regalo` no crea `bookings` ni `sessions` y lo deja escrito en su
 * propio cuerpo—, así que no hay calendario, no hay retención y no hay contador.
 * Quien recibe agenda después, por el camino normal.
 *
 * ⚠️ **EL PRECIO QUE SE PINTA NO ES EL QUE SE COBRA, Y ES CORRECTO ASÍ.** Aquí
 * se enseña `priceDisplay(product)` —el mismo total que anuncia el catálogo—
 * pero quien congela el importe es la RPC, en servidor, con la misma aritmética
 * que `create_booking_line` (regla de oro 2). Del navegador no viaja ni una
 * cifra: `comprar_regalo` recibe el producto, el correo y la dedicatoria, y
 * nada más.
 *
 * ⚠️ **EL CORREO DEL DESTINATARIO NO SE COMPRUEBA CONTRA NADA**, ni aquí ni en
 * la RPC. Decir «esa dirección no tiene cuenta» —o no decirlo— convertiría esta
 * pantalla en un oráculo gratis de existencia de cuentas para cualquier
 * dirección del mundo, y `profiles` es own-only precisamente para que eso no se
 * pueda preguntar. Lo resuelve `confirm_gift_payment`, después de cobrar, que
 * es lo que le pone precio a la pregunta.
 */
export default async function ConfirmarRegaloPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const [{ productId }, { user, roles }] = await Promise.all([
    params,
    requireUser(),
  ]);

  // `getProductDetail` solo devuelve mentorías regalables por las mismas
  // razones por las que son reservables: `status = 'active'` y tutor aprobado,
  // que es lo mismo que revalida `comprar_regalo` antes de crear nada.
  const [product, dias, menu] = await Promise.all([
    getProductDetail(productId),
    diasParaAgendar(),
    panelMenu(user.id, roles),
  ]);
  if (!product) notFound();

  const precio = priceDisplay(product);
  /**
   * ⚠️ LA RPC LO RECHAZA IGUAL («no puedes regalar tu propia mentoría»), y aun
   * así se comprueba aquí: un tutor que llega a su propia ficha desde el
   * catálogo merece leerlo ANTES de escribir el correo de un amigo y una
   * dedicatoria que se van a perder al enviar. El servidor sigue siendo quien
   * decide; esto solo evita el callejón.
   */
  const esMia = product.tutor.id === user.id;

  /**
   * ⚠️ SIN TOTAL CERRADO NO SE PUEDE REGALAR, Y HAY QUE DECIRLO ANTES.
   *
   * `priceDisplay().isTotal` es falso en un solo caso: mentoría `per_hour` SIN
   * `session_duration_min` (la columna es NULLABLE, `20260706120000`). Ahí lo
   * que se anuncia es la TARIFA, no un total — y `comprar_regalo` calcula
   * `round(price_amount * session_duration_min / 60)`, que con la duración a
   * null da null y revienta contra el `not null` de `credits.amount`.
   *
   * O sea que el camino existe y termina en un error opaco DESPUÉS de teclear
   * el correo y la dedicatoria. Se corta aquí, con su motivo: un regalo se paga
   * por adelantado y por el precio íntegro, y eso exige saber cuál es.
   */
  const sinTotal = !precio.isTotal;

  return (
    <PanelShell
      items={menu.items}
      badges={menu.badges}
      back={{ href: "/regalar", label: "Volver a elegir mentoría" }}
      eyebrow="Regalar / Confirmar"
      title="Confirmar el regalo"
      description="Revisa qué regalas y dinos a quién se lo mandamos."
    >
      <div className="grid items-start gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* ── Qué se regala ────────────────────────────────────────────────
            Misma forma que el «Resumen del pedido» de las tres pantallas de
            pago: la columna estrecha a la izquierda dice qué se lleva, la ancha
            a la derecha es donde se actúa. */}
        <PanelCard className="sm:p-6">
          <PanelCardTitle className="text-[17px]">Tu regalo</PanelCardTitle>

          <div className="mt-4 overflow-hidden rounded-[12px]">
            <ProductCover
              product={product}
              width={352}
              height={140}
              className="h-[140px]"
            />
          </div>

          <p className="mt-3.5 text-[15px] font-semibold text-balance text-[#19191f]">
            {product.title}
          </p>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            con {product.tutor.displayName ?? product.tutor.headline ?? "tu tutor"}
          </p>

          <ul className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-[#4d4d4d]">
            <li className="flex items-center gap-1.5 whitespace-nowrap">
              <VideoIcon className="size-3.5 shrink-0 text-brand" aria-hidden />
              En vivo 1 a 1
            </li>
            {/* `sessionsLabel` escribe «4 × 60 min» en paquetes y «1 × 60 min»
                en sueltas; para una sola sesión la tarjeta del catálogo prefiere
                «60 min» a secas, y aquí por lo mismo. */}
            {(product.packageNumSessions ?? 1) > 1 ? (
              <li className="whitespace-nowrap">{sessionsLabel(product)}</li>
            ) : product.sessionDurationMin ? (
              <li className="whitespace-nowrap">{product.sessionDurationMin} min</li>
            ) : null}
          </ul>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-4">
            <span className="text-base font-semibold text-[#19191f]">Total</span>
            <span className="text-right">
              <Precio
                amountMinor={precio.amountMinor}
                currency={product.currency}
                nota={precio.note}
                className="text-[26px] leading-none font-bold text-brand"
                notaClassName="mt-1 text-xs text-[#666666]"
              />
            </span>
          </div>

          {/* Las dos cosas que hacen que un regalo NO sea una reserva. Se
              repiten aquí aunque ya estén en `/regalar` porque a esta pantalla
              se puede llegar directa (un enlace guardado, un «atrás») y porque
              es la última antes de crear la fila del dinero. */}
          <ul className="mt-4 flex flex-col gap-2 border-t border-[#e0e0e0] pt-4 text-[12.5px] text-[#595959]">
            <li className="flex items-start gap-2">
              <CalendarClockIcon
                className="mt-0.5 size-3.5 shrink-0 text-brand"
                aria-hidden
              />
              <span>
                El día y la hora los elige quien lo recibe. Tú no reservas ningún
                horario ahora.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <HourglassIcon
                className="mt-0.5 size-3.5 shrink-0 text-brand"
                aria-hidden
              />
              <span>
                {dias === null
                  ? "El regalo caduca si no se agenda; le avisamos por correo antes de que venza."
                  : `Tiene ${dias} días para agendarlo desde que se cobra. Le avisamos por correo antes de que venza.`}
              </span>
            </li>
          </ul>
        </PanelCard>

        {/* ── A quién va ──────────────────────────────────────────────────── */}
        <PanelCard>
          <PanelCardTitle className="text-[17px]">Para quién es</PanelCardTitle>

          {esMia || sinTotal ? (
            <div className="mt-3.5 rounded-xl border border-dashed border-[#e0e0e0] p-5">
              <p role="alert" className="text-[13px] text-[#595959]">
                {esMia
                  ? "Esta mentoría es tuya: no puedes regalártela. Elige la de otro tutor y te llevamos de vuelta aquí."
                  : "Esta mentoría se cobra por hora y todavía no tiene una duración declarada, así que no podemos cerrar el precio del regalo. Elige otra o pídesela a su tutor como reserva normal."}
              </p>
              <Button asChild variant="outline" className="mt-3.5 h-11 rounded-[10px]">
                <Link href="/regalar">Elegir otra mentoría</Link>
              </Button>
            </div>
          ) : (
            <FormularioDeRegalo
              productId={product.id}
              dias={dias}
              className="mt-3.5"
            />
          )}
        </PanelCard>
      </div>
    </PanelShell>
  );
}
