import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { getViewerTimezone } from "@/lib/auth/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { BookingPanel } from "@/components/catalog/booking-panel";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { ProductCover } from "@/components/catalog/product-cover";
import { RegistrarVisita } from "@/components/catalog/registrar-visita";
import { LEVELS, LANGUAGES } from "@/components/catalog/product-filters";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import { getProductDetail, listTutorReviews } from "@/lib/catalog/queries";
import {
  initialsFrom,
  perSessionLabel,
  sessionsLabel,
  storageUrl,
} from "@/lib/catalog/format";

/** Explicación del servicio, igual para toda mentoría: no es dato del producto.
 *  Verificada contra el flujo real (US-601 reserva, US-801 sala Daily, RN-38). */
const HOW_IT_WORKS =
  "Reservas tu mentoría y eliges el horario que mejor te venga. El tutor confirma en menos de 24 horas y, a la hora acordada, entras desde tu panel a una sala de video privada 1 a 1. Al terminar dejas tu reseña y agendas el siguiente paso.";

/** FAQ **por defecto** (386:2231): se muestran cuando el tutor no definió las
 *  suyas para esta mentoría (R24-17). Respuestas verificadas: RN-37
 *  (reembolsos), RN-38 (24h), US-801 (sala). */
const PRODUCT_FAQ = [
  {
    q: "¿Qué pasa si necesito reprogramar una sesión?",
    a: "Puedes reagendar con al menos 24 horas de anticipación sin coste. Con menos de 24 horas de aviso se aplica la política de cancelación de la plataforma.",
  },
  {
    q: "¿Necesito conocimientos previos para tomar esta mentoría?",
    a: "Depende de lo que el tutor indique en la descripción. Si tienes dudas, el objetivo declarado de la mentoría es la mejor guía: describe exactamente el resultado con el que vas a terminar.",
  },
  {
    q: "¿Cómo se imparten las mentorías en vivo?",
    a: "Son sesiones 1 a 1 en una sala de video privada integrada en la plataforma. Entras desde tu panel a la hora de la sesión; no necesitas instalar nada.",
  },
  {
    q: "¿Cuál es la política de cancelación y reembolso?",
    a: "Si cancelas con 24 horas o más de anticipación recibes el 100%. Con menos de 24 horas se te reembolsa el 50%. Si el tutor no confirma en 24 horas, la reserva se cancela y recuperas el 100%.",
  },
];

/** El Figma pinta viñetas; el modelo guarda un texto libre. Si la descripción
 *  viene en líneas (o con guiones), se respetan como lista; si es un párrafo,
 *  se muestra como párrafo. Sin inventar contenido que no escribió el tutor. */
