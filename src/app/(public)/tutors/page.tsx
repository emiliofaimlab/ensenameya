import Link from "next/link";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Pager } from "@/components/catalog/pager";
import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import { TutorCard } from "@/components/catalog/tutor-card";
import { TutorFilters } from "@/components/catalog/tutor-filters";
import {
  listApprovedTutors,
  listActiveCategories,
  type AvailabilityFilter,
  type TutorSort,
} from "@/lib/catalog/queries";

export const metadata = { title: "Explorar tutores · Enséñame Ya" };

const PAGE_SIZE = 12;

const SORTS: { value: TutorSort; label: string }[] = [
  { value: "rating", label: "Mejor valorados" },
  { value: "reviews", label: "Más reseñas" },
];

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    page?: string;
    rating?: string;
    avail?: string;
    sort?: string;
  }>;
}) {
  const {
    cat,
    page: pageParam,
    rating: ratingParam,
    avail: availParam,
    sort: sortParam,
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const minRating = Number(ratingParam) || undefined;
  const availability = (["today", "week", "weekend"] as const).find(
    (v) => v === availParam,
  );
  const sort = (["rating", "reviews"] as const).find((v) => v === sortParam);

  const [{ tutors, hasMore, total }, categories] = await Promise.all([
    listApprovedTutors({
      categorySlug: cat,
      minRating,
      availability,
      sort,
      page,
    }),
    listActiveCategories(),
  ]);

  /** Todos los filtros viven en la URL; al cambiar uno se vuelve a la página 1. */
  const buildHref = (next: {
    cat?: string;
    rating?: number;
    avail?: AvailabilityFilter;
    sort?: TutorSort;
    page?: number;
  }) => {
    const p = new URLSearchParams();
    if (next.cat) p.set("cat", next.cat);
    if (next.rating) p.set("rating", String(next.rating));
    if (next.avail) p.set("avail", next.avail);
    if (next.sort) p.set("sort", next.sort);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `/tutors?${q}` : "/tutors";
  };

  const current = { cat, rating: minRating, avail: availability, sort };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-12">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-2xl font-bold sm:text-3xl">Explorar Tutores</h1>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-semibold">
              <span className="size-1.5 rounded-full bg-white" />
              {total} {total === 1 ? "tutor verificado" : "tutores verificados"}
            </span>
          </div>
          <p className="mt-4 max-w-3xl text-pretty text-[15px] text-white/90">
            Encuentra a tu mentor ideal y asegura el resultado que buscas.
            Conéctate con expertos verificados de toda Latinoamérica listos para
            transformar tu forma de aprender en vivo.
          </p>

          {/* La búsqueda por texto vive en /search (US-303), pero acotada a
              TUTORES: si buscas desde este módulo no quieres ver clases ni
              categorías mezcladas (24-jul). Sin desplegable a propósito. */}
          <form action="/search" className="mt-6 flex gap-2.5">
            <input type="hidden" name="tab" value="tutores" />
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder="¿Qué habilidad pro vas a dominar hoy? (ej. hablar inglés, programar desde cero…)"
                aria-label="¿Qué habilidad pro vas a dominar hoy?"
                className="h-[47px] w-full rounded-[10px] border border-[#d9d9d9] bg-background pr-3 pl-10 text-sm text-foreground placeholder:text-[#5c5c5c] focus-visible:outline-none"
              />
            </div>
            <Button type="submit" className="h-[47px] rounded-[10px] px-6">
              Buscar
            </Button>
          </form>

          <CategoryIconChips
            className="mt-4"
            categories={categories}
            activeSlug={cat}
            hrefFor={(slug) =>
              buildHref({ ...current, cat: slug === cat ? undefined : slug })
            }
          />
        </Container>
      </div>

      <Container>
        <Section className="grid gap-8 lg:grid-cols-[248px_1fr]">
          <TutorFilters
            categories={categories}
            activeSlug={cat}
            minRating={minRating}
            availability={availability}
            hrefFor={(next) => buildHref({ sort, ...next })}
          />

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[15px] font-medium text-[#666666]">
                {total}{" "}
                {total === 1 ? "tutor disponible" : "tutores disponibles"}
              </p>

              {/* ponytail: `<details>` nativo — el desplegable del Figma sin JS
                  ni componente de cliente; cada opción es un enlace. */}
              <details name="orden" className="group relative">
                <summary className="flex h-[38px] cursor-pointer list-none items-center gap-1.5 rounded-[8px] border border-[#d1d1d1] px-3.5 text-[13.5px] font-medium text-[#474747] marker:hidden">
                  Ordenar:{" "}
                  {SORTS.find((s) => s.value === (sort ?? "rating"))!.label}
                  <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="absolute right-0 z-10 mt-1 w-52 rounded-[8px] border bg-card p-1 shadow-md">
                  {SORTS.map((s) => (
                    <li key={s.value}>
                      <Link
                        href={buildHref({ ...current, sort: s.value })}
                        className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {tutors.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No hay tutores para este filtro todavía. Prueba con otra
                categoría.
              </p>
            ) : (
              <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {tutors.map((t) => (
                  <TutorCard key={t.id} tutor={t} />
                ))}
              </div>
            )}

            <Pager
              page={page}
              hasMore={hasMore}
              totalPages={totalPages}
              hrefFor={(n) => buildHref({ ...current, page: n })}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
