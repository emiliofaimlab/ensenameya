import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import {
  MODELS,
  PRICE_RANGES,
  SESSION_RANGES,
  ProductFilters,
  type ProductFilterState,
} from "@/components/catalog/product-filters";
import { listActiveProducts, listActiveCategories } from "@/lib/catalog/queries";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Explorar mentorías · Enséñame Ya" };

type PricingModel = Database["public"]["Enums"]["pricing_model"];

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    model?: string;
    price?: string;
    sessions?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const active: ProductFilterState = {
    cat: sp.cat,
    model: MODELS.some((m) => m.id === sp.model) ? sp.model : undefined,
    price: sp.price,
    sessions: sp.sessions,
  };

  const price = PRICE_RANGES.find((r) => r.id === active.price);
  const sessions = SESSION_RANGES.find((r) => r.id === active.sessions);

  const [{ products, hasMore, total }, categories] = await Promise.all([
    listActiveProducts({
      categorySlug: active.cat,
      model: active.model as PricingModel | undefined,
      minPriceMinor: price?.min,
      maxPriceMinor: price?.max,
      minSessions: sessions?.min,
      maxSessions: sessions?.max,
      page,
    }),
    listActiveCategories(),
  ]);

  /** Estado en la URL; al cambiar cualquier filtro se vuelve a la página 1. */
  const buildHref = (next: ProductFilterState & { page?: number }) => {
    const p = new URLSearchParams();
    for (const key of ["cat", "model", "price", "sessions"] as const) {
      if (next[key]) p.set(key, next[key]!);
    }
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `/classes?${q}` : "/classes";
  };

  return (
    <>
      <div className="bg-brand text-white">
        <Container className="py-10">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Explorar mentorías
            </h1>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold">
              {total} {total === 1 ? "resultado" : "resultados"} con objetivo
              claro
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-pretty text-white/90">
            Elige el servicio ideal para ti y asegura el resultado que buscas
            hoy. Clases, mentorías y paquetes con una meta clara, medible y
            diseñada para tu éxito.
          </p>

          <form action="/search" className="mt-6 flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder="¿Qué resultado vas a lograr hoy? (ej. hablar inglés, aprobar cálculo…)"
                aria-label="¿Qué resultado vas a lograr hoy?"
                className="h-12 w-full rounded-[10px] bg-background pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
            <Button type="submit" className="h-12 rounded-[10px] px-6">
              Buscar
            </Button>
          </form>

          {/* Los chips del Figma ("Cursos", "Mentorías") no existen como dato:
              aquí van los modelos de precio reales (RN-10) + categorías. */}
          <ul className="mt-4 flex flex-wrap gap-2">
            {MODELS.map((m) => (
              <li key={m.id}>
                <Link
                  href={buildHref({
                    ...active,
                    model: active.model === m.id ? undefined : m.id,
                  })}
                  className={`inline-flex rounded-full border px-4 py-1.5 text-[13px] transition-colors ${
                    active.model === m.id
                      ? "border-white bg-white text-brand"
                      : "border-white/60 hover:bg-white/10"
                  }`}
                >
                  {m.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/categories"
                className="inline-flex rounded-full border border-white/60 px-4 py-1.5 text-[13px] transition-colors hover:bg-white/10"
              >
                Categorías
              </Link>
            </li>
          </ul>
        </Container>
      </div>

      <Container>
        <Section className="grid gap-8 lg:grid-cols-[248px_1fr]">
          <ProductFilters
            categories={categories}
            active={active}
            hrefFor={buildHref}
          />

          <div>
            <p className="text-[15px] font-medium">
              {total}{" "}
              {total === 1 ? "mentoría disponible" : "mentorías disponibles"}
            </p>

            {products.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No hay mentorías para este filtro todavía. Prueba con otra
                categoría.
              </p>
            ) : (
              <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}

            <Pager
              page={page}
              hasMore={hasMore}
              hrefFor={(n) => buildHref({ ...active, page: n })}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
