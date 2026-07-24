import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { categoryIcon } from "@/components/catalog/category-icons";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import { TutorCard } from "@/components/catalog/tutor-card";
import {
  MODELS,
  PRICE_RANGES,
  SESSION_RANGES,
  type ProductFilterState,
} from "@/components/catalog/product-filters";
import {
  getCategoryBySlug,
  listActiveCategories,
  listActiveProducts,
  listApprovedTutors,
  type ProductSort,
} from "@/lib/catalog/queries";
import type { Database } from "@/lib/database.types";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

const PAGE_SIZE = 12;

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "recent", label: "Más relevantes" },
  { value: "price_asc", label: "Precio: de menor a mayor" },
  { value: "price_desc", label: "Precio: de mayor a menor" },
];

/** Arte propia de la categoría. ponytail: es un asset de diseño, no dato de
 *  usuario — vive en `public/img/categories/{slug}.jpg` y no pide columna. */
const CATEGORY_HERO: Record<string, string> = {
  matematicas: "/img/categories/matematicas.jpg",
};

export type CategorySearchParams = {
  page?: string;
  tab?: string;
  model?: string;
  price?: string;
  sessions?: string;
  tema?: string;
  sort?: string;
};

/**
 * P06 · vista de categorías. Sirve a las **dos** rutas: `/categories` (sin
 * categoría fijada) y `/categories/[slug]` (con una activa). Es el mismo frame
 * del Figma — lo único que cambia es si hay categoría seleccionada, que ahí el
 * chip se despliega y el listado sale filtrado.
 */
