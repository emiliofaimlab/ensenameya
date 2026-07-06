import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductCard } from "@/components/catalog/product-card";
import { searchProducts, listActiveCategories } from "@/lib/catalog/queries";

export const metadata = { title: "Buscar · Enséñame Ya" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const [products, categories] = await Promise.all([
    query ? searchProducts(query) : Promise.resolve([]),
    listActiveCategories(),
  ]);

  const suggestions = (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => (
        <Badge key={c.slug} asChild variant="outline">
          <Link href={`/categories/${c.slug}`}>{c.name}</Link>
        </Badge>
      ))}
    </div>
  );

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Buscar"
          description="Encuentra clases por materia o palabra clave."
        />

        {/* Form GET nativo: navega a /search?q=… sin JS. */}
        <form action="/search" method="get" className="flex gap-2">
          <Input
            name="q"
            defaultValue={query}
            placeholder="¿Qué quieres aprender?"
            aria-label="Buscar"
          />
          <Button type="submit">Buscar</Button>
        </form>

        {!query ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Explora por categoría:</p>
            {suggestions}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Sin resultados para “{query}”. Prueba con otra palabra o explora por
              categoría:
            </p>
            {suggestions}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </Section>
    </Container>
  );
}
