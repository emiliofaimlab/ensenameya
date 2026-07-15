import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import { getCategoryBySlug, listActiveProducts } from "@/lib/catalog/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  return { title: category ? `${category.name} · Enséñame Ya` : "Categoría" };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const { products, hasMore } = await listActiveProducts({
    categorySlug: slug,
    page,
  });

  const pageHref = (n: number) =>
    n > 1 ? `/categories/${slug}?page=${n}` : `/categories/${slug}`;

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title={category.name}
          description="Clases en esta categoría."
        />

        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay clases en esta categoría.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}

        <Pager page={page} hasMore={hasMore} hrefFor={pageHref} />
      </Section>
    </Container>
  );
}
