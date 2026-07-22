import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheckIcon, StarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { ProductCard } from "@/components/catalog/product-card";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { TutorReviews } from "@/components/catalog/tutor-reviews";
import { getTutorDetail, listTutorReviews } from "@/lib/catalog/queries";
import { formatMoney, initialsFrom } from "@/lib/catalog/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getTutorDetail(id);
  return {
    title: data ? `${data.tutor.headline ?? "Tutor"} · Enséñame Ya` : "Tutor",
  };
}

export default async function TutorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, reviews] = await Promise.all([
    getTutorDetail(id),
    listTutorReviews(id),
  ]);
  if (!data) notFound();
  const { tutor, products } = data;

  // "Desde X" y "Lo que enseño" se derivan de sus productos activos.
  const cheapest = products.reduce<(typeof products)[number] | null>(
    (min, p) => (!min || p.priceAmount < min.priceAmount ? p : min),
    null,
  );
  const topics = [
    ...new Map(
      products.flatMap((p) => p.categories.map((c) => [c.slug, c])),
    ).values(),
  ];

  return (
    <>
      <div className="bg-brand text-white">
        <Container className="py-10">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/80">
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link href="/tutors" className="hover:underline">
              Tutores
            </Link>
            {" / "}
            <span className="text-white">{tutor.headline ?? "Tutor"}</span>
          </nav>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-white/15 text-lg font-semibold">
              {initialsFrom(tutor.headline)}
            </span>
            <div>
              {/* El nombre real no es público: manda el headline (US-301). */}
              <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
                {tutor.headline ?? "Tutor"}
              </h1>
              <p className="mt-1 flex items-center gap-1 text-xs text-white/85">
                <BadgeCheckIcon className="size-4" />
                Tutor verificado
              </p>
            </div>
          </div>

          {/* Mismo criterio que el título de "Reseñas": manda lo que se puede
              mostrar, no `rating_count`. Con un rating sembrado y cero reseñas
              visibles, el hero anunciaba "4.9 · 37 reseñas" sobre una lista
              vacía dos pantallas más abajo. */}
          {reviews.length > 0 && tutor.ratingAvg ? (
            <p className="mt-5 flex items-center gap-2 text-sm">
              <StarIcon className="size-4 fill-primary text-primary" />
              <span className="font-bold">{tutor.ratingAvg.toFixed(1)}</span>
              <span className="text-white/85">
                {reviews.length}{" "}
                {reviews.length === 1 ? "reseña" : "reseñas"}
              </span>
            </p>
          ) : null}
        </Container>
      </div>

      <Container>
        <Section className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-10">
            <div>
              <h2 className="text-xl font-bold">Sobre mí</h2>
              <p className="mt-3 text-pretty text-muted-foreground">
                {tutor.bio ?? "Este tutor aún no escribió su biografía."}
              </p>
            </div>

            {topics.length > 0 ? (
              <div>
                <h2 className="text-xl font-bold">Lo que enseño</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {topics.map((c) => (
                    <Badge key={c.slug} variant="secondary">
                      {c.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <h2 className="text-xl font-bold">Sus mentorías</h2>
              {products.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Este tutor aún no publicó mentorías.
                </p>
              ) : (
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              )}
            </div>

            <div>
              {/* El contador sale de las reseñas QUE SE MUESTRAN, no de
                  `rating_count`: si no, un rating sembrado (o reseñas purgadas)
                  anuncia "Reseñas (37)" sobre una lista vacía. */}
              <h2 className="text-xl font-bold">
                Reseñas{reviews.length > 0 ? ` (${reviews.length})` : ""}
              </h2>
              <div className="mt-4">
                <TutorReviews reviews={reviews} />
              </div>
            </div>
          </div>

          {/* Tarjeta lateral. El Figma pone aquí un calendario con horarios: eso
              vive en el flujo de reserva (AL04), que necesita un producto
              elegido para consultar disponibilidad. */}
          <aside className="rounded-[20px] border bg-card p-6 lg:sticky lg:top-24">
            {cheapest ? (
              <>
                <p className="text-3xl font-bold">
                  {formatMoney(cheapest.priceAmount, cheapest.currency)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Reserva una sesión suelta o un paquete con descuento.
                </p>
                <Button asChild className="mt-5 h-11 w-full">
                  <Link href={`/reservar/${cheapest.id}`}>Reservar mentoría</Link>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Este tutor aún no tiene mentorías disponibles para reservar.
              </p>
            )}
            <CancellationPolicy className="mt-6" />
          </aside>
        </Section>
      </Container>
    </>
  );
}