export async function CategoryExplorer({
  slug,
  sp,
}: {
  slug?: string;
  sp: CategorySearchParams;
}) {
  const page = Math.max(1, Number(sp.page) || 1);
  const tab = sp.tab === "tutores" ? "tutores" : "productos";
  const sort = SORTS.find((s) => s.value === sp.sort)?.value;

  const category = slug ? await getCategoryBySlug(slug) : null;
  if (slug && !category) notFound();

  const active: ProductFilterState & { tema?: string } = {
    model: MODELS.some((m) => m.id === sp.model) ? sp.model : undefined,
    price: sp.price,
    sessions: sp.sessions,
    tema: sp.tema,
  };
  const price = PRICE_RANGES.find((r) => r.id === active.price);
  const sessions = SESSION_RANGES.find((r) => r.id === active.sessions);

  // Sin categoría en la ruta, "Temas" hace de filtro principal.
  const primary = slug ?? active.tema;
  const secondary = slug ? active.tema : undefined;

  const [products, tutors, categories] = await Promise.all([
    listActiveProducts({
      categorySlug: primary,
      // "Temas" cruza con otra categoría: `product_categories` es N–M, así que
      // una tutoría de Matemáticas puede estar también en Preparación de exámenes.
      secondCategorySlug: secondary,
      model: active.model as PricingModel | undefined,
      minPriceMinor: price?.min,
      maxPriceMinor: price?.max,
      minSessions: sessions?.min,
      maxSessions: sessions?.max,
      sort,
      page: tab === "productos" ? page : 1,
    }),
    listApprovedTutors({
      categorySlug: primary,
      page: tab === "tutores" ? page : 1,
    }),
    listActiveCategories(),
  ]);

  const base = slug ? `/categories/${slug}` : "/categories";
  const buildHref = (
    next: ProductFilterState & {
      tema?: string;
      sort?: ProductSort;
      page?: number;
      tab?: string;
    },
  ) => {
    const p = new URLSearchParams();
    if (next.tab && next.tab !== "productos") p.set("tab", next.tab);
    for (const key of ["model", "price", "sessions", "tema"] as const) {
      if (next[key]) p.set(key, next[key]!);
    }
    if (next.sort) p.set("sort", next.sort);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `${base}?${q}` : base;
  };

  const total = tab === "productos" ? products.total : tutors.total;
  const ratings = tutors.tutors
    .map((t) => t.ratingAvg)
    .filter((r): r is number => r !== null);
  const ratingAvg = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : null;

  const title = category ? `Explorar ${category.name}` : "Explorar Categorías";
  const description =
    category?.description ??
    (category
      ? "Asegura los resultados que deseas de la mano de mentores validados, enfocados en lo que quieres conquistar."
      : "Elige por dónde empezar. Cada categoría reúne tutorías con una meta concreta y tutores verificados listos para acompañarte en vivo.");

  /** Desplegables de filtro de la fila horizontal (386:1558). */
  const dropdowns = [
    {
      label: "Temas",
      current: categories.find((c) => c.slug === active.tema)?.name,
      options: categories
        .filter((c) => c.slug !== slug)
        .map((c) => ({
          label: c.name,
          href: buildHref({
            ...active,
            tab,
            sort,
            tema: active.tema === c.slug ? undefined : c.slug,
          }),
        })),
    },
    {
      label: "Precio",
      current: PRICE_RANGES.find((r) => r.id === active.price)?.label,
      options: PRICE_RANGES.map((r) => ({
        label: r.label,
        href: buildHref({
          ...active,
          tab,
          sort,
          price: active.price === r.id ? undefined : r.id,
        }),
      })),
    },
    {
      label: "Duración",
      current: SESSION_RANGES.find((r) => r.id === active.sessions)?.label,
      options: SESSION_RANGES.map((r) => ({
        label: r.label,
        href: buildHref({
          ...active,
          tab,
          sort,
          sessions: active.sessions === r.id ? undefined : r.id,
        }),
      })),
    },
    {
      label: "Tipo",
      current: MODELS.find((m) => m.id === active.model)?.label,
      options: MODELS.map((m) => ({
        label: m.label,
        href: buildHref({
          ...active,
          tab,
          sort,
          model: active.model === m.id ? undefined : m.id,
        }),
      })),
    },
  ];

  return (
    <>
      <section className="relative isolate overflow-hidden text-white">
        <Image
          src={(slug && CATEGORY_HERO[slug]) || "/img/hero-category.jpg"}
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
        />
        {/* Velo del Figma: negro al 47%. */}
        <div className="absolute inset-0 -z-10 bg-black/47" />

        <Container className="py-10">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/90">
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
            {" / "}
            {category ? (
              <>
                <Link href="/categories" className="hover:underline">
                  Categorías
                </Link>
                {" / "}
                <span>{category.name}</span>
              </>
            ) : (
              <span>Categorías</span>
            )}
          </nav>

          <h1 className="mt-3 text-3xl font-bold text-primary sm:text-[36px]">
            {title}
          </h1>
          <p className="mt-3 max-w-[847px] text-pretty text-white/95">
            {description}
          </p>

          <dl className="mt-6 flex flex-wrap items-center gap-5 text-white">
            {[
              {
                n: tutors.total,
                label: tutors.total === 1 ? "tutor" : "tutores",
              },
              {
                n: products.total,
                label: products.total === 1 ? "producto" : "productos",
              },
              ...(ratingAvg
                ? [{ n: `★ ${ratingAvg}`, label: "valoración media" }]
                : []),
            ].map(({ n, label }, i) => (
              <div key={label} className="flex items-center gap-5">
                {i > 0 ? (
                  <span aria-hidden className="size-1 rounded-full bg-white" />
                ) : null}
                <div className="flex items-baseline gap-1.5">
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-[17px] font-bold">{n}</dd>
                  <span className="text-sm">{label}</span>
                </div>
              </div>
            ))}
          </dl>

          <form
            action="/search"
            className="mt-6 flex max-w-[720px] gap-1.5 rounded-[10px] bg-card p-[5px]"
          >
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#6b6b6b]" />
              <input
                type="search"
                name="q"
                placeholder={
                  category
                    ? `Busca un tema, tutor o curso de ${category.name}…`
                    : "Busca un tema, tutor o curso…"
                }
                aria-label="Buscar"
                className="h-11 w-full bg-transparent pr-3 pl-10 text-[13.5px] text-foreground placeholder:text-[#6b6b6b] focus-visible:outline-none"
              />
            </div>
            <Button
              type="submit"
              className="h-11 rounded-[10px] px-6 text-[13.5px]"
            >
              Buscar
            </Button>
          </form>

          {/* Selector de categoría: la activa desplegada y el resto en círculo.
              En el índice no hay ninguna activa, así que van todas con nombre. */}
          <ul className="mt-5 flex flex-wrap items-center gap-3.5">
            {categories.map((c) => {
              const Icon = categoryIcon(c.slug);
              const isActive = c.slug === slug;
              const expanded = isActive || !slug;
              return (
                <li key={c.slug}>
                  <Link
                    href={`/categories/${c.slug}`}
                    aria-current={isActive ? "page" : undefined}
                    title={c.name}
                    className={`flex items-center rounded-full bg-card transition-colors hover:bg-white ${
                      expanded
                        ? "gap-2.5 p-1.5 pr-4"
                        : "size-[52px] justify-center"
                    } ${isActive ? "shadow-[0_6px_16px_rgb(0_0_0/0.25)]" : ""}`}
                  >
                    <span
                      className={
                        expanded
                          ? `grid size-10 place-items-center rounded-full ${
                              isActive ? "bg-brand text-white" : "bg-brand-muted text-brand"
                            }`
                          : "text-brand"
                      }
                    >
                      <Icon
                        className={expanded ? "size-[18px]" : "size-[22px]"}
                      />
                    </span>
                    {expanded ? (
                      <span className="text-sm font-semibold text-[#19191f]">
                        {c.name}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Container>
      </section>

      <Container>
        <Section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Segmented control del Figma: caja gris con la activa en blanco. */}
            <div
              role="tablist"
              aria-label="Resultados"
              className="flex gap-0.5 rounded-[10px] bg-[#ededed] p-1"
            >
              {[
                { id: "productos", label: "Productos" },
                { id: "tutores", label: "Tutores" },
              ].map((t) => (
                <Link
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  href={buildHref({ ...active, sort, tab: t.id })}
                  className={`rounded-[8px] px-5 py-2 text-sm font-medium transition-colors ${
                    tab === t.id
                      ? "bg-card text-[#19191f] shadow-[0_1px_3px_rgb(0_0_0/0.1)]"
                      : "text-[#666666] hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {tab === "productos" ? (
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
                        href={buildHref({ ...active, tab, sort: s.value })}
                        className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          {/* Filtros en fila (P06 no tiene panel lateral). "Nivel" e "Idioma"
              del Figma se quedan fuera: son DD-03 (`EY-113`), el producto no
              tiene esas columnas. */}
          {tab === "productos" ? (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              {dropdowns.map((d) => (
                <details key={d.label} className="group relative">
                  <summary
                    className={`flex h-[38px] cursor-pointer list-none items-center gap-1.5 rounded-[8px] border px-3.5 text-[13.5px] font-medium marker:hidden ${
                      d.current
                        ? "border-brand text-brand"
                        : "border-[#d1d1d1] text-[#474747]"
                    }`}
                  >
                    {d.current ?? d.label}
                    <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="absolute left-0 z-10 mt-1 w-56 rounded-[8px] border bg-card p-1 shadow-md">
                    {d.options.map((o) => (
                      <li key={o.label}>
                        <Link
                          href={o.href}
                          className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                        >
                          {o.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {Object.values(active).some(Boolean) ? (
                <Link
                  href={buildHref({ tab, sort })}
                  className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Limpiar
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6">
            {tab === "productos" ? (
              products.products.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay mentorías que encajen con este filtro.
                </p>
              ) : (
                <div className="grid gap-[25px] sm:grid-cols-2 lg:grid-cols-3">
                  {products.products.map((p) => (
                    <ProductCard key={p.id} product={p} accent="brand" />
                  ))}
                </div>
              )
            ) : tutors.tutors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay tutores que encajen con este filtro.
              </p>
            ) : (
              <div className="grid gap-[25px] sm:grid-cols-2 lg:grid-cols-3">
                {tutors.tutors.map((t) => (
                  <TutorCard key={t.id} tutor={t} />
                ))}
              </div>
            )}

            <Pager
              page={page}
              hasMore={tab === "productos" ? products.hasMore : tutors.hasMore}
              totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              hrefFor={(n) => buildHref({ ...active, tab, sort, page: n })}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
