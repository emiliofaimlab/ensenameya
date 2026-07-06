import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { listActiveCategories } from "@/lib/catalog/queries";

export const metadata = { title: "Categorías · Enséñame Ya" };

export default async function CategoriesPage() {
  const categories = await listActiveCategories();

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Categorías"
          description="Explora las clases por tema."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <Link key={c.slug} href={`/categories/${c.slug}`} className="group">
              <Card className="transition-colors group-hover:border-ring">
                <CardHeader>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </Container>
  );
}
