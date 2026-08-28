import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { resolveOrder } from "@/lib/orders/queries";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime } from "@/lib/booking";
import { OrderPayment } from "@/components/checkout/order-payment";
import { PaymentPolicy } from "@/components/checkout/payment-policy";
import { CheckoutSteps } from "@/components/checkout/checkout-steps";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";

export const metadata = { title: "Confirmar pago · Enséñame Ya" };

/**
 * EY-176 · B3.1 · **EL PASO 3 DEL CARRITO CUANDO HAY VARIAS MENTORÍAS.**
 *
 * Es la hermana de `/reservar/<id>/checkout` (una mentoría) y de
 * `/reservas/<id>/pagar` (una reserva a medias). Las tres cuelgan del grupo
 * `(checkout)`: sin cabecera, sin menú, sin pie y sin chat (N-37). El porqué y
 * la trampa de los layouts anidados están en `src/app/(checkout)/layout.tsx`.
 *
 * ⚠️ ESTA PANTALLA NO CREA NADA. Cuando se llega aquí, `create_order` ya corrió
 * en `/api/pedidos`: existen las N reservas, sus N `payments` con el importe
 * congelado, y la cabecera. Por eso no hay `create_booking`, ni `ChangeSlotLink`
 * —cambiar el horario de una línea es volver al carrito y rehacerla—, ni la
 * mecánica de reutilizar el hold: eso vive en la pantalla de una sola mentoría,
 * que es la que retiene al llegar.
 *
 * ⚠️ EL ASPECTO ES DELIBERADAMENTE SOBRIO. La ficha era el motor de cobro; el
 * diseño de esta pantalla y del carrito los cierra el responsable después. Lo
 * que sí está resuelto es lo que no se puede dejar para luego: que el alumno
 * vea EXACTAMENTE qué está comprando y por cuánto antes de poner la tarjeta —
 * con `ui_mode: 'form'` Stripe solo pinta los campos de la tarjeta (MN-01), así
 * que este resumen es el ÚNICO sitio donde se dice qué se lleva. Si alguien lo
 * quita, se paga a ciegas.
 *
 * La guarda de sesión la pone este `requireUser()` y no el layout: es también
 * quien exige el onboarding y quien arma el `?next=`.
 */
