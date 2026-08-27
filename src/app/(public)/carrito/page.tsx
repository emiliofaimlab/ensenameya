import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
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
  PagarPedido,
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
  // Cuántas personas distintas hay detrás del pedido. Solo se enseña con más de
  // una: es lo que convierte «3 mentorías» en «3 mentorías de 2 tutores», que es
  // la información que el cliente pidió que quedara clara.
  const tutoresDistintos = new Set(
    comprables.map((l) => l.product?.tutorId).filter(Boolean),
  ).size;

  return (
    <Container>
      {/* ⚠️ 1280 y no 900. Nació copiando el ancho del checkout, que es
          estrecho a propósito —allí la pantalla es un formulario de tarjeta y
          estrechar AYUDA a no distraer—. Aquí el trabajo es el contrario:
          comparar varias mentorías de un vistazo. Con 900 px en una pantalla
          de 1860 sobraba media pantalla a la derecha mientras las tarjetas
          quedaban apretadas. 1280 es el ancho ancho que ya usa el proyecto en
          otras cinco pantallas; no se inventa uno nuevo. */}
      <Section className="max-w-[1280px] py-8 sm:py-10">
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
          /* El resumen crece de 330 a 380: es la columna que lleva el total y
             el botón de pagar, y con más ancho el aviso de «todo o nada» deja
             de partirse en cinco líneas. */
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
            <div className="flex flex-col gap-5">
              {agruparPorTutor(lines).map((g) => (
                <GrupoDeTutor key={g.clave} grupo={g} tz={tz} />
              ))}
              {/* ⚠️ A la IZQUIERDA en móvil, y no es una preferencia estética.
                  Alineado a la derecha cae justo debajo de la burbuja de chat
                  (`fixed right-5 bottom-5 z-50`) y **deja de recibir el clic**:
                  medido, `elementFromPoint` sobre el centro del botón devolvía
                  la burbuja. Aquí no se reserva hueco con un `pe-` como en la
                  barra de reserva, porque esta pantalla la ven también los
                  anónimos —que NO tienen burbuja— y les quedaría un vacío de
                  84 px al lado del único botón de la fila. Moverlo no cuesta
                  nada y vale para los dos casos. */}
              <div className="flex justify-start lg:justify-end">
                <ClearCart keys={lines.map((l) => l.key)} />
              </div>
            </div>

            <PanelCard className="lg:sticky lg:top-24">
              <PanelCardTitle className="text-[17px]">Resumen</PanelCardTitle>

              <dl className="mt-4 flex flex-col gap-2 border-t border-[#e0e0e0] pt-4 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#6b6b6b]">
                    {comprables.length === 1 ? "Mentoría" : "Mentorías"}
                  </dt>
                  <dd className="font-medium text-[#333333]">
                    {comprables.length}
                  </dd>
                </div>
                {tutoresDistintos > 1 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#6b6b6b]">Tutores</dt>
                    <dd className="font-medium text-[#333333]">
                      {tutoresDistintos}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {/* ⚠️ Las líneas rotas salen del bloque de arriba y se enseñan
                  como AVISO, no como una fila más de la tabla. Antes eran un
                  «Sin disponibilidad · 1» entre los recuentos, con el mismo
                  peso visual que «Mentorías · 2» — y no es lo mismo: con P-1
                  (todo o nada) esa fila es lo único que puede impedir la compra
                  entera. Un dato y un obstáculo no se pintan igual. */}
              {conProblema > 0 ? (
                <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-destructive/[0.07] p-3 text-[12.5px] leading-relaxed text-destructive">
                  <AlertTriangleIcon className="mt-px size-4 shrink-0" />
                  <span>
                    {conProblema === 1
                      ? "Una mentoría ha perdido su horario. Cámbiala o quítala para poder pagar."
                      : `${conProblema} mentorías han perdido su horario. Cámbialas o quítalas para poder pagar.`}
                  </span>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#e0e0e0] pt-4">
                <span className="text-base font-semibold text-[#19191f]">
                  {/* «Estimado» no es un adorno defensivo: el importe que se
                      cobra lo congela `create_booking` al crear la reserva, y si
                      el tutor cambia el precio entre esta pantalla y el pago,
                      manda el de entonces. Llamarlo «Total» a secas sería
                      prometer una cifra que no depende de nosotros. */}
                  Total estimado
                </span>
                <span className="text-[30px] leading-none font-bold text-brand">
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
              <p className="mt-4 flex items-start gap-1.5 border-t border-[#e0e0e0] pt-4 text-xs leading-relaxed text-[#6b6b6b]">
                <ClockIcon className="mt-px size-3.5 shrink-0" />
                <span>
                  Guardar una mentoría aquí no bloquea el horario: hasta que no
                  entras al pago, otro alumno puede llevárselo. Al pasar al pago
                  te lo reservamos {HOLD_POLICY.minutes} minutos para que lo
                  completes.
                </span>
              </p>
            </PanelCard>
          </div>
        )}
      </Section>
    </Container>
  );
}

