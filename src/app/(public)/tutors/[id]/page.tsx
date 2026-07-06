import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { RatingStars } from "@/components/catalog/rating";
import { ProductCard } from "@/components/catalog/product-card";
import { getTutorDetail } from "@/lib/catalog/queries";
import { initialsFrom } from "@/lib/catalog/format";

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
  const data = await getTutorDetail(id);
  if (!data) notFound();
  const { tutor, products } = data;

  return (
    <Container>
      <Section className="flex flex-col gap-8">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold">
            {initialsFrom(tutor.headline)}
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {tutor.headline ?? "Tutor"}
            </h1>
            <RatingStars avg={tutor.ratingAvg} count={tutor.ratingCount} />
          </div>
        </div>

        {tutor.bio ? (
          <p className="max-w-2xl text-muted-foreground text-pretty">
            {tutor.bio}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Sus clases</h2>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este tutor aún no publicó clases.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </Section>
    </Container>
  );
}
