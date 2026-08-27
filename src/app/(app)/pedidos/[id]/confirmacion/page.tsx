import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, CheckCircle2Icon, ClockIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { resolveOrder, type LineaResuelta } from "@/lib/orders/queries";
import { cartLineKey } from "@/lib/cart/cookie";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime } from "@/lib/booking";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { PruneBought } from "@/components/cart/cart-actions";

export const metadata = { title: "Pedido confirmado · Enséñame Ya" };

/**
 * EY-176 · adonde devuelve la pasarela cuando se paga un pedido — el
 * `return_url` de la Session (`/api/pagos/checkout`).
 *
 * ⚠️ NO CONFIRMA NADA, igual que su hermana de una sola reserva. El cobro lo
 * acredita el webhook llamando a `confirm_order_payment`, y puede llegar
 * después de que la persona vea esta pantalla: por eso el caso «todavía
 * estamos confirmando» no es un borde, es lo normal durante un par de segundos.
 * Si esta página escribiera algo, el navegador estaría confirmando pagos.
 *
 * ⚠️ Y AQUÍ ES DONDE SE VE QUE LA ACEPTACIÓN ES POR MENTORÍA, NO POR PEDIDO
 * (M-02). `auto_accept_bookings` vive en `products`, así que un pedido de tres
 * puede quedar con una `confirmed` y dos `pending_acceptance`, cada una con su
 * ventana de 24 h de RN-38. Se cuenta línea a línea en vez de resumirlo en una
 * frase, porque resumirlo obligaría a mentir en una de las dos direcciones.
 */
export default async function ConfirmacionPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();

  const [pedido, tz] = await Promise.all([resolveOrder(id), getUserTimezone()]);
  if (!pedido) notFound();

  const sinResolver = pedido.order.status === "pending_payment";
  const tumbado = pedido.order.status === "cancelled";
  const pagado = pedido.order.status === "paid";

  return (
    <Container>
      <Section className="max-w-[760px] py-8 sm:py-10">
        {/* ⚠️ EL CARRITO SE LIMPIA AQUÍ, y si no, miente hasta la próxima
            visita a `/carrito`. La cookie no la puede tocar el servidor desde
            un render, así que la decisión (qué líneas se compraron) la toma él
            —recomponiendo la MISMA clave que escribió `cartLineKey`— y la
            ejecuta el navegador. La clave se rehace desde los instantes de las
            sesiones, no desde texto ISO: es la trampa de `…T08:00:00.000Z` vs
            `…T08:00:00+00:00` que documenta `lib/cart/cookie.ts`. */}
        {/* ⚠️ SOLO SI SE PAGÓ. Si el cargo se cayó, los horarios volvieron a
            estar libres y esas líneas siguen siendo comprables: vaciarle el
            carrito a quien acaba de ver «el pago no se completó» le borraría
            justo lo que tiene que reintentar. Y si todavía no se ha resuelto
            tampoco se toca, porque aún no hay nada comprado. */}
        <PruneBought keys={pagado ? clavesDelCarrito(pedido.lineas) : []} />

        <span
          className={`grid size-12 place-items-center rounded-full ${
            tumbado ? "bg-muted" : "bg-success-muted"
          }`}
        >
          {sinResolver ? (
            <ClockIcon className="size-6 text-[#6b6b6b]" />
          ) : (
            <CheckCircle2Icon className={`size-6 ${tumbado ? "text-[#6b6b6b]" : "text-success"}`} />
          )}
        </span>

        <h1 className="mt-4 text-[28px] font-bold tracking-tight text-[#19191f]">
          {sinResolver
            ? "Estamos confirmando tu pago"
            : tumbado
              ? "El pago no se completó"
              : "¡Pedido confirmado!"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[#6b6b6b]">
          {sinResolver
            ? "Tu pago está en camino. En cuanto el proveedor lo confirme, verás aquí tus mentorías agendadas."
            : tumbado
              ? "No se cobró nada y los horarios se liberaron. Puedes volver a intentarlo desde el carrito."
              : "Se cobró una sola vez por todas las mentorías. Cada tutor confirma la suya por separado: si alguno no responde en 24 horas, esa mentoría se te devuelve al 100 %."}
        </p>

        <PanelCard className="mt-6">
          <PanelCardTitle className="text-[17px]">Resumen del pedido</PanelCardTitle>

          <ul className="mt-4 flex flex-col gap-4">
            {pedido.lineas.map((l) => (
              <li
                key={l.bookingId}
                className="border-t border-[#e0e0e0] pt-4 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-balance text-[#19191f]">
                      {l.titulo}
                    </p>
                    <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                      con {l.tutorNombre ?? "tu tutor"} · {estadoLegible(l.status)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[15px] font-bold text-[#19191f]">
                    {formatMoney(l.total, l.currency)}
                  </span>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-[#333333]">
                  {l.slotsIso.map((iso) => (
                    <li key={iso} className="first-letter:uppercase">
                      {formatSessionTime(iso, tz)}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/reservas/${l.bookingId}`}
                  className="mt-2 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline"
                >
                  Ver esta reserva
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-4">
            <span className="text-base font-semibold text-[#19191f]">
              {tumbado ? "Total del pedido" : "Total pagado"}
            </span>
            <span className="text-[26px] leading-none font-bold text-brand">
              {formatMoney(pedido.total, pedido.currency)}
            </span>
          </div>
        </PanelCard>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="h-[45px] px-6">
            <Link href="/reservas">Ver mis reservas</Link>
          </Button>
          <Button asChild variant="outline" className="h-[45px] px-6">
            <Link href={tumbado ? "/carrito" : "/classes"}>
              {tumbado ? "Volver al carrito" : "Seguir explorando"}
            </Link>
          </Button>
        </div>
      </Section>
    </Container>
  );
}

/**
 * Las claves de carrito de las líneas de este pedido, para poder sacarlas de la
 * cookie. Es el mismo formato que escribió `addCartLine`, recompuesto con el
 * mismo helper: si algún día cambia el formato, cambia en un sitio.
 */
function clavesDelCarrito(lineas: LineaResuelta[]): string[] {
  return lineas
    .filter((l) => l.productId)
    .map((l) =>
      cartLineKey({
        productId: l.productId!,
        slots: l.slotsIso.map((iso) => Date.parse(iso)).filter(Number.isFinite),
      }),
    );
}

/** El estado de una línea, en castellano y sin códigos internos (M-06). */
function estadoLegible(status: string): string {
  switch (status) {
    case "pending_payment":
      return "confirmando el pago";
    case "pending_acceptance":
      return "esperando al tutor";
    case "confirmed":
      return "confirmada";
    case "cancelled":
      return "cancelada";
    case "refunded":
      return "reembolsada";
    default:
      return status;
  }
}
