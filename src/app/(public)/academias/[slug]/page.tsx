import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BuildingIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  StarIcon,
  UsersIcon,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { ProductCard } from "@/components/catalog/product-card";
import { ShareButton } from "@/components/catalog/share-button";
import { TutorCard } from "@/components/catalog/tutor-card";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import { PrecioEnLinea } from "@/components/precio/precio";
import { getAcademyDetail } from "@/lib/catalog/queries";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getAcademyDetail(slug);
  if (!data) return { title: "Academia" };

  const { academy } = data;
  const logo = storageUrl("avatars", academy.logoPath);
  const description =
    academy.tagline ??
    `${academy.tutorCount} tutores y ${academy.productCount} mentorías en Enséñame Ya.`;

  return {
    title: `${academy.name} · Enséñame Ya`,
    description,
    openGraph: {
      title: academy.name,
      description,
      type: "website",
      images: logo ? [logo] : undefined,
    },
  };
}

/**
 * P-ACA-02 · ficha pública de una academia aliada.
 *
 * Reúne lo que ya existe —sus tutores, las mentorías de esos tutores y las
 * reseñas de sus alumnos— bajo una marca. **No hay nada nuevo detrás**: la
 * academia no cobra, no recibe payouts y no tiene mentorías propias, y quien
 * reserva aquí crea el mismo `booking` contra el mismo tutor que si hubiera
 * entrado por `/tutors` (`docs/B2B-ACADEMIAS.md`).
 *
 * ⚠️ Las mentorías enlazan a `/products/<id>`, la ficha PÚBLICA, y no a
 * `/reservar/<id>`: esa vive en `(app)`, detrás de una guarda, y enlazarla a
 * mano desde `(public)` es justo lo que deja la pantalla en blanco con el
 * router pidiendo el RSC en bucle (regla de oro 13, mordió dos veces el
 * 11-sep). El panel de reserva está en esa ficha, que es el camino de todo el
 * catálogo.
 */
