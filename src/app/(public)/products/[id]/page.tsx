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
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import { getProductDetail, listTutorReviews } from "@/lib/catalog/queries";
import { initialsFrom, sessionsLabel, storageUrl } from "@/lib/catalog/format";

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
    q: "¿Cómo se imparten las clases en vivo?",
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
  return { title: product ? `${product.title} · Enséñame Ya` : "Clase" };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductDetail(id);
  if (!product) notFound();

  const reviews = await listTutorReviews(product.tutor.id);

  const sessions = sessionsLabel(product);
  const thumb = storageUrl("product-images", product.imagePath);
  const tutorName =
    product.tutor.displayName ?? product.tutor.headline ?? "Tutor";
  const tutorAvatar = storageUrl("avatars", product.tutor.avatarPath);
  const bullets = product.description ? toBullets(product.description) : null;

  const chips = [
    reviews.length > 0 && product.tutor.ratingAvg
      ? `★ ${product.tutor.ratingAvg.toFixed(1)} · ${reviews.length} ${
          reviews.length === 1 ? "reseña" : "reseñas"
        }`
      : null,
    sessions,
    "En vivo 1 a 1",
    product.sessionDurationMin
      ? `${product.sessionDurationMin} min por sesión`
      : null,
    // El chip "Nivel Universitario" del Figma es del PRODUCTO: DD-03 (`EY-113`),
    // que sigue abierta. `teaching_level` es del tutor, no de la mentoría.
  ].filter(Boolean) as string[];

  return (
    <>
      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-9">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/90">
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link href="/classes" className="hover:underline">
              Mentorías
            </Link>
            {" / "}
            <span>{product.title}</span>
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
            {thumb ? (
              <Image
                src={thumb}
                alt=""
                width={764}
                height={360}
                className="aspect-[764/360] w-full rounded-[16px] object-cover"
                unoptimized
                priority
              />
            ) : null}

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
                {(product.faqs.length > 0 ? product.faqs : PRODUCT_FAQ).map(({ q, a }) => (
                  <details key={q} open className="group py-4">
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

          <div>
            <BookingPanel
              products={[product]}
              selectedDay={sp.d}
              timeZone={await getViewerTimezone()}
              details
              ctaLabel={
                product.pricingModel === "per_package"
                  ? "Reservar paquete YA"
                  : "Reservar clase YA"
              }
              note="Pago protegido · Datos cifrados"
              hrefFor={(next) =>
                next.d ? `/products/${id}?d=${next.d}` : `/products/${id}`
              }
              footer={<CancellationPolicy className="mt-5" />}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
