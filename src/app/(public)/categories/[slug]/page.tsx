import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import { TutorCard } from "@/components/catalog/tutor-card";
import {
  MODELS,
  PRICE_RANGES,
  SESSION_RANGES,
  ProductFilters,
  type ProductFilterState,
} from "@/components/catalog/product-filters";
import {
  getCategoryBySlug,
  listActiveCategories,
  listActiveProducts,
  listApprovedTutors,
} from "@/lib/catalog/queries";
import type { Database } from "@/lib/database.types";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

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
  searchParams: Promise<{
    page?: string;
    tab?: string;
    model?: string;
    price?: string;
    sessions?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const tab = sp.tab === "tutores" ? "tutores" : "productos";

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const active: ProductFilterState = {
    model: MODELS.some((m) => m.id === sp.model) ? sp.model : undefined,
    price: sp.price,
    sessions: sp.sessions,
  };
  const price = PRICE_RANGES.find((r) => r.id === active.price);
  const sessions = SESSION_RANGES.find((r) => r.id === active.sessions);

  const [products, tutors, categories] = await Promise.all([
    listActiveProducts({
      categorySlug: slug,
      model: active.model as PricingModel | undefined,
      minPriceMinor: price?.min,
      maxPriceMinor: price?.max,
      minSessions: sessions?.min,
      maxSessions: sessions?.max,
      page: tab === "productos" ? page : 1,
    }),
    listApprovedTutors({
      categorySlug: slug,
      page: tab === "tutores" ? page : 1,
    }),
    listActiveCategories(),
  ]);

  const buildHref = (
    next: ProductFilterState & { page?: number; tab?: string },
  ) => {
    const p = new URLSearchParams();
    if (next.tab && next.tab !== "productos") p.set("tab", next.tab);
    for (const key of ["model", "price", "sessions"] as const) {
      if (next[key]) p.set(key, next[key]!);
    }
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `/categories/${slug}?${q}` : `/categories/${slug}`;
  };

  return (
    <>
      <section className="relative isolate overflow-hidden text-white">
        <Image
          src="/img/hero-category.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-black/60" />

        <Container className="py-12">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/80">
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link href="/categories" className="hover:underline">
              Categorías
            </Link>
            {" / "}
            <span className="text-white">{category.name}</span>
          </nav>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-primary sm:text-[36px]">
            Explorar {category.name}
          </h1>
          <p className="mt-3 max-w-3xl text-pretty text-white/90">
            Asegura los resultados que deseas de la mano de mentores validados,
            enfocados en lo que quieres conquistar.
          </p>

          <dl className="mt-6 flex flex-wrap gap-8">
            <div>
              <dt className="sr-only">Tutores</dt>
              <dd>
                <span className="text-[17px] font-bold">{tutors.total}</span>{" "}
                <span className="text-sm text-white/85">
                  {tutors.total === 1 ? "tutor" : "tutores"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Mentorías</dt>
              <dd>
                <span className="text-[17px] font-bold">{products.total}</span>{" "}
                <span className="text-sm text-white/85">
                  {products.total === 1 ? "mentoría" : "mentorías"}
                </span>
              </dd>
            </div>
          </dl>

          <form action="/search" className="mt-6 flex max-w-2xl gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder={`Busca una meta, tutor o mentoría de ${category.name}…`}
                aria-label={`Buscar en ${category.name}`}
                className="h-11 w-full rounded-[10px] bg-background pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
            <Button type="submit" className="h-11 rounded-[10px] px-6">
              Buscar
            </Button>
          </form>
        </Container>
      </section>

      <Container>
        <Section>
          {/* Pestañas como enlaces: el estado va en la URL, sin JS. */}
          <div
            role="tablist"
            aria-label="Resultados"
            className="flex gap-1 border-b"
          >
            {[
              { id: "productos", label: "Mentorías", n: products.total },
              { id: "tutores", label: "Tutores", n: tutors.total },
            ].map((t) => (
              <Link
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                href={buildHref({ ...active, tab: t.id })}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "border-brand text-brand"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label} ({t.n})
              </Link>
            ))}
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-[248px_1fr]">
            {tab === "productos" ? (
              <ProductFilters
                categories={categories.filter((c) => c.slug === slug)}
                active={active}
                hrefFor={(next) => buildHref({ ...next, tab })}
              />
            ) : (
              <div />
            )}

            <div>
              {tab === "productos" ? (
                products.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aún no hay mentorías en esta categoría.
                  </p>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {products.products.map((p) => (
                      <ProductCard key={p.id} product={p} />
                    ))}
                  </div>
                )
              ) : tutors.tutors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay tutores en esta categoría.
                </p>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {tutors.tutors.map((t) => (
                    <TutorCard key={t.id} tutor={t} />
                  ))}
                </div>
              )}

              <Pager
                page={page}
                hasMore={
                  tab === "productos" ? products.hasMore : tutors.hasMore
                }
                hrefFor={(n) => buildHref({ ...active, tab, page: n })}
              />
            </div>
          </div>
        </Section>
      </Container>
    </>
  );
}