export default async function AcademyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getAcademyDetail(slug);
  // `notFound()` y no un 403: para un visitante anónimo una academia en
  // borrador no existe, y decirle «existe pero no puedes verla» filtra que
  // estamos preparando una.
  if (!data) notFound();

  const { academy, tutors, products, reviews } = data;
  const logo = storageUrl("avatars", academy.logoPath);
  const marca = academy.brandColor ?? "var(--color-brand)";

  return (
    <div style={{ "--marca": marca } as React.CSSProperties}>
      {/* El hero mantiene el azul de Enséñame Ya y la academia pone su color
          como ACENTO (aro del logo, cifras, títulos de sección). Al revés
          —fondo del color que teclee la academia— el texto blanco encima
          dejaría de ser legible en cuanto alguien eligiera un tono claro. */}
      <div className="bg-brand bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-8 sm:py-12">
          <nav
            aria-label="Miga de pan"
            className="truncate text-[11px] text-white/85 sm:text-[13px]"
          >
            <Link href="/" className="inline-block py-3 -my-3 hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link
              href="/academias"
              className="inline-block py-3 -my-3 hover:underline"
            >
              Academias
            </Link>
            {" / "}
            <span>{academy.name}</span>
          </nav>

          <div className="mt-4 flex flex-col items-center text-center sm:flex-row sm:items-start sm:gap-6 sm:text-start">
            <span className="grid size-[88px] shrink-0 place-items-center overflow-hidden rounded-[20px] border-4 border-white/80 bg-white text-[30px] font-bold text-(--marca) lg:size-[112px]">
              {logo ? (
                <Image
                  src={logo}
                  alt=""
                  width={112}
                  height={112}
                  className="size-[88px] object-cover lg:size-[112px]"
                  unoptimized
                />
              ) : (
                initialsFrom(academy.name)
              )}
            </span>

            <div className="min-w-0 flex-1 max-sm:mt-4">
              <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                <h1 className="min-w-0 text-[22px] leading-tight font-bold break-words lg:text-[28px]">
                  {academy.name}
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[12px] font-semibold">
                  <BuildingIcon className="size-3.5" />
                  Academia aliada
                </span>
              </div>

              {academy.tagline ? (
                <p className="mt-2 max-w-2xl text-pretty text-[15px] text-white/90">
                  {academy.tagline}
                </p>
              ) : null}

              {/* La tira de cifras. Cada una sale ya agregada de
                  `academies_public`, no de contar en el navegador. */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px] font-medium sm:justify-start">
                <span className="inline-flex items-center gap-1.5">
                  <UsersIcon className="size-4 text-white/80" />
                  {academy.tutorCount === 1
                    ? "1 tutor"
                    : `${academy.tutorCount} tutores`}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCapIcon className="size-4 text-white/80" />
                  {academy.productCount === 1
                    ? "1 mentoría"
                    : `${academy.productCount} mentorías`}
                </span>
                {academy.ratingAvg !== null && academy.ratingCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <StarIcon className="size-4 fill-white text-white" />
                    {academy.ratingAvg.toFixed(1)}
                    <span className="text-white/80">
                      ({academy.ratingCount})
                    </span>
                  </span>
                ) : null}
                {academy.priceFromMinor !== null && academy.priceCurrency ? (
                  <span className="inline-flex items-center gap-1.5">
                    Desde{" "}
                    <PrecioEnLinea
                      amountMinor={academy.priceFromMinor}
                      currency={academy.priceCurrency}
                    />
                  </span>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                <Link
                  href="#mentorias"
                  className="inline-flex h-10 items-center rounded-[10px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground hover:opacity-95"
                >
                  Ver mentorías
                </Link>
                <ShareButton
                  label="Compartir academia"
                  title={academy.name}
                  text={academy.tagline ?? undefined}
                  className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                />
                {academy.website ? (
                  <a
                    href={academy.website}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-white/90 hover:underline"
                  >
                    Sitio web
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </Container>
      </div>

      <Container>
        {academy.description ? (
          <Section className="max-w-3xl">
            <h2 className="text-[20px] font-bold text-[#212121]">
              Sobre {academy.name}
            </h2>
            <p className="mt-3 text-pretty text-[15px] leading-relaxed whitespace-pre-line text-[#525252]">
              {academy.description}
            </p>
          </Section>
        ) : null}

        <Section className="border-t border-[#ebebeb]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-bold text-[#212121]">
              Tutores de la academia
            </h2>
            <span className="text-[13.5px] text-[#666666]">
              {tutors.length === 1
                ? "1 tutor verificado"
                : `${tutors.length} tutores verificados`}
            </span>
          </div>

          {tutors.length === 0 ? (
            <p className="mt-4 text-[15px] text-[#525252]">
              Esta academia todavía no tiene tutores aprobados.
            </p>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {tutors.map((t) => (
                <TutorCard key={t.id} tutor={t} layout="list" />
              ))}
            </div>
          )}
        </Section>

        {/* `scroll-mt`: el ancla del hero no puede dejar el título debajo de la
            cabecera pegajosa. */}
        <Section id="mentorias" className="scroll-mt-20 border-t border-[#ebebeb]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-bold text-[#212121]">
              Mentorías disponibles
            </h2>
            <span className="text-[13.5px] text-[#666666]">
              De más económica a más cara
            </span>
          </div>

          {products.length === 0 ? (
            <p className="mt-4 text-[15px] text-[#525252]">
              Todavía no hay mentorías publicadas en esta academia.
            </p>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} action="ver" />
              ))}
            </div>
          )}
        </Section>

        {reviews.length > 0 ? (
          <Section className="border-t border-[#ebebeb]">
            <h2 className="text-[20px] font-bold text-[#212121]">
              Lo que dicen sus alumnos
            </h2>
            {/* `avg` y `count` salen de la vista —la media PONDERADA de sus
                tutores y el total real— y no de las reseñas cargadas, que se
                cortan en 50: calcularlos aquí haría mentir a la cifra en cuanto
                una academia pase de ese tope. */}
            <div className="mt-5">
              <ReviewsSummary
                reviews={reviews}
                avg={academy.ratingAvg ?? undefined}
                count={academy.ratingCount || undefined}
              />
            </div>
            {/* `withContext`: en una academia cada reseña puede ser de una
                mentoría distinta y de un tutor distinto, así que decir de cuál
                habla no es un extra, es lo que la hace legible. */}
            <div className="mt-6">
              <TutorReviews reviews={reviews} visible={3} withContext />
            </div>
          </Section>
        ) : null}
      </Container>
    </div>
  );
}
