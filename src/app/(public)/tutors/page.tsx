import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { CategoryChips } from "@/components/catalog/category-chips";
import { Pager } from "@/components/catalog/pager";
import { TutorCard } from "@/components/catalog/tutor-card";
import { listApprovedTutors, listActiveCategories } from "@/lib/catalog/queries";

export const metadata = { title: "Explorar tutores · Enséñame Ya" };

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; page?: string }>;
}) {
  const { cat, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [{ tutors, hasMore }, categories] = await Promise.all([
    listApprovedTutors({ categorySlug: cat, page }),
    listActiveCategories(),
  ]);

  const catHref = (slug?: string) => (slug ? `/tutors?cat=${slug}` : "/tutors");
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (cat) p.set("cat", cat);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/tutors?${q}` : "/tutors";
  };

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Explorar tutores"
          description="Encuentra a tu tutor 1:1 y reserva una clase en vivo."
        />

        <CategoryChips categories={categories} activeSlug={cat} hrefFor={catHref} />

        {tutors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay tutores para este filtro todavía. Prueba con otra categoría.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tutors.map((t) => (
              <TutorCard key={t.id} tutor={t} />
            ))}
          </div>
        )}

        <Pager page={page} hasMore={hasMore} hrefFor={pageHref} />
      </Section>
    </Container>
  );
}
