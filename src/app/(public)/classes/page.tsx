import Link from "next/link";
import { ArrowRightIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import {
  MODELS,
  PRICE_RANGES,
  SESSION_RANGES,
  LEVELS,
  LANGUAGES,
  ProductFilters,
  type ProductFilterState,
} from "@/components/catalog/product-filters";
import {
  listActiveProducts,
  listActiveCategories,
  type ProductSort,
  type TeachingLevel,
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
    level?: string;
    lang?: string;
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
    // DD-03: valor que no está en la lista = filtro ignorado (query libre).
    level: LEVELS.some((l) => l.id === sp.level) ? sp.level : undefined,
    lang: LANGUAGES.some((l) => l.id === sp.lang) ? sp.lang : undefined,
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
      level: active.level as TeachingLevel | undefined,
      language: active.lang,
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
    for (const key of ["cat", "model", "price", "sessions", "level", "lang"] as const) {
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
              Explorar mentorías
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

          {/* Acotada a MENTORÍAS: buscando desde este módulo no se quieren
              tutores ni categorías mezclados (24-jul). Sin desplegable. */}
          <form action="/search" className="mt-6 flex gap-2.5">
            <input type="hidden" name="tab" value="productos" />
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
              aquí van los modelos de precio reales (RN-10).

              "Categorías" NO es uno más de la fila: los tres primeros FILTRAN
              esta pantalla y aquél NAVEGA a otra. Con la misma píldora, el mismo
              borde y la misma lista, no había forma de saberlo. Ahora los
              filtros van rotulados y agrupados, y la navegación queda al otro
              lado de un separador y con cara de enlace. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                id="tipo-mentoria"
                className="text-[13px] font-medium text-white/85"
              >
                Tipo de mentoría:
              </span>
              <ul
                aria-labelledby="tipo-mentoria"
                className="flex flex-wrap gap-2"
              >
                {MODELS.map((m) => {
                  const on = active.model === m.id;
                  return (
                    <li key={m.id}>
                      <Link
                        href={buildHref({
                          ...active,
                          model: on ? undefined : m.id,
                        })}
                        aria-pressed={on}
                        className={`inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors ${
                          on
                            ? "border-white bg-white font-semibold text-brand"
                            : "border-white/60 bg-transparent text-white hover:bg-white/15"
                        }`}
                      >
                        {m.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            <span aria-hidden className="hidden h-6 w-px bg-white/35 sm:block" />

            <Link
              href="/categories"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white underline-offset-4 hover:underline"
            >
              Explorar por categoría
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
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
                {total === 1
                  ? "tutoría lista para reservar"
                  : "tutorías listas para reservar"}
              </p>

              {/* ponytail: `<details>` nativo, igual que en P04. `name` lo marca
                  como desplegable: se cierra fuera/Escape/al elegir. */}
              <details name="orden" className="group relative">
                <summary className="flex h-[38px] cursor-pointer list-none items-center gap-1.5 rounded-[8px] border border-[#d1d1d1] px-3.5 text-[13.5px] font-medium text-[#474747] marker:hidden">
                  Ordenar por:{" "}
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
