import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Pager } from "@/components/catalog/pager";
import { TutorCard } from "@/components/catalog/tutor-card";
import { TutorFilters } from "@/components/catalog/tutor-filters";
import { listApprovedTutors, listActiveCategories } from "@/lib/catalog/queries";

export const metadata = { title: "Explorar tutores · Enséñame Ya" };

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; page?: string; rating?: string }>;
}) {
  const { cat, page: pageParam, rating: ratingParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const minRating = Number(ratingParam) || undefined;

  const [{ tutors, hasMore, total }, categories] = await Promise.all([
    listApprovedTutors({ categorySlug: cat, minRating, page }),
    listActiveCategories(),
  ]);

  /** Todos los filtros viven en la URL; al cambiar uno se vuelve a la página 1. */
  const buildHref = (next: {
    cat?: string;
    rating?: number;
    page?: number;
  }) => {
    const p = new URLSearchParams();
    if (next.cat) p.set("cat", next.cat);
    if (next.rating) p.set("rating", String(next.rating));
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `/tutors?${q}` : "/tutors";
  };

  return (
    <>
      <div className="bg-brand text-white">
        <Container className="py-10">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Explorar tutores
            </h1>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold">
              {total} {total === 1 ? "tutor verificado" : "tutores verificados"}
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-pretty text-white/90">
            Encuentra a tu mentor ideal y asegura el resultado que buscas.
            Conéctate con expertos verificados de toda Latinoamérica listos para
            transformar tu forma de aprender en vivo.
          </p>

          {/* La búsqueda por texto vive en /search (US-303). */}
          <form action="/search" className="mt-6 flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder="¿Qué habilidad pro vas a dominar hoy? (ej. hablar inglés, programar desde cero…)"
                aria-label="¿Qué habilidad pro vas a dominar hoy?"
                className="h-12 w-full rounded-[10px] bg-background pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
            <Button type="submit" className="h-12 rounded-[10px] px-6">
              Buscar
            </Button>
          </form>

          <ul className="mt-4 flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={buildHref({
                    cat: c.slug === cat ? undefined : c.slug,
                    rating: minRating,
                  })}
                  className={`inline-flex rounded-full border px-4 py-1.5 text-[13px] transition-colors ${
                    c.slug === cat
                      ? "border-white bg-white text-brand"
                      : "border-white/60 hover:bg-white/10"
                  }`}
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </div>

      <Container>
        <Section className="grid gap-8 lg:grid-cols-[248px_1fr]">
          <TutorFilters
            categories={categories}
            activeSlug={cat}
            minRating={minRating}
            hrefFor={buildHref}
          />

          <div>
            <p className="text-[15px] font-medium">
              {total} {total === 1 ? "tutor disponible" : "tutores disponibles"}
            </p>

            {tutors.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No hay tutores para este filtro todavía. Prueba con otra
                categoría.
              </p>
            ) : (
              <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {tutors.map((t) => (
                  <TutorCard key={t.id} tutor={t} />
                ))}
              </div>
            )}

            <Pager
              page={page}
              hasMore={hasMore}
              hrefFor={(n) => buildHref({ cat, rating: minRating, page: n })}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