export default async function PagarPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();

  const [pedido, tz] = await Promise.all([resolveOrder(id), getUserTimezone()]);
  // RLS: un pedido ajeno no se lee, así que aquí ya es 404. La autorización es
  // `orders_select_student`, no una comprobación de este fichero.
  if (!pedido) notFound();

  // Ya cobrado (o tumbado): no se abre un cobro nuevo. Se lleva a la
  // confirmación, que sabe contar los tres desenlaces.
  if (pedido.order.status !== "pending_payment") {
    redirect(`/pedidos/${id}/confirmacion`);
  }

  // ⚠️ P-1 · si una línea perdió su hueco, el pedido entero deja de ser
  // cobrable y hay que rehacerlo desde el carrito. Abrir el cobro por las que
  // queden sería cobrar un pedido distinto del que se revisó. El Route Handler
  // lo rechaza igualmente con 409; esto es para no enseñar un formulario que va
  // a fallar.
  const caida = pedido.lineas.find((l) => l.status !== "pending_payment");

  // M-02 · ¿todas iguales, o hay de las dos? Se resuelve aquí y no dentro del
  // `map` porque decide DOS cosas a la vez: la marca de cada línea y el texto
  // único de la política de abajo. Con todas iguales no se marca nada —una
  // etiqueta repetida en las tres líneas es ruido, y la frase de la política ya
  // lo dice—; en cuanto se mezclan, hay que decir cuál es cuál.
  const mezcla =
    pedido.lineas.some((l) => l.aceptaSola) &&
    pedido.lineas.some((l) => !l.aceptaSola);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <CheckoutSteps current={3} className="mb-5" />
        <Link
          href="/carrito"
          className="mb-4 flex w-fit items-center gap-1.5 text-sm text-[#6b6b6b] transition-colors hover:text-foreground"
        >
          Volver al carrito
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Confirmar pago
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          {pedido.lineas.length} mentorías en un solo pago. El cobro lo procesa
          nuestro proveedor de pagos.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <PanelCard className="sm:p-6">
          <PanelCardTitle className="text-[17px]">Resumen del pedido</PanelCardTitle>

          <ul className="mt-4 flex flex-col gap-4">
            {pedido.lineas.map((l) => (
              <li key={l.bookingId} className="border-t border-[#e0e0e0] pt-4 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[15px] font-semibold text-balance text-[#19191f]">
                    {l.titulo}
                  </p>
                  <span className="shrink-0 text-[15px] font-bold text-[#19191f]">
                    {formatMoney(l.total, l.currency)}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                  con {l.tutorNombre ?? "tu tutor"}
                  {l.durationMin ? ` · ${l.durationMin} min` : ""}
                </p>
                {/* RN-01/RN-02 · en la hora del ALUMNO, con `getUserTimezone`.
                    Sin `timeZone` explícito el SSR pinta la del servidor (UTC en
                    Vercel) y esta lista diría una hora distinta de la que se
                    eligió en el calendario. Mismo helper que las otras dos
                    pantallas de pago: la lógica de zona vive en un sitio. */}
                <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-[#333333]">
                  {l.slotsIso.map((iso) => (
                    <li key={iso} className="first-letter:uppercase">
                      {formatSessionTime(iso, tz)}
                    </li>
                  ))}
                </ul>
                {/* M-02 · la marca por línea, solo cuando el pedido mezcla. Es
                    el «lo tienes marcado en cada una» al que remite la política
                    de abajo: sin esto, esa frase manda a mirar algo que no
                    está. */}
                {mezcla ? (
                  <p className="mt-1.5 text-[11.5px] text-[#6b6b6b]">
                    {l.aceptaSola
                      ? "Queda confirmada al pagar."
                      : `La confirma el tutor (hasta ${P.cutoffHours} h).`}
                  </p>
                ) : null}
                {/* Qué tiene que traer el alumno a ESTA mentoría.

                    Esta es la última pantalla en la que todavía puede echarse
                    atrás sin haber pagado nada, así que si una de las tres pide
                    portátil y no lo tiene, es aquí donde le sirve enterarse. En
                    la ficha ya salía —con más sitio y más detalle—, pero al
                    carrito se llega desde el calendario y no siempre pasando
                    por ella.

                    Va al final de la línea y en un cuerpo más pequeño: informa,
                    no compite con el precio ni con los horarios. Sin requisitos
                    no se pinta nada. */}
                {l.requerimientos.length > 0 ? (
                  <div className="mt-2 rounded-[10px] bg-muted px-2.5 py-2">
                    <p className="text-[11.5px] font-semibold text-[#404040]">
                      Necesitas tener listo
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {l.requerimientos.map((r, i) => (
                        <li key={`${i}-${r}`} className="flex items-start gap-1.5">
                          <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand" />
                          <span className="text-[11.5px] text-[#525252]">{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-4">
            <span className="text-base font-semibold text-[#19191f]">Total</span>
            <span className="text-[26px] leading-none font-bold text-brand">
              {formatMoney(pedido.total, pedido.currency)}
            </span>
          </div>

          {/* La política se cuenta entera, incluida la mitad mala (D-4).
              ⚠️ AQUÍ HABÍA UN `aceptaSola={false}` FIJO, con el argumento de que
              era «el texto conservador, que nunca promete de menos». No lo era:
              ese texto promete que si el tutor no contesta en 24 h se devuelve
              el 100 % automáticamente, y para una línea que se confirma sola esa
              devolución no existe (M-02 — sin `pending_acceptance` no hay
              ventana de RN-38 que vencer). O sea que prometía de MÁS, y en la
              dirección que vende. Ahora se dice lo que aplica a cada línea. */}
          <PaymentPolicy
            aceptaSola={mezcla ? "mixto" : (pedido.lineas[0]?.aceptaSola ?? false)}
            className="mt-4 border-t border-[#e0e0e0] pt-4"
          />
        </PanelCard>

        <PanelCard>
          <PanelCardTitle className="text-[15px]">Método de pago</PanelCardTitle>

          {caida ? (
            <div className="mt-3.5 rounded-xl border border-dashed border-destructive/40 p-5">
              <p role="alert" className="text-[13px] text-destructive">
                «{caida.titulo}» ya no está disponible, así que este pedido no se
                puede cobrar. Los pedidos se pagan enteros: vuelve al carrito,
                quita o cambia esa mentoría y pásalo otra vez a pago.
              </p>
              <Link
                href="/carrito"
                className="mt-3 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline"
              >
                Volver al carrito
              </Link>
            </div>
          ) : (
            <OrderPayment
              orderId={pedido.order.id}
              total={pedido.total}
              currency={pedido.currency}
            />
          )}
        </PanelCard>
      </div>
    </div>
  );
}
