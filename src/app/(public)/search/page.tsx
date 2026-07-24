import Link from "next/link";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { categoryIcon } from "@/components/catalog/category-icons";
import { ProductCard } from "@/components/catalog/product-card";
import { TutorCard } from "@/components/catalog/tutor-card";
import {
  listCategoriesWithCounts,
  searchCategories,
  searchProducts,
  searchTutors,
} from "@/lib/catalog/queries";

export const metadata = { title: "Buscar · Enséñame Ya" };

type Tab = "todo" | "tutores" | "productos" | "categorias";
type Sort = "relevancia" | "rating";

const SORTS: { value: Sort; label: string }[] = [
  { value: "relevancia", label: "Relevancia" },
  { value: "rating", label: "Mejor valorados" },
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const tab: Tab = (["tutores", "productos", "categorias"] as const).includes(
    sp.tab as never,
  )
    ? (sp.tab as Tab)
    : "todo";
  const sort: Sort = sp.sort === "rating" ? "rating" : "relevancia";

  const [productsRaw, tutorsRaw, matchedCategories, categories] =
    await Promise.all([
      query ? searchProducts(query) : Promise.resolve([]),
      query ? searchTutors(query) : Promise.resolve([]),
      query ? searchCategories(query) : Promise.resolve([]),
      listCategoriesWithCounts(),
    ]);

  // "Mejor valorados" reordena en memoria: son ≤12 filas ya traídas, no merece
  // otra consulta. "Relevancia" es el orden que devuelve cada búsqueda.
  const products =
    sort === "rating"
      ? [...productsRaw].sort(
          (a, b) => (b.tutor?.ratingAvg ?? 0) - (a.tutor?.ratingAvg ?? 0),
        )
      : productsRaw;
  const tutors =
    sort === "rating"
      ? [...tutorsRaw].sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0))
      : tutorsRaw;

  const total = products.length + tutors.length + matchedCategories.length;
  const hrefFor = (next: { tab?: Tab; sort?: Sort }) => {
    const p = new URLSearchParams({ q: query });
    if (next.tab && next.tab !== "todo") p.set("tab", next.tab);
    if (next.sort && next.sort !== "relevancia") p.set("sort", next.sort);
    return `/search?${p.toString()}`;
  };

  const show = (t: Exclude<Tab, "todo">) => tab === "todo" || tab === t;

  return (
    <>
      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="flex flex-col items-center py-12 text-center">
          <h1 className="text-2xl font-bold sm:text-[26px]">
            ¿Qué meta vas a conquistar hoy?
          </h1>

          {/* Form GET nativo: navega a /search?q=… sin JS. */}
          <form
            action="/search"
            className="mt-4 flex w-full max-w-[720px] gap-2.5"
          >
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#737373]" />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="¿Qué meta vas a conquistar hoy?"
                aria-label="Buscar"
                className="h-[54px] w-full rounded-[12px] bg-background pr-3 pl-11 text-base text-[#2e2e2e] placeholder:text-[#737373] focus-visible:outline-none"
              />
            </div>
            <Button
              type="submit"
              className="h-[54px] rounded-[12px] px-7 text-[15px]"
            >
              Buscar
            </Button>
          </form>

          {/* El Figma fija cinco búsquedas inventadas; aquí van las categorías
              reales, que además llevan a una búsqueda que devuelve algo. */}
          <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <span className="font-medium">Búsquedas frecuentes:</span>
            {categories.slice(0, 5).map((c) => (
              <Link
                key={c.slug}
                href={`/search?q=${encodeURIComponent(c.name)}`}
                className="rounded-full bg-brand-foreground px-3 py-1.5 font-medium transition-opacity hover:opacity-90"
              >
                {c.name}
              </Link>
            ))}
          </p>
        </Container>
      </div>

      <Container>
        <Section>
          {!query ? (
            <p className="text-sm text-muted-foreground">
              Escribe qué quieres lograr, o entra por una categoría.
            </p>
          ) : (
            <>
              <p className="text-base font-semibold text-[#292929]">
                Mostrando {total} {total === 1 ? "resultado" : "resultados"}{" "}
                para &quot;{query}&quot;
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {/* Segmented control del Figma, igual que en P06. */}
                <div
                  role="tablist"
                  aria-label="Tipo de resultado"
                  className="flex gap-0.5 rounded-[10px] bg-[#ededed] p-1"
                >
                  {(
                    [
                      ["todo", "Todo", total],
                      ["tutores", "Tutores", tutors.length],
                      ["productos", "Mentorías", products.length],
                      ["categorias", "Categorías", matchedCategories.length],
                    ] as const
                  ).map(([id, label, n]) => (
                    <Link
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      href={hrefFor({ tab: id, sort })}
                      className={`rounded-[8px] px-4.5 py-2 text-sm font-medium transition-colors ${
                        tab === id
                          ? "bg-card text-[#19191f] shadow-[0_1px_3px_rgb(0_0_0/0.1)]"
                          : "text-[#5c5c5c] hover:text-foreground"
                      }`}
                    >
                      {label} {id === "todo" ? "" : n}
                    </Link>
                  ))}
                </div>

                {/* ponytail: `<details>` nativo, igual que en el resto del sitio. */}
                <details className="group relative">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-[#595959] marker:hidden">
                    Ordenar por: {SORTS.find((s) => s.value === sort)!.label}
                    <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="absolute right-0 z-10 mt-1 w-52 rounded-[8px] border bg-card p-1 shadow-md">
                    {SORTS.map((s) => (
                      <li key={s.value}>
                        <Link
                          href={hrefFor({ tab, sort: s.value })}
                          className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                        >
                          {s.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>

              {total === 0 ? (
                <div className="mt-6 flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    Sin resultados para &quot;{query}&quot;. Prueba con otra
                    palabra o explora por categoría:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <Link
                        key={c.slug}
                        href={`/categories/${c.slug}`}
                        className="rounded-full border px-3 py-1 text-[13px] transition-colors hover:border-brand hover:text-brand"
                      >
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              {show("productos") && products.length > 0 ? (
                <section className="mt-8">
                  <SectionHeader
                    title="Mentorías"
                    n={products.length}
                    href={hrefFor({ tab: "productos", sort })}
                    showLink={tab === "todo"}
                  />
                  <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {products.map((p) => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        compact
                        action="ver"
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {show("tutores") && tutors.length > 0 ? (
                <section className="mt-8">
                  <SectionHeader
                    title="Tutores"
                    n={tutors.length}
                    href={hrefFor({ tab: "tutores", sort })}
                    showLink={tab === "todo"}
                  />
                  <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {tutors.map((t) => (
                      <TutorCard key={t.id} tutor={t} layout="list" />
                    ))}
                  </div>
                </section>
              ) : null}

              {show("categorias") && matchedCategories.length > 0 ? (
                <section className="mt-8">
                  <SectionHeader
                    title="Categorías"
                    n={matchedCategories.length}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {matchedCategories.map((c) => (
                      <Link
                        key={c.slug}
                        href={`/categories/${c.slug}`}
                        className="rounded-full border px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
                      >
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </Section>
      </Container>

      {/* "Explorar por categoría" (386:2658): bloque oscuro con los recuentos
          reales de tutores por categoría. */}
      <div className="bg-[#14141a] text-white">
        <Container className="py-14">
          <h2 className="text-[23px] font-semibold">Explorar por categoría</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.slice(0, 6).map((c) => {
              const Icon = categoryIcon(c.slug);
              return (
                <li key={c.slug}>
                  <Link
                    href={`/categories/${c.slug}`}
                    className="flex h-full flex-col items-center gap-2 rounded-[16px] bg-card p-5 text-center transition-transform hover:-translate-y-0.5"
                  >
                    <span className="grid size-12 place-items-center rounded-full bg-brand-muted text-brand">
                      <Icon className="size-5" />
                    </span>
                    <p className="text-[13.5px] font-semibold text-[#14141a]">
                      {c.name}
                    </p>
                    <p className="text-[11.5px] text-[#666666]">
                      {c.tutors} {c.tutors === 1 ? "tutor" : "tutores"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Container>
      </div>
    </>
  );
}

/** Encabezado de sección de P09: título, línea y "Ver los N →". */
function SectionHeader({
  title,
  n,
  href,
  showLink = false,
}: {
  title: string;
  n: number;
  href?: string;
  showLink?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="text-xl font-bold text-[#1f1f1f]">{title}</h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {showLink && href ? (
        <Link
          href={href}
          className="text-sm font-medium text-[#4d4d4d] hover:text-foreground"
        >
          Ver los {n} →
        </Link>
      ) : null}
    </div>
  );
}