/**
 * ⚠️⚠️ EL BORDE DEL COBRO — y desde EY-176 ya se cruza.
 *
 * Hasta la ficha del motor, el carrito paraba aquí: se decía en la cara que
 * cada mentoría se pagaba por separado, porque `create_booking` compraba UNA
 * mentoría por cobro y no existía ninguna entidad de pedido. Eso lo resolvió
 * EY-176 (`20260827150000`…`20260827170000`) con las tres decisiones que
 * bloqueaban la ficha:
 *
 *  · **P-3 · un cobro, varias líneas.** `create_order` crea las N reservas y su
 *    cabecera; la Session lleva un `line_item` por mentoría y un solo cargo.
 *  · **P-1 · todo o nada.** Las N reservas nacen en UNA transacción: si una
 *    pierde su hueco, no se crea ninguna y se dice cuál falló.
 *  · **P-2 · el carrito NO retiene.** El reloj de 7 minutos sigue arrancando al
 *    entrar al pago, y las N líneas comparten `created_at`, así que es UN
 *    contador para todo el pedido. Lo dice el párrafo de abajo, y no en letra
 *    pequeña.
 *
 * Los dos caminos, y la diferencia importa:
 *
 *  · **Una línea** → la MISMA URL de siempre, `/reservar/<id>/checkout?slots=…`.
 *    Ni pedido, ni cabecera, ni una línea del motor viejo tocada. Es
 *    literalmente la compra de hoy, y se deja así a propósito: es el camino que
 *    también usan la ficha del tutor y el selector de horarios, y meterle un
 *    pedido por medio sería arriesgar el flujo que ya funciona para no ganar
 *    nada.
 *  · **Varias líneas** → `POST /api/pedidos`, que relee el carrito EN SERVIDOR
 *    (la cookie es entrada del usuario) y devuelve el `orderId`.
 *
 * ⚠️ El aspecto de esta pantalla lo cierra el responsable después; lo que hay
 * aquí es el enchufe del motor, no el diseño.
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
    <>
      <PagarPedido cuantas={comprables.length} />
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-[#6b6b6b]">
        <InfoIcon className="mt-px size-3.5 shrink-0" />
        {/* La contrapartida de P-1, dicha antes de pulsar y no después de
            fallar: un pedido se compra entero. Si entre esta pantalla y el pago
            alguien se lleva uno de los huecos, no se compra «lo que quede». */}
        Se cobran juntas en un solo pago. Si alguna pierde su horario, no se
        cobra ninguna y te lo decimos.
      </p>
    </>
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

/**
 * Las líneas, agrupadas por tutor.
 *
 * ⚠️ El agrupado NO es adorno: es la frase del cliente hecha pantalla —«esto es
 * lo que voy a comprar, 2 mentorías, DEL MISMO TUTOR»—. Con tres líneas sueltas
 * hay que leer tres veces el nombre para darse cuenta de que dos son de la
 * misma persona; agrupadas se ve sin leer. Y como el pedido se cobra junto pero
 * el dinero se reparte por tutor, que la pantalla enseñe esa misma estructura
 * evita explicarla después.
 *
 * Se conserva el ORDEN en que se añadieron: el grupo aparece donde cayó su
 * primera línea. Reordenar por nombre o por precio movería cosas de sitio entre
 * una visita y otra sin que el alumno haya tocado nada.
 *
 * Las líneas sin tutor legible (`no_disponible`) van cada una en su propio
 * grupo anónimo: no se pueden agrupar con nadie y son justo las que hay que
 * mirar, así que no conviene esconderlas debajo de una cabecera ajena.
 */
type GrupoTutor = {
  clave: string;
  tutorId: string | null;
  nombre: string | null;
  avatar: string | null;
  lineas: CartResolvedLine[];
};

function agruparPorTutor(lines: CartResolvedLine[]): GrupoTutor[] {
  const grupos: GrupoTutor[] = [];
  const porTutor = new Map<string, GrupoTutor>();

  for (const l of lines) {
    const p = l.product;
    if (!p) {
      grupos.push({
        clave: `huerfana-${l.key}`,
        tutorId: null,
        nombre: null,
        avatar: null,
        lineas: [l],
      });
      continue;
    }
    const ya = porTutor.get(p.tutorId);
    if (ya) {
      ya.lineas.push(l);
      continue;
    }
    const grupo: GrupoTutor = {
      clave: p.tutorId,
      tutorId: p.tutorId,
      nombre: p.tutorName,
      avatar: storageUrl("avatars", p.tutorAvatarPath),
      lineas: [l],
    };
    porTutor.set(p.tutorId, grupo);
    grupos.push(grupo);
  }
  return grupos;
}

