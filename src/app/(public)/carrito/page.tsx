import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  InfoIcon,
  ShoppingCartIcon,
} from "lucide-react";

import { getViewerTimezone } from "@/lib/auth/server";
import { resolveCart, type CartResolvedLine } from "@/lib/cart/resolve";
import { formatMoney, initialsFrom, storageUrl } from "@/lib/catalog/format";
import { bookingFormatLabel, formatSessionTime } from "@/lib/booking";
import { HOLD_POLICY } from "@/lib/policy";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { CheckoutSteps } from "@/components/checkout/checkout-steps";
import {
  ClearCart,
  PruneBought,
  RemoveLine,
} from "@/components/cart/cart-actions";

export const metadata = { title: "Tu carrito · Enséñame Ya" };

/**
 * EY-177 · B3.2 · **PASO 2 DE 3 — LA REVISIÓN.**
 *
 * Palabras del cliente: «ahí entra la segunda pantalla que es la revisión: esto
 * es lo que voy a comprar, 2 mentorías, del mismo tutor, bla bla bla — acá
 * necesitamos ser bien claros con la información».
 *
 * El punto de partida es el «Resumen del pedido» de `checkout-form.tsx:649-728`,
 * que hasta hoy era **lo único** que el alumno veía de lo que compraba (con
 * `ui_mode:'form'` Stripe solo pinta los campos de tarjeta, MN-01). Se conserva
 * su criterio entero —qué, con quién, cuándo en la hora del alumno, cuánto— y
 * se le añade lo que no podía tener: varias líneas, y la verdad sobre cada una.
 *
 * ⚠️ CUELGA DE `(public)`, NO DE `(app)`, Y NO ES UN DESCUIDO. Un anónimo tiene
 * que poder llegar hasta aquí: la cookie del carrito es del navegador, no de la
 * sesión, así que quien entra desde una búsqueda apunta dos mentorías, revisa
 * lo que va a comprar y **solo al pagar** se le pide cuenta. Ese `requireUser()`
 * vive en el checkout y arma el `?next=` con la query incluida, así que vuelve
 * del registro justo donde estaba y con su carrito intacto — la cookie
 * sobrevive al login porque no depende de él. Poner esta pantalla tras la
 * sesión sería exigir registro para MIRAR, que es el embudo que sobra.
 *
 * ⚠️ TODO SE RESUELVE EN SERVIDOR. La cookie solo guarda ids e instantes; el
 * título, el tutor, la disponibilidad y el **precio** los relee `resolveCart()`
 * contra la base con la ANON key (y por tanto con RLS). Regla de oro 2: el
 * importe que se cobra sigue saliendo de `payments.gross_amount`, que congela
 * `create_booking`; lo de aquí es informativo y se dice.
 */
