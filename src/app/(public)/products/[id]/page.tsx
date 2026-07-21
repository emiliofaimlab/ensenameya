import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheckIcon, ClockIcon, TargetIcon, VideoIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RatingStars } from "@/components/catalog/rating";
import { ReserveButton } from "@/components/catalog/reserve-button";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { TutorReviews } from "@/components/catalog/tutor-reviews";
import { getProductDetail, listTutorReviews } from "@/lib/catalog/queries";
import {
  formatMoney,
  initialsFrom,
  modelLabel,
  perSessionLabel,
  sessionsLabel,
} from "@/lib/catalog/format";
import { getUser } from "@/lib/auth/server";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductDetail(id);
  if (!product) notFound();

  const [user, reviews] = await Promise.all([
    getUser(),
    listTutorReviews(product.tutor.id),
  ]);

  const sessions = sessionsLabel(product);
  const perSession = perSessionLabel(product);

  return (
    <>
      <div className="bg-brand text-white">
        <Container className="py-10">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/80">
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link href="/classes" className="hover:underline">
              Productos
            </Link>
            {" / "}
            <span className="text-white">{product.title}</span>
          </nav>

          <h1 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {product.title}
          </h1>
          {product.outcome ? (
            <p className="mt-3 max-w-3xl text-pretty text-white/90">
              {product.outcome}
            </p>
          ) : null}

          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium">
            <li className="flex items-center gap-1.5">
              <VideoIcon className="size-4" /> En vivo 1 a 1
            </li>
            {sessions ? (
              <li className="flex items-center gap-1.5">
                <TargetIcon className="size-4" /> {sessions}
              </li>
            ) : null}
            {product.sessionDurationMin ? (
              <li className="flex items-center gap-1.5">
                <ClockIcon className="size-4" />
                {product.sessionDurationMin} min por sesión
              </li>
            ) : null}
          </ul>
        </Container>
      </div>

      <Container>
        <Section className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-10">
            {product.categories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {product.categories.map((c) => (
                  <Badge key={c.slug} asChild variant="secondary">
                    <Link href={`/categories/${c.slug}`}>{c.name}</Link>
                  </Badge>
                ))}
              </div>
            ) : null}

            {/* Sin bloque "Lo que lograrás": el Figma lo llena con 4 viñetas
                inventadas y el único dato real (`outcome`) ya es el subtítulo
                del hero. Repetirlo palabra por palabra no informa de nada. */}
            {product.description ? (
              <div>
                <h2 className="text-xl font-bold">Cómo funciona</h2>
                <p className="mt-3 text-pretty text-muted-foreground">
                  {product.description}
                </p>
              </div>
            ) : null}

            <div>
              <h2 className="text-xl font-bold">Tu tutor</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[20px] border p-5">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-muted font-semibold">
                  {initialsFrom(product.tutor.headline)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-bold">
                    {product.tutor.headline ?? "Tutor"}
                    <BadgeCheckIcon className="size-4 text-brand" />
                  </p>
                  <RatingStars
                    avg={product.tutor.ratingAvg}
                    count={reviews.length}
                  />
                </div>
                <Button asChild variant="outline" className="h-10">
                  <Link href={`/tutors/${product.tutor.id}`}>Ver perfil</Link>
                </Button>
              </div>
            </div>

            <div>
              {/* Las reseñas son del tutor (EP-09), no del producto: se dice. */}
              <h2 className="text-xl font-bold">
                Reseñas del tutor
                {reviews.length > 0 ? ` (${reviews.length})` : ""}
              </h2>
              <div className="mt-4">
                <TutorReviews reviews={reviews} />
              </div>
            </div>
          </div>

          {/* El Figma pone aquí selectores de fecha y horario: esa elección vive
              en el flujo de reserva (AL04), que consulta disponibilidad real. */}
          <aside className="rounded-[20px] border bg-card p-6 lg:sticky lg:top-24">
            <p className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">
                {formatMoney(product.priceAmount, product.currency)}
              </span>
              <span className="text-sm text-muted-foreground">
                · {modelLabel(product).toLowerCase()}
              </span>
            </p>
            {perSession ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {perSession}
              </p>
            ) : null}
            {product.sessionDurationMin ? (
              <p className="mt-2 text-sm text-muted-foreground">
                En vivo 1 a 1 · {product.sessionDurationMin} min por sesión
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3">
              <ReserveButton isAuthed={!!user} productId={product.id} />
              <CancellationPolicy />
            </div>
          </aside>
        </Section>
      </Container>
    </>
  );
}
