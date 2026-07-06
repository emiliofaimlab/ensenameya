import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { CategoryChips } from "@/components/catalog/category-chips";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import { listActiveProducts, listActiveCategories } from "@/lib/catalog/queries";

export const metadata = { title: "Explorar clases · Enséñame Ya" };

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; page?: string }>;
}) {
  const { cat, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [{ products, hasMore }, categories] = await Promise.all([
    listActiveProducts({ categorySlug: cat, page }),
    listActiveCategories(),
  ]);

  const catHref = (slug?: string) => (slug ? `/classes?cat=${slug}` : "/classes");
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (cat) p.set("cat", cat);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/classes?${q}` : "/classes";
  };

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Explorar clases"
          description="Elige una tutoría y reserva tu clase 1:1 en vivo."
        />

        <CategoryChips categories={categories} activeSlug={cat} hrefFor={catHref} />

        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay clases para este filtro todavía. Prueba con otra categoría.
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