function toBullets(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
  return lines.length > 1 ? lines : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductDetail(id);
  return { title: product ? `${product.title} · Enséñame Ya` : "Mentoría" };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string; h?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductDetail(id);
  if (!product) notFound();

  const reviews = await listTutorReviews(product.tutor.id);

  const sessions = sessionsLabel(product);
  const tutorName =
    product.tutor.displayName ?? product.tutor.headline ?? "Tutor";
  const tutorAvatar = storageUrl("avatars", product.tutor.avatarPath);
  const bullets = product.description ? toBullets(product.description) : null;

  /**
   * EY-194 · Las FAQ que se pintan: primero las de ESTA mentoría (R24-17) y
   * debajo las del PERFIL del tutor, que él escribe una vez y valen para las
   * cinco mentorías que tenga.
   *
   * El orden no es estético: lo específico contesta antes que lo general, y
   * quien está mirando esta mentoría pregunta primero por ella.
   *
   * ⚠️ NO SE DEDUPLICA. Si el tutor escribe la misma pregunta en los dos
   * sitios, salen las dos. Cualquier criterio de igualdad sobre texto escrito a
   * mano (¿mayúsculas?, ¿tildes?, ¿signos?) acabaría borrando de la pantalla
   * algo que el tutor puso a propósito —una respuesta más concreta para esta
   * mentoría, por ejemplo—, y el tutor ve el duplicado en su propia ficha y lo
   * arregla en dos clics. Falso positivo caro, duplicado barato.
   *
   * Las genéricas de plataforma siguen siendo el último recurso: solo si no hay
   * ninguna de las dos. Ojo con lo que eso significa —y ya está anotado en el
   * Doc 22 (G1)—: mientras el tutor no escriba nada, la ficha enseña cuatro
   * preguntas nuestras firmadas visualmente como suyas.
   */
  //
  // ⚠️ 28-ago: la sección de FAQ de PERFIL está oculta (su editor responde 404),
  // así que aquí ya no se concatena `product.tutor.faqs` — lo escrito antes de
  // ocultarla sigue en la BD pero no se publica. `getProductDetail` tampoco baja
  // ya esa columna, así que llega siempre vacía. Todo lo de arriba describe cómo
  // era y vuelve a valer en cuanto se reactive la sección.
  const faqs = product.faqs.length > 0 ? product.faqs : PRODUCT_FAQ;

  const chips = [
    reviews.length > 0 && product.tutor.ratingAvg
      ? `★ ${product.tutor.ratingAvg.toFixed(1)} · ${reviews.length} ${
          reviews.length === 1 ? "reseña" : "reseñas"
        }`
      : null,
    sessions,
    // RV-09 · en un paquete, lo que sale cada sesión. Ya se enseñaba, pero solo
    // en el panel de reserva: en lg vive en la columna derecha y por debajo del
    // calendario, y en móvil queda al FINAL de la página, detrás de la
    // descripción, las reseñas y las FAQ. Quien está decidiendo si el paquete
    // le compensa lo necesita antes de eso. `perSessionLabel` devuelve null
    // salvo en paquetes de dos o más sesiones, así que no aparece en el resto.
    perSessionLabel(product),
    "En vivo 1 a 1",
    product.sessionDurationMin
      ? `${product.sessionDurationMin} min por sesión`
      : null,
    // DD-03 · nivel e idioma DE LA MENTORÍA (el Figma pinta "Nivel
    // Universitario"; el vocabulario que da su filtro es básico/intermedio/
    // avanzado, y ese es el que se guarda). Solo si el tutor los rellenó.
    LEVELS.find((l) => l.id === product.level)?.label
      ? `Nivel ${LEVELS.find((l) => l.id === product.level)!.label}`
      : null,
    LANGUAGES.find((l) => l.id === product.language)?.label ?? null,
  ].filter(Boolean) as string[];

  return (
    <>
      {/* EY-186 · la mitad «visitas a clases» de la señal: abrir la ficha de
          una mentoría se anota al TUTOR que la imparte, con más peso que
          aterrizar en su perfil. No pinta nada y solo escribe con sesión —esta
          página no consulta Auth y no tiene por qué empezar a hacerlo—. */}
      <RegistrarVisita tutorId={product.tutor.id} origen="clase" />

      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-9">
          {/* B1.4 · La miga en UNA línea, con recorte.
              El título completo está tres centímetros más abajo, en el H1, así
              que aquí repetirlo entero no informa de nada: en móvil la miga se
              comía 2 líneas y el H1 otras 4 — seis líneas de la misma frase
              antes del primer dato útil.

              `flex` + `min-w-0` + `truncate` y no un corte por número de
              caracteres: un tope fijo recorta igual en un móvil de 375 px que en
              un monitor de 2560, así que o sobra texto o se pierde sin
              necesidad. Así se recorta exactamente cuando no cabe.

              El `title` deja el texto completo a un hover de distancia, y los
              dos primeros niveles llevan `shrink-0` para que lo que ceda sea
              siempre el nombre de la mentoría y nunca «Inicio / Mentorías». */}
          <nav
            aria-label="Miga de pan"
            className="flex items-center gap-1.5 text-[13px] text-white/90"
          >
            <Link href="/" className="shrink-0 hover:underline">
              Inicio
            </Link>
            <span className="shrink-0">/</span>
            <Link href="/classes" className="shrink-0 hover:underline">
              Mentorías
            </Link>
            <span className="shrink-0">/</span>
            <span className="min-w-0 truncate" title={product.title}>
              {product.title}
            </span>
          </nav>

          <h1 className="mt-3.5 max-w-3xl text-2xl font-bold text-balance sm:text-3xl">
            {product.title}
          </h1>
          {product.outcome ? (
            <p className="mt-3.5 max-w-[700px] text-pretty text-white/95">
              {product.outcome}
            </p>
          ) : null}

          <ul className="mt-4 flex flex-wrap gap-2">
            {chips.map((c) => (
              <li
                key={c}
                className="inline-flex h-[34px] items-center rounded-full border border-[#d9d9d9] bg-card px-3.5 text-[13px] font-medium text-[#4d4d4d]"
              >
                {c}
              </li>
            ))}
          </ul>
        </Container>
      </div>

      <Container>
        <Section className="grid items-start gap-10 lg:grid-cols-[1fr_348px]">
          <div className="flex flex-col gap-10">
            {/* MN-09 · antes, sin foto, esto era `null`: la ficha se quedaba
                literalmente SIN portada y arrancaba en "Qué vas a conquistar",
                así que la misma mentoría se veía con cabecera en el catálogo y
                sin ella al abrirla. Ahora se pinta siempre, con la caja del
                Figma (764×360) y el mismo relleno que las tarjetas. */}
            <ProductCover
              product={product}
              width={764}
              height={360}
              className="aspect-[764/360] rounded-[16px]"
              priority
            />

            {product.description ? (
              <div>
                <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                  Qué vas a conquistar
                </h2>
                {bullets ? (
                  <ul className="mt-3.5 flex flex-col gap-3">
                    {bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3">
                        <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full bg-[#e0f0ff] text-brand">
                          <CheckIcon className="size-3.5" strokeWidth={3} />
                        </span>
                        <span className="text-[15px] text-[#4d4d4d]">{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3.5 text-pretty text-[15px] text-[#4d4d4d]">
                    {product.description}
                  </p>
                )}
              </div>
            ) : null}

            {/* Requerimientos de sesión — lo que el alumno tiene que TRAER.

                Va justo detrás de "Qué vas a conquistar" y por delante de "Cómo
                funciona": las dos primeras responden a "¿esto es para mí?", y
                esta es la mitad que puede contestar que NO —quien no tiene
                portátil necesita saberlo aquí, no a los diez minutos de pagar—.
                Por eso está por encima del panel de reserva en móvil y no al
                final con las FAQ.

                Sin requisitos NO se pinta nada: no hay lista genérica de
                plataforma a la que caer (a diferencia de las FAQ). Anunciar
                condiciones que el tutor no puso sería peor que callar. */}
            {product.requirements.length > 0 ? (
              <div>
                <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                  Qué necesitas para la sesión
                </h2>
                <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
                  Tenlo listo antes de tu primera clase.
                </p>
                <ul className="mt-3.5 flex flex-col gap-3">
                  {product.requirements.map((r, i) => (
                    // La clave lleva el índice porque los requisitos no se
                    // deduplican: dos iguales compartirían `key` y React
                    // tiraría uno. Mismo criterio que las FAQ de más abajo.
                    <li key={`${i}-${r}`} className="flex items-start gap-3">
                      {/* Viñeta y no el check de "Qué vas a conquistar": allí
                          el tick significa "esto te llevas", y aquí leería
                          como "esto ya lo tienes", que es justo lo contrario de
                          lo que la lista está pidiendo. Se conserva la caja de
                          22 px para que las dos listas queden alineadas. */}
                      <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full bg-brand-muted">
                        <span className="size-1.5 rounded-full bg-brand" />
                      </span>
                      <span className="text-[15px] text-[#4d4d4d]">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* "Qué incluye el paquete" del Figma pide una segunda lista que el
                modelo no tiene: `products` guarda un solo texto libre. Queda
                como hueco de datos, no se rellena con contenido inventado. */}

            <div>
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Cómo funciona
              </h2>
              <p className="mt-3.5 text-pretty text-[15px] text-[#525252]">
                {HOW_IT_WORKS}
              </p>
            </div>

            <div>
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">Tu tutor</h2>
              <div className="mt-3.5 flex flex-wrap items-center gap-4 rounded-[16px] border border-[#e6e6e6] p-[18px]">
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold">
                  {tutorAvatar ? (
                    <Image
                      src={tutorAvatar}
                      alt=""
                      width={56}
                      height={56}
                      className="size-14 object-cover"
                      unoptimized
                    />
                  ) : (
                    initialsFrom(tutorName)
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold text-[#262626]">
                    {tutorName} · Tutor verificado
                  </p>
                  {product.tutor.headline ? (
                    <p className="mt-0.5 line-clamp-1 text-[13px] text-[#5c5c5c]">
                      {product.tutor.headline}
                    </p>
                  ) : null}
                  {reviews.length > 0 && product.tutor.ratingAvg ? (
                    <p className="mt-0.5 text-[13px] font-medium text-[#595959]">
                      ★ {product.tutor.ratingAvg.toFixed(1)} · {reviews.length}{" "}
                      {reviews.length === 1 ? "reseña" : "reseñas"}
                    </p>
                  ) : null}
                </div>
                <Button
                  asChild
                  variant="outline"
                  className="h-10 rounded-[8px] border-[1.5px] border-brand text-brand hover:bg-brand-muted hover:text-brand"
                >
                  <Link href={`/tutors/${product.tutor.id}`}>Ver perfil</Link>
                </Button>
              </div>
            </div>

            <div>
              {/* Las reseñas son del tutor (EP-09), no del producto: se dice. */}
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Reseñas del tutor
              </h2>
              <div className="mt-5">
                <ReviewsSummary reviews={reviews} />
              </div>
              {reviews.length > 0 ? (
                <hr className="my-5 border-[#e6e6e6]" />
              ) : null}
              <TutorReviews reviews={reviews} />
            </div>

            <div>
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Preguntas frecuentes
              </h2>
              {/* ponytail: `<details>` nativo, abiertos como en el resto del sitio. */}
              <div className="mt-2 divide-y divide-[#e6e6e6]">
                {faqs.map(({ q, a }, i) => (
                  // ⚠️ La clave lleva el índice porque las dos listas NO se
                  // deduplican: si el tutor repite la misma pregunta en su
                  // perfil y en la mentoría, `key={q}` sería la misma clave dos
                  // veces y React tira una de las dos.
                  <details key={`${i}-${q}`} open className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-[#292929] marker:hidden">
                      {q}
                      <ChevronDownIcon className="size-4 shrink-0 text-brand transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-1.5 pr-8 text-sm text-[#666666]">{a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>

          {/* El ancla es de MN-16 y sirve a quien llega de FUERA (los enlaces
              del carrito): aterriza en el panel y no al principio de la ficha.
              Para los controles del propio panel el hash era el problema —Next
              realineaba la vista bajo la cabecera en cada selección—, así que
              navegan con `scroll: false`. */}
          <div id="reservar">
            <BookingPanel
              products={[product]}
              selectedDay={sp.d}
              selectedTime={sp.h}
              timeZone={await getViewerTimezone()}
              details
              ctaLabel={
                product.pricingModel === "per_package"
                  ? "Reservar paquete YA"
                  : "Reservar mentoría YA"
              }
              note="Pago protegido · Datos cifrados"
              /* Aquí no hay `p`: la ficha de producto ya es de UNA mentoría, y
                 `BookingPanel` la da por elegida. Solo viajan día y hora.
                 `URLSearchParams` codifica el ISO de la hora (los `:` y el `+`
                 del offset); montarla a mano rompía la hora en algunos husos. */
              hrefFor={(next) => {
                const q = new URLSearchParams();
                if (next.d) q.set("d", next.d);
                if (next.h) q.set("h", next.h);
                const s = q.toString();
                return s
                  ? `/products/${id}?${s}#reservar`
                  : `/products/${id}#reservar`;
              }}
              footer={<CancellationPolicy className="mt-5" />}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
