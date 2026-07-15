import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { RatingStars } from "@/components/catalog/rating";
import { ReserveButton } from "@/components/catalog/reserve-button";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { getProductDetail } from "@/lib/catalog/queries";
import { priceLabel, initialsFrom } from "@/lib/catalog/format";
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

  const user = await getUser();

  return (
    <Container>
      <Section className="flex max-w-2xl flex-col gap-6">
        {product.categories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {product.categories.map((c) => (
              <Badge key={c.slug} asChild variant="secondary">
                <Link href={`/categories/${c.slug}`}>{c.name}</Link>
              </Badge>
            ))}
          </div>
        ) : null}

        <PageHeader
          title={product.title}
          description={product.outcome ?? undefined}
        />

        {product.description ? (
          <p className="text-muted-foreground text-pretty">
            {product.description}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm sm:max-w-sm">
          <div>
            <dt className="text-muted-foreground">Precio</dt>
            <dd className="font-medium">{priceLabel(product)}</dd>
          </div>
          {product.sessionDurationMin ? (
            <div>
              <dt className="text-muted-foreground">Duración</dt>
              <dd className="font-medium">{product.sessionDurationMin} min</dd>
            </div>
          ) : null}
        </dl>

        <Link
          href={`/tutors/${product.tutor.id}`}
          className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-ring"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {initialsFrom(product.tutor.headline)}
          </span>
          <div>
            <p className="font-medium">{product.tutor.headline ?? "Tutor"}</p>
            <RatingStars
              avg={product.tutor.ratingAvg}
              count={product.tutor.ratingCount}
            />
          </div>
        </Link>

        <div className="flex flex-col gap-2">
          <ReserveButton isAuthed={!!user} productId={product.id} />
          <CancellationPolicy compact />
        </div>
      </Section>
    </Container>
  );
}