export default async function CarritoPage() {
  const [carrito, tz] = await Promise.all([resolveCart(), getViewerTimezone()]);
  const { lines, totalEstimado, currency, compradas } = carrito;

  const comprables = lines.filter(
    (l) => l.estado.tipo === "ok" || l.estado.tipo === "pagando",
  );
  const conProblema = lines.length - comprables.length;

  return (
    <Container>
      <Section className="max-w-[900px] py-8 sm:py-10">
        <CheckoutSteps current={2} className="mb-5" />

        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Tu carrito
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          {lines.length === 0
            ? "Todavía no has añadido ninguna mentoría."
            : "Revisa lo que vas a comprar antes de pasar al pago."}
        </p>

        {/* Limpia de la cookie lo que el servidor ya dio por comprado. No pinta
            nada; el porqué está en el propio componente. */}
        <PruneBought keys={compradas} />

        {lines.length === 0 ? (
          <PanelCard className="mt-6 flex flex-col items-center gap-4 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <ShoppingCartIcon className="size-5 text-[#6b6b6b]" />
            </span>
            <div>
              <p className="text-base font-semibold text-[#19191f]">
                El carrito está vacío
              </p>
              <p className="mt-1 text-[13px] text-[#6b6b6b]">
                Elige una mentoría, su día y su hora, y añádela desde la ficha.
              </p>
            </div>
            <Button asChild className="h-[45px] px-6">
              <Link href="/classes">Ver mentorías</Link>
            </Button>
          </PanelCard>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_330px] lg:items-start">
            <div className="flex flex-col gap-4">
              {lines.map((l) => (
                <LineaDelCarrito key={l.key} l={l} tz={tz} />
              ))}
              <div className="flex justify-end">
                <ClearCart keys={lines.map((l) => l.key)} />
              </div>
            </div>

            <PanelCard className="lg:sticky lg:top-24">
              <PanelCardTitle className="text-[17px]">Resumen</PanelCardTitle>

              <dl className="mt-4 flex flex-col gap-2 border-t border-[#e0e0e0] pt-4 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6b6b6b]">Mentorías</dt>
                  <dd className="text-[#333333]">{comprables.length}</dd>
                </div>
                {conProblema > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#6b6b6b]">Sin disponibilidad</dt>
                    <dd className="text-destructive">{conProblema}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-3">
                <span className="text-base font-semibold text-[#19191f]">
                  {/* «Estimado» no es un adorno defensivo: el importe que se
                      cobra lo congela `create_booking` al crear la reserva, y si
                      el tutor cambia el precio entre esta pantalla y el pago,
                      manda el de entonces. Llamarlo «Total» a secas sería
                      prometer una cifra que no depende de nosotros. */}
                  Total estimado
                </span>
                <span className="text-[26px] leading-none font-bold text-brand">
                  {currency ? formatMoney(totalEstimado, currency) : "—"}
                </span>
              </div>
              {currency === null && comprables.length > 0 ? (
                <p className="mt-1.5 text-right text-xs text-[#6b6b6b]">
                  Las mentorías están en monedas distintas: mira el precio de
                  cada una.
                </p>
              ) : null}

              <PasoAlPago comprables={comprables} />

              {/* El carrito NO retiene nada, y se dice aquí y no en letra
                  pequeña: es la contrapartida de la opción A (Doc 23 §23.3.5) y
                  la razón de que una línea pueda aparecer «ya ocupada» arriba.
                  El plazo sale de `HOLD_POLICY`, que es la copia de
                  `p_payment_cutoff` de `expire_stale_bookings` — tecleado a mano
                  es como una de las dos acaba mintiendo. */}
              <p className="mt-4 border-t border-[#e0e0e0] pt-4 text-xs leading-relaxed text-[#6b6b6b]">
                Guardar una mentoría aquí no bloquea el horario: hasta que no
                entras al pago, otro alumno puede llevárselo. Al pasar al pago te
                lo reservamos {HOLD_POLICY.minutes} minutos para que lo
                completes.
              </p>
            </PanelCard>
          </div>
        )}
      </Section>
    </Container>
  );
}

/**
 * ⚠️⚠️ EL BORDE DEL COBRO. AQUÍ SE PARA EY-177 Y EMPIEZA **EY-176**.
 *
 * El motor de dinero de hoy compra **una mentoría por cobro**: `create_booking`
 * recibe UN producto con sus horarios y crea UNA reserva, UN `payments` con su
 * snapshot congelado y N `sessions`; `payments.booking_id` es `unique`; la
 * Session de Stripe lleva un solo `line_item` y el webhook confirma un solo
 * booking. No existe ninguna entidad de pedido: `grep` de `order_id`, `cart_id`
 * o `group_id` sobre las migraciones da cero.
 *
 * Así que un carrito de N líneas **no se puede cobrar de una vez sin reescribir
 * ese motor**, y eso es EY-176 —costado en XL, con «NO INICIAR SIN REUNIÓN DE
 * DISEÑO» en su ficha y tres preguntas de producto sin contestar—. Lo que NO se
 * ha hecho aquí, a propósito, es inventarse la respuesta.
 *
 * Lo que sí se hace es lo honesto:
 *
 *  · **Una línea** → el botón lleva a la MISMA URL de siempre,
 *    `/reservar/<id>/checkout?slots=…`, sin un solo cambio en el checkout ni en
 *    el motor. Es literalmente la compra de hoy.
 *  · **Varias líneas** → se dice en la cara que hoy se paga una a una, y cada
 *    línea lleva su propio botón a ese mismo checkout. No se suma nada, no se
 *    crea ningún pedido, no se toca el webhook. Cada cobro sigue siendo lo que
 *    ya era: una reserva, un pago.
 *
 * ⚠️ Y el fallo que hay que arreglar ANTES de cobrar N líneas juntas está
 * escrito entero en `lib/cart/cookie.ts`: `payment_webhook_events.event_id` es
 * clave primaria, así que un solo evento para N reservas confirmaría UNA y
 * dejaría las demás muriendo de `expire_stale_bookings` a los 7 minutos —
 * cobradas y sin clase.
 */
function PasoAlPago({ comprables }: { comprables: CartResolvedLine[] }) {
  if (comprables.length === 0) {
    return (
      <Button disabled className="mt-4 h-[49px] w-full text-[15px]">
        Ir al pago
      </Button>
    );
  }

  if (comprables.length === 1) {
    const l = comprables[0]!;
    return (
      <Button asChild className="mt-4 h-[49px] w-full text-[15px]">
        <Link href={hrefDePago(l)}>Ir al pago</Link>
      </Button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-warning/40 bg-warning-muted p-3.5">
      <p className="flex items-start gap-2 text-[13px] leading-relaxed font-semibold text-warning">
        <InfoIcon className="mt-px size-4 shrink-0" />
        Por ahora cada mentoría se paga por separado
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-[#6b6b6b]">
        Todavía no podemos cobrar varias mentorías en un solo pago. Paga la
        primera con su botón y vuelve aquí: la que ya esté pagada desaparece del
        carrito sola.
      </p>
      <Button asChild className="mt-3 h-[45px] w-full text-sm">
        <Link href={hrefDePago(comprables[0]!)}>Pagar la primera</Link>
      </Button>
    </div>
  );
}

/**
 * A dónde va a pagar una línea. **La URL de siempre**, la que ya emitía el
 * calendario de la ficha (`destinoDeLaHora` en `booking-panel.tsx`) y la que
 * construye el selector de paquetes: `/reservar/<id>/checkout?slots=<iso,iso>`.
 *
 * Que no cambie es el punto: el checkout no se entera de que existe un carrito,
 * y por tanto no hay ni una línea del camino del dinero tocada por EY-177.
 *
 * ⚠️ Los ISO salen de `toISOString()`, o sea UTC con `Z`. Postgres los compara
 * como `timestamptz`, o sea **por instante**, así que da igual que la base
 * devuelva el mismo momento como `+00:00`. Es la misma trampa que documentan
 * `booking-panel.tsx` y `lib/checkout/hold.ts`, resuelta de raíz al guardar
 * instantes en la cookie en vez de texto.
 */
function hrefDePago(l: CartResolvedLine): string {
  return `/reservar/${l.line.productId}/checkout?slots=${encodeURIComponent(l.slotsIso.join(","))}`;
}

/** Una línea: qué, con quién, cuándo y cuánto. Y qué le pasa, si le pasa algo. */
function LineaDelCarrito({ l, tz }: { l: CartResolvedLine; tz: string }) {
  const p = l.product;
  const titulo = p?.title ?? "Mentoría no disponible";
  const avatar = storageUrl("avatars", p?.tutorAvatarPath);
  const roto = l.estado.tipo !== "ok" && l.estado.tipo !== "pagando";

  return (
    <PanelCard className={roto ? "border-destructive/40" : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-balance text-[#19191f]">
            {titulo}
          </p>
          {p ? (
            <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
              {bookingFormatLabel(l.slotsIso.length)}
              {p.sessionDurationMin ? ` · ${p.sessionDurationMin} min` : ""}
            </p>
          ) : null}
        </div>
        <RemoveLine lineKey={l.key} etiqueta={titulo} className="shrink-0" />
      </div>

      {p ? (
        <div className="mt-3.5 flex items-center gap-2.5 border-t border-[#e0e0e0] pt-3.5">
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[12px] font-semibold">
            {avatar ? (
              <Image
                src={avatar}
                alt=""
                width={36}
                height={36}
                className="size-9 object-cover"
                unoptimized
              />
            ) : (
              initialsFrom(p.tutorName)
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] text-[#4b4b4b]">
              con{" "}
              <Link
                href={`/tutors/${p.tutorId}`}
                className="font-semibold text-[#19191f] hover:underline"
              >
                {p.tutorName ?? "tu tutor"}
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      {/* RN-01/RN-02 · en la hora del VISITANTE, con `getViewerTimezone`. Sin
          `timeZone` explícito el SSR pinta la del servidor (UTC en Vercel) y
          esta lista diría una hora distinta de la que se eligió en el
          calendario, que sí usa la del perfil. Mismo helper que el checkout: la
          lógica de zona vive en un sitio a propósito. */}
      <ul className="mt-3.5 flex flex-col gap-1.5 border-t border-[#e0e0e0] pt-3.5 text-[13px] text-[#333333]">
        {l.slotsIso.map((iso) => (
          <li key={iso} className="first-letter:uppercase">
            {formatSessionTime(iso, tz)}
          </li>
        ))}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e0e0e0] pt-3.5">
        <EstadoDeLinea l={l} />
        {p ? (
          <span className="text-[17px] font-bold text-[#19191f]">
            {formatMoney(l.total, p.currency)}
          </span>
        ) : null}
      </div>
    </PanelCard>
  );
}

/** Lo que le pasa a esta línea ahora mismo, y qué se puede hacer al respecto. */
function EstadoDeLinea({ l }: { l: CartResolvedLine }) {
  switch (l.estado.tipo) {
    case "ok":
      return (
        <Button asChild variant="outline" className="h-9 text-[13px]">
          <Link href={hrefDePago(l)}>
            Pagar esta mentoría
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </Button>
      );

    /* Su propio hold: entró al checkout, se creó la reserva y no llegó a pagar.
       No es un error y no se le manda a elegir otra hora — se le devuelve a su
       pago, que el checkout sabe reutilizar (`buscarReservaDelAlumno`). Sin esta
       rama vería «horario ocupado» sobre su propia reserva, porque
       `get_available_slots` descuenta toda sesión no cancelada del tutor sin
       mirar de quién es. */
    case "pagando":
      return (
        <Button asChild variant="outline" className="h-9 text-[13px]">
          <Link href={hrefDePago(l)}>
            Continuar el pago
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </Button>
      );

    case "horario_ocupado":
      return (
        <div className="flex items-start gap-1.5 text-[13px] text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Ese horario ya no está libre.{" "}
            <Link
              href={`/products/${l.line.productId}#reservar`}
              className="font-semibold underline"
            >
              Elegir otro
            </Link>
          </span>
        </div>
      );

    case "caducado":
      return (
        <div className="flex items-start gap-1.5 text-[13px] text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Esa hora ya pasó.{" "}
            <Link
              href={`/products/${l.line.productId}#reservar`}
              className="font-semibold underline"
            >
              Elegir otra
            </Link>
          </span>
        </div>
      );

    case "no_disponible":
      return (
        <div className="flex items-start gap-1.5 text-[13px] text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {/* No se dice cuál de las dos causas es —mentoría despublicada o tutor
              sin aprobación— porque desde fuera no se distinguen y ninguna es
              asunto del alumno. Lo accionable es lo mismo en los dos casos. */}
          <span>Esta mentoría ya no está disponible. Quítala del carrito.</span>
        </div>
      );
  }
}