function GrupoDeTutor({ grupo, tz }: { grupo: GrupoTutor; tz: string }) {
  const cuantas = grupo.lineas.length;

  return (
    <section className="flex flex-col gap-2.5">
      {grupo.tutorId ? (
        <div className="flex items-center gap-2.5 px-1">
          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[11px] font-semibold text-[#4b4b4b]">
            {grupo.avatar ? (
              <Image
                src={grupo.avatar}
                alt=""
                width={32}
                height={32}
                className="size-8 object-cover"
                unoptimized
              />
            ) : (
              initialsFrom(grupo.nombre)
            )}
          </span>
          <p className="min-w-0 text-[13px] text-[#6b6b6b]">
            con{" "}
            <Link
              href={`/tutors/${grupo.tutorId}`}
              className="font-semibold text-[#19191f] hover:underline"
            >
              {grupo.nombre ?? "tu tutor"}
            </Link>
            {/* El recuento solo cuando hay más de una: con una sola línea
                diría «1 mentoría» debajo de una tarjeta que ya se ve. */}
            {cuantas > 1 ? (
              <span className="text-[#6b6b6b]"> · {cuantas} mentorías</span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {grupo.lineas.map((l) => (
          <LineaDelCarrito key={l.key} l={l} tz={tz} />
        ))}
      </div>
    </section>
  );
}

/**
 * Una línea: qué, cuándo y cuánto. Y qué le pasa, si le pasa algo.
 *
 * El tutor ya no se repite aquí — lo dice la cabecera del grupo. Lo que gana
 * su sitio es la MINIATURA: en una lista, una imagen se reconoce antes de que
 * el ojo llegue a leer el título, y esta pantalla se mira con prisa.
 *
 * ⚠️ Una línea rota se marca por TRES vías a la vez —barra lateral roja, fondo
 * teñido y el aviso con su icono— y no solo por el borde fino que tenía antes.
 * Es la única cosa de esta pantalla que puede tumbar la compra entera (P-1:
 * todo o nada), así que no puede competir de tú a tú con el resto del ruido.
 */
function LineaDelCarrito({ l, tz }: { l: CartResolvedLine; tz: string }) {
  const p = l.product;
  const titulo = p?.title ?? "Mentoría no disponible";
  const portada = storageUrl("product-images", p?.imagePath);
  const roto = l.estado.tipo !== "ok" && l.estado.tipo !== "pagando";

  return (
    <PanelCard
      className={`overflow-hidden p-0 ${roto ? "border-destructive/50 bg-destructive/[0.03]" : ""}`}
    >
      <div className="flex">
        {/* La barra es el único elemento que se ve desde el rabillo del ojo al
            recorrer la lista: dice «esta es la que falla» sin leer nada. */}
        <span
          aria-hidden
          className={`w-1 shrink-0 ${roto ? "bg-destructive" : "bg-transparent"}`}
        />

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start gap-3.5">
            <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-gradient-to-br from-brand/15 to-primary/15 text-[15px] font-bold text-brand">
              {portada ? (
                <Image
                  src={portada}
                  alt=""
                  width={56}
                  height={56}
                  className="size-14 object-cover"
                  unoptimized
                />
              ) : (
                initialsFrom(titulo)
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-snug font-semibold text-balance text-[#19191f]">
                {titulo}
              </p>
              {p ? (
                <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
                  {bookingFormatLabel(l.slotsIso.length)}
                  {p.sessionDurationMin ? ` · ${p.sessionDurationMin} min` : ""}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {p ? (
                <span className="text-[17px] leading-none font-bold text-[#19191f]">
                  {formatMoney(l.total, p.currency)}
                </span>
              ) : null}
              <RemoveLine lineKey={l.key} etiqueta={titulo} />
            </div>
          </div>

          {/* RN-01/RN-02 · en la hora del VISITANTE, con `getViewerTimezone`.
              Sin `timeZone` explícito el SSR pinta la del servidor (UTC en
              Vercel) y esta lista diría una hora distinta de la que se eligió
              en el calendario, que sí usa la del perfil. Mismo helper que el
              checkout: la lógica de zona vive en un sitio a propósito.

              Van como fichas y no como lista suelta porque el CUÁNDO es, tras
              el precio, lo que más se vuelve a mirar en un carrito. */}
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {l.slotsIso.map((iso) => (
              <li
                key={iso}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12.5px] text-[#333333] first-letter:uppercase"
              >
                <CalendarIcon className="size-3.5 shrink-0 text-[#6b6b6b]" />
                {formatSessionTime(iso, tz)}
              </li>
            ))}
          </ul>

          <div className="mt-3.5 border-t border-[#e0e0e0] pt-3.5">
            <EstadoDeLinea l={l} />
          </div>
        </div>
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
