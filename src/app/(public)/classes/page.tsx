import Link from "next/link";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

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
import {
  listActiveProducts,
  listActiveCategories,
  type ProductSort,
} from "@/lib/catalog/queries";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Explorar mentorías · Enséñame Ya" };

type PricingModel = Database["public"]["Enums"]["pricing_model"];

const PAGE_SIZE = 12;

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "recent", label: "Más relevantes" },
  { value: "price_asc", label: "Precio: de menor a mayor" },
  { value: "price_desc", label: "Precio: de mayor a menor" },
];

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    model?: string;
    price?: string;
    sessions?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sort = SORTS.find((s) => s.value === sp.sort)?.value;
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
      sort,
      page,
    }),
    listActiveCategories(),
  ]);

  /** Estado en la URL; al cambiar cualquier filtro se vuelve a la página 1. */
  const buildHref = (
    next: ProductFilterState & { sort?: ProductSort; page?: number },
  ) => {
    const p = new URLSearchParams();
    for (const key of ["cat", "model", "price", "sessions"] as const) {
      if (next[key]) p.set(key, next[key]!);
    }
    if (next.sort) p.set("sort", next.sort);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `/classes?${q}` : "/classes";
  };

  return (
    <>
      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-12">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-2xl font-bold sm:text-3xl">
              Explorar Mentorías
            </h1>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-semibold">
              <span className="size-1.5 rounded-full bg-white" />
              {total} {total === 1 ? "resultado" : "resultados"} con objetivo
              claro
            </span>
          </div>
          <p className="mt-4 max-w-3xl text-pretty text-[15px] text-white/90">
            Elige el servicio ideal para ti y asegura el resultado que buscas
            hoy. Clases, mentorías y paquetes con una meta clara, medible y
            diseñada para tu éxito.
          </p>

          <form action="/search" className="mt-6 flex gap-2.5">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder="¿Qué resultado vas a lograr hoy? (ej. hablar inglés, aprobar cálculo…)"
                aria-label="¿Qué resultado vas a lograr hoy?"
                className="h-[47px] w-full rounded-[10px] border border-[#d9d9d9] bg-background pr-3 pl-10 text-sm text-foreground placeholder:text-[#5c5c5c] focus-visible:outline-none"
              />
            </div>
            <Button type="submit" className="h-[47px] rounded-[10px] px-6">
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
                  className={`inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors ${
                    active.model === m.id
                      ? "border-brand bg-brand text-white"
                      : "border-[#b2d9ff] bg-card text-brand hover:bg-brand-muted"
                  }`}
                >
                  {m.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/categories"
                className="inline-flex h-9 items-center rounded-full border border-[#b2d9ff] bg-card px-4 text-[13px] text-brand transition-colors hover:bg-brand-muted"
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
            hrefFor={(next) => buildHref({ ...next, sort })}
          />

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[15px] font-medium text-[#666666]">
                {total}{" "}
                {total === 1 ? "mentoría disponible" : "mentorías disponibles"}
              </p>

              {/* ponytail: `<details>` nativo, igual que en P04. */}
              <details className="group relative">
                <summary className="flex h-[38px] cursor-pointer list-none items-center gap-1.5 rounded-[8px] border border-[#d1d1d1] px-3.5 text-[13.5px] font-medium text-[#474747] marker:hidden">
                  Ordenar:{" "}
                  {SORTS.find((s) => s.value === (sort ?? "recent"))!.label}
                  <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="absolute right-0 z-10 mt-1 w-60 rounded-[8px] border bg-card p-1 shadow-md">
                  {SORTS.map((s) => (
                    <li key={s.value}>
                      <Link
                        href={buildHref({ ...active, sort: s.value })}
                        className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {products.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No hay mentorías para este filtro todavía. Prueba con otra
                categoría.
              </p>
            ) : (
              <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}

            <Pager
              page={page}
              hasMore={hasMore}
              totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              hrefFor={(n) => buildHref({ ...active, sort, page: n })}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
