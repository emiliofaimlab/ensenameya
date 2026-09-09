import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheckIcon } from "lucide-react";

import { getSessionContext, getViewerTimezone } from "@/lib/auth/server";
import { ContactTutor } from "@/components/chat/contact-tutor";
import { tutorResponseTime } from "@/components/chat/conversations";
import { responseTimeLabel } from "@/components/chat/types";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { BookingPanel } from "@/components/catalog/booking-panel";
import { ProductCard } from "@/components/catalog/product-card";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { RegistrarVisita } from "@/components/catalog/registrar-visita";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import { getTutorDetail, listTutorReviews } from "@/lib/catalog/queries";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";

const LEVELS: Record<string, string> = {
  basico: "Básico",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getTutorDetail(id);
  const t = data?.tutor;
  return {
    title: t
      ? `${t.displayName ?? t.headline ?? "Tutor"} · Enséñame Ya`
      : "Tutor",
  };
}

export default async function TutorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; d?: string; h?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // M-12 · el tiempo de respuesta se pide en paralelo con lo demás: alimenta el
  // mismo bloque del hero y no depende de nada. `tutorResponseTime` devuelve
  // `null` mucho más a menudo de lo que parece (tutor nuevo, o que no
  // contesta), y `null` significa NO PINTAR NADA.
  //
  // ⚠️ EY-194 · la sesión vuelve al `Promise.all`, y con ella el botón
  // «Escribir a …». La quitó MN-06 el 20-ago; el 26-ago el cliente pidió
  // reabrir la consulta previa. Va en paralelo con lo demás porque no depende
  // de nada: solo decide si el botón escribe o abre el alta.
  const [data, reviews, respuestaMin, { user }] = await Promise.all([
    getTutorDetail(id),
    listTutorReviews(id),
    tutorResponseTime(id),
    getSessionContext(),
  ]);
  if (!data) notFound();
  const { tutor, products } = data;

  const respuesta = responseTimeLabel(respuestaMin);
  // Escribirse a uno mismo no es una conversación (la RPC lo rechaza igual;
  // esto es para no enseñar un botón que solo puede fallar).
  const esMiFicha = user?.id === tutor.id;

  const name = tutor.displayName ?? tutor.headline ?? "Tutor";
  const avatar = storageUrl("avatars", tutor.avatarPath);
  const level = tutor.teachingLevel ? LEVELS[tutor.teachingLevel] : null;

  // "Lo que enseño" sale de las categorías de sus productos activos.
  const topics = [
    ...new Map(
      products.flatMap((p) => p.categories.map((c) => [c.slug, c])),
    ).values(),
  ];

  /**
   * Metadatos del hero, ya filtrados: los que no tienen dato no existen. Se
   * numeran DESPUÉS de filtrar para que el separador vaya dentro de cada ítem
   * a partir del segundo, sea cual sea el primero que sobreviva (un tutor sin
   * reseñas empieza por «Nivel» y no lleva punto delante). El tiempo de
   * respuesta va aparte: en móvil ocupa su propia línea.
   */
  //
  // Los secundarios van a blanco pleno por debajo de lg (`max-lg:text-white`):
  // el Figma P07 pinta todo el texto del hero en #fff (medido: píxeles a 255 en
  // miga, titular y las dos líneas de meta), y sobre el azul de marca el 90 %
  // dejaba el contraste en 3,3:1 frente a 3,8:1 del blanco. Desde lg sigue el
  // 90 % de siempre (R1).
  const secundario = "text-[13px] text-white/90 max-lg:text-white";
  const meta = [
    reviews.length > 0 && tutor.ratingAvg
      ? {
          key: "rating",
          node: (
            <>
              {/* La estrella es adorno: al lector de pantalla se le dice
                  «Valoración 4.7» en vez de «estrella negra 4.7». Entre la
                  nota y el recuento va el punto medio del Figma («★ 4.9 · 120
                  reseñas»): a 13 px, «4.7» en negrita seguido de «3 reseñas»
                  se leía «4.73 reseñas» (se ve en la propia captura 20 de
                  Verónica). Solo por debajo de lg: el escritorio no cambia. */}
              <span className="font-bold">
                <span aria-hidden>★</span>{" "}
                <span className="sr-only">Valoración </span>
                {tutor.ratingAvg.toFixed(1)}
              </span>
              <span aria-hidden className="-mx-0.5 lg:hidden">
                ·
              </span>
              <span className={secundario}>
                {reviews.length} {reviews.length === 1 ? "reseña" : "reseñas"}
              </span>
            </>
          ),
        }
      : null,
    level
      ? {
          key: "level",
          node: (
            <>
              <span className="font-bold">Nivel</span>
              <span className={secundario}>{level}</span>
            </>
          ),
        }
      : null,
    products.length > 0
      ? {
          key: "products",
          node: (
            <>
              <span className="font-bold">{products.length}</span>
              <span className={secundario}>
                {products.length === 1 ? "mentoría" : "mentorías"}
              </span>
            </>
          ),
        }
      : null,
  ].filter((m) => m !== null);

  /**
   * El estado del panel de reserva vive ENTERO en la query: clase (`p`), día
   * (`d`) y —desde MN-16— hora (`h`). Nada de estado de cliente: la ficha es un
   * server component y así la elección se puede compartir, recargar y deshacer
   * con el botón atrás.
   *
   * ⚠️ `URLSearchParams` no es adorno: la hora es un ISO con `:` y, según el
   * huso, un `+` en el offset. Concatenarla a mano dejaría ese `+` crudo en la
   * query, donde significa "espacio" — la hora llegaría destrozada al otro lado
   * y el panel la descartaría por no casar con ningún hueco.
   *
   * El `#reservar` es para quien llega de FUERA (los enlaces del carrito):
   * aterriza en el panel y no al principio de la ficha. Dentro del panel el
   * hash es justo lo contrario —hacía que Next realineara la vista bajo la
   * cabecera en cada selección—, y por eso sus controles navegan con
   * `scroll: false`.
   */
  const hrefFor = (next: { p?: string; d?: string; h?: string }) => {
    const q = new URLSearchParams();
    if (next.p) q.set("p", next.p);
    if (next.d) q.set("d", next.d);
    if (next.h) q.set("h", next.h);
    const s = q.toString();
    return s ? `/tutors/${id}?${s}#reservar` : `/tutors/${id}#reservar`;
  };

  return (
    <>
      {/* EY-186 · «tutores vistos». No pinta nada y no se le pasa la sesión a
          propósito: la comprueba él con `getSession()`, que es lectura local.
          Pasársela desde aquí obligaría a que la ficha de la mentoría —que hoy
          no consulta la sesión— añadiera un viaje a Auth solo para esto. */}
      <RegistrarVisita tutorId={tutor.id} origen="tutor" />

      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01) desde
          lg. Por debajo, azul de marca PLANO: es lo que dibuja el Figma «P07 —
          Hero — Perfil» a 390 (#0080ff medido en las cuatro esquinas del PNG,
          sin degradado), y de paso sube el contraste del texto blanco en el
          extremo derecho —donde el degradado llega a #49a9ff y el blanco se
          queda en 2,5:1— hasta el 3,8:1 del azul de marca. Sigue sin ser AA
          (4,5:1); eso lo decide diseño, no una clase. `bg-brand` pinta el color
          en todos los anchos y `max-lg:bg-none` apaga la imagen del degradado
          solo bajo lg; desde lg la imagen tapa el color y no cambia nada (R1). */}
      <div className="bg-brand bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white max-lg:bg-none">
        {/* Aire vertical del hero: el Figma P07 a 390 deja ~18 arriba (la miga
            arranca en y=17) y ~22 abajo, no los 36 de escritorio. Desde md se
            queda lo de hoy: de tablet no hay frame medido. */}
        <Container className="py-5 md:py-9">
          {/* Los enlaces de la miga miden 18 px de alto: `py-3 -my-3` les da
              43,5 px de objetivo táctil sin mover un píxel (la caja de margen
              mide lo mismo que la línea). */}
          <nav
            aria-label="Miga de pan"
            className="text-[13px] text-white/90 max-lg:text-white"
          >
            <Link href="/" className="inline-block py-3 -my-3 hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link
              href="/tutors"
              className="inline-block py-3 -my-3 hover:underline"
            >
              Tutores
            </Link>
            {" / "}
            <span>{name}</span>
          </nav>

          {/*
            Verónica 3-sep (P07, capturas 20 y 21): «subir "tutor verificado" al
            lado del nombre», «información del tutor que salga desde la
            izquierda (espacio desaprovechado)» y «mover "Escribir a…" a la
            izquierda también». Es la composición del Figma «P07 — Hero —
            Perfil» a 390, medida sobre el PNG a escala 2: avatar de 64 en x=20,
            centrado en vertical con el bloque nombre+titular; nombre 20 px
            bold con la píldora a 10 px; titular 13/20; y DEBAJO, a ancho
            completo desde x=20, las líneas de metadatos (Figma: 11 px; aquí 13,
            el cuerpo dominante de Doc 24 §24.3 — 11 sobre azul es ilegible en
            un teléfono).

            Cómo se hace sin duplicar DOM: por debajo de lg esto es una rejilla
            de dos columnas (avatar | texto) y la columna de texto es
            `display: contents`, así que sus tres hijos pasan a ser celdas: el
            bloque nombre+titular cae a la derecha del avatar y meta y botón,
            con `col-span-2`, bajan a una fila propia que arranca en el borde
            izquierdo. Desde lg el `contents` se apaga y queda la fila flex de
            siempre, clase por clase (R1).
          */}
          <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2.5 lg:mt-4 lg:flex lg:flex-wrap lg:items-start lg:gap-6">
            <span className="grid size-16 shrink-0 place-items-center self-center overflow-hidden rounded-full bg-white/15 text-2xl font-semibold lg:size-[100px] lg:self-auto">
              {avatar ? (
                <Image
                  src={avatar}
                  alt=""
                  width={100}
                  height={100}
                  className="size-16 object-cover lg:size-[100px]"
                  unoptimized
                />
              ) : (
                initialsFrom(name)
              )}
            </span>

            <div className="min-w-0 max-lg:contents lg:flex-1">
              <div className="min-w-0">
                {/* `flex-wrap` a propósito: con «Valentina Ríos» a 20 px la
                    píldora cabe al lado hasta en 360 (medido: 148,6 + 10 + 77,5
                    < 244 disponibles), pero un nombre largo tiene que poder
                    bajarla a la línea siguiente en vez de recortar el nombre.
                    `min-w-0 break-words` en el h1 es para el nombre SIN
                    espacios (`full_name` lo escribe quien se registra): sin
                    eso una palabra de 35 letras desbordaba y abría scroll
                    horizontal en toda la página.

                    La píldora por debajo de sm es la del Figma: «Verificado»,
                    11 px y SIN icono (el Figma no lo dibuja; con él la fila
                    medía 256 y en 360 bajaba de línea). Desde sm vuelve el
                    icono con «Tutor verificado» a 12 px, que es lo de hoy en
                    escritorio: 11 px al lado de un nombre de 28 se quedaba
                    pequeño en tablet.

                    ⚠️ Contraste: blanco sobre el naranja de marca da 2,9:1 (AA
                    pide 4,5). Es el par de TODOS los CTA del sitio y del
                    Figma; cambiarlo es decisión de marca. Si se decide, el par
                    con tokens es `bg-primary-muted text-primary-muted-foreground`
                    (7:1). */}
                <div className="flex flex-wrap items-center gap-2.5 lg:gap-3">
                  <h1 className="min-w-0 text-xl font-bold break-words sm:text-[28px]">
                    {name}
                  </h1>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[11px] leading-4 font-semibold sm:py-1.5 sm:text-xs">
                    <BadgeCheckIcon className="size-3.5 max-sm:hidden" />
                    <span className="sm:hidden">Verificado</span>
                    <span className="max-sm:hidden">Tutor verificado</span>
                  </span>
                </div>

                {/* 13/20 a 390 (Figma); desde sm los 16 px de siempre, que es lo
                    que había de 640 en adelante antes de tocar nada (y lo que
                    pide un nombre de 28 al lado). */}
                {tutor.headline ? (
                  <p className="mt-1.5 max-w-[700px] text-pretty text-body font-medium sm:mt-2 sm:text-base">
                    {tutor.headline}
                  </p>
                ) : null}
              </div>

              {/* El Figma pedía aquí años de experiencia, tiempo de respuesta e
                  idiomas. El tiempo de respuesta YA EXISTE desde M-12: se
                  calcula (mediana de lo que tarda en contestar, 90 días,
                  mínimo 5 observaciones) y si no da un número honesto no sale
                  nada — ver `tutor_response_time`. Los otros dos siguen sin
                  estar en ninguna tabla (idioma es DD-03).

                  ⚠️ El separador va DENTRO de cada ítem, no suelto entre dos.
                  Suelto era un hijo más del flex y, al envolver, se quedaba
                  solo al final o al principio de una línea — el «•» huérfano de
                  la captura 20 de Verónica. Dentro del ítem viaja con él. En
                  escritorio mide lo mismo que antes: 16 de hueco + 4 de punto +
                  10 de margen + 6 de gap = 36 entre textos, como el gap-4 a
                  cada lado del punto suelto.

                  Y por debajo de lg, además, el punto va en POSICIÓN ABSOLUTA
                  dentro del hueco (a −10 px del ítem, en un `gap-x-4`: 6 de
                  aire a cada lado) y la lista recorta en horizontal
                  (`overflow-x-clip`, que no crea contenedor de scroll ni toca
                  el eje vertical). Con eso, cuando un ítem envuelve, su punto
                  cae 10 px a la izquierda del borde de la lista y desaparece:
                  «viajar con el ítem» solo no bastaba —a 360, o a 390 con
                  «Nivel Intermedio» y dos cifras, la segunda línea empezaba
                  por «• 3 mentorías», que es la captura 20 vista desde el otro
                  lado. Cada ítem es `relative` para anclarlo. Desde lg el
                  punto vuelve al flujo y la lista no recorta (R1).

                  Por debajo de lg el tiempo de respuesta va en línea propia
                  (Figma: dos líneas de metadatos), sin punto delante. Es una
                  lista de verdad (`ul`/`li`, con `role="list"` porque Safari
                  le quita la semántica a una lista sin viñetas). */}
              <ul
                role="list"
                className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-body max-lg:overflow-x-clip sm:text-sm lg:mt-3 lg:gap-4"
              >
                {meta.map(({ key, node }, i) => (
                  <li key={key} className="relative flex items-center gap-1.5">
                    {i > 0 ? (
                      <span
                        aria-hidden
                        className="size-1 shrink-0 rounded-full bg-white max-lg:absolute max-lg:top-[calc(50%-2px)] max-lg:-start-2.5 lg:me-2.5"
                      />
                    ) : null}
                    {node}
                  </li>
                ))}
                {/* Sin dato suficiente no hay chip. Un "responde en 2 horas" de
                    adorno es una promesa que la plataforma no puede cumplir y
                    que el alumno usa para decidir la compra. */}
                {respuesta ? (
                  <li className="flex items-center gap-1.5 text-[13px] text-white/90 max-lg:basis-full max-lg:text-white">
                    {meta.length > 0 ? (
                      <span
                        aria-hidden
                        className="size-1 shrink-0 rounded-full bg-white max-lg:hidden lg:me-2.5"
                      />
                    ) : null}
                    {respuesta}
                  </li>
                ) : null}
              </ul>

              {/* M-12 · preguntar ANTES de pagar. Va aquí, junto al nombre y a
                  la altura del panel de reserva, porque es el mismo momento: se
                  está decidiendo si comprarle a esta persona.

                  ⚠️ EY-194 · estuvo retirado del 20 al 26 de agosto por la
                  respuesta del cliente a P-1. Vuelve porque el 26 pidió lo
                  contrario. Si algún día se cierra otra vez, la puerta está en
                  `pair_can_chat` (una migración), no aquí.

                  Verónica 3-sep: en móvil baja con la meta al borde izquierdo
                  (`col-span-2`); el ancho completo y los 46 px por debajo de sm
                  los pone el propio botón (`contact-tutor.tsx`). */}
              {esMiFicha ? null : (
                <div className="col-span-2 mt-1.5 lg:mt-5">
                  <ContactTutor
                    tutorId={tutor.id}
                    tutorName={name}
                    anonimo={!user}
                  />
                </div>
              )}
            </div>
          </div>
        </Container>
      </div>

      <Container>
        {/*
          Verónica 3-sep (P07): «subir calendario antes de reseñas, debajo de
          descripción, lo que aprenderás y mentorías» y «finalizar página con
          reseñas». Orden en móvil: Sobre mí → Lo que enseño → Mentorías →
          Reserva → Política de cancelación → Reseñas. Ella misma prefiere las
          mentorías ANTES del calendario, al revés que el Figma (P07 Body pone
          la reserva entre «Lo que enseño» y «Mentorías de…»): «si no, no se
          entiende de qué es el calendario». Gana Verónica.

          Sin duplicar DOM: por debajo de lg la columna izquierda es
          `display: contents`, así que sus cinco bloques y `#reservar` pasan a
          ser hijos directos de esta pila y se ordenan con `max-lg:order-*`.
          Desde lg no hay `order` y queda la rejilla de dos columnas de hoy,
          con la política al final de la columna izquierda (R1). El orden del
          DOM (y el de lectura) sigue siendo el de escritorio: entre reseñas y
          política no hay nada enfocable, así que el tabulador no salta hacia
          atrás. `#reservar` conserva su id: los enlaces del carrito llegan ahí.
        */}
        <Section className="flex flex-col gap-11 lg:grid lg:grid-cols-[1fr_348px] lg:items-start lg:gap-10">
          <div className="max-lg:contents lg:flex lg:flex-col lg:gap-11">
            <div className="max-lg:order-1">
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">Sobre mí</h2>
              <p className="mt-3.5 text-pretty text-[15px] text-[#525252]">
                {tutor.bio ?? "Este tutor aún no escribió su biografía."}
              </p>
            </div>

            {topics.length > 0 ? (
              <div className="max-lg:order-2">
                <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                  Lo que enseño
                </h2>
                {/* Lista con separadores, como el Figma. El chip de la derecha
                    es el nivel del TUTOR (IV-02): no hay nivel por materia. */}
                <ul className="mt-3.5 divide-y divide-[#ebebeb] border-b border-[#ebebeb]">
                  {topics.map((c) => (
                    <li
                      key={c.slug}
                      className="flex items-center justify-between gap-4 py-4"
                    >
                      <Link
                        href={`/categories/${c.slug}`}
                        className="text-[15px] font-medium text-[#2e2e2e] hover:underline"
                      >
                        {c.name}
                      </Link>
                      {level ? (
                        <span className="rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]">
                          {level}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="max-lg:order-3">
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Mentorías de {name.split(" ")[0]}
              </h2>
              {products.length === 0 ? (
                <p className="mt-3.5 text-sm text-muted-foreground">
                  Este tutor aún no publicó mentorías.
                </p>
              ) : (
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} action="ver" />
                  ))}
                </div>
              )}
            </div>

            <div className="max-lg:order-6">
              {/* El contador sale de las reseñas QUE SE MUESTRAN, no de
                  `rating_count`: si no, un rating sembrado (o reseñas purgadas)
                  anuncia "Reseñas (37)" sobre una lista vacía. */}
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">Reseñas</h2>
              <div className="mt-5">
                <ReviewsSummary reviews={reviews} />
              </div>
              {reviews.length > 0 ? (
                <hr className="my-5 border-[#ebebeb]" />
              ) : null}
              <TutorReviews reviews={reviews} />
            </div>

            {/* En móvil, pegada al panel de reserva: es la letra pequeña de lo
                que se acaba de reservar, y así las reseñas cierran la página. */}
            <CancellationPolicy className="max-lg:order-5" />
          </div>

          {/* `scroll-mt-44` por debajo de lg: la cabecera pública es sticky y
              mide 173 px a 390 (147 a 768), así que llegar por el ancla
              —los enlaces del carrito— dejaba el título del panel debajo de
              ella. 176 = 173 + 3 de aire (el mismo valor que usa el pager de
              /tutors). Desde lg no hace falta: el aside es `sticky top-24` y
              se queda a la vista solo. */}
          <div id="reservar" className="max-lg:order-4 max-lg:scroll-mt-44">
            <BookingPanel
              products={products}
              selectedId={sp.p}
              selectedDay={sp.d}
              selectedTime={sp.h}
              timeZone={await getViewerTimezone()}
              hrefFor={hrefFor}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
