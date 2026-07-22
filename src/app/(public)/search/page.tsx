import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/catalog/product-card";
import { TutorCard } from "@/components/catalog/tutor-card";
import {
  listActiveCategories,
  searchCategories,
  searchProducts,
  searchTutors,
} from "@/lib/catalog/queries";

export const metadata = { title: "Buscar · Enséñame Ya" };

type Tab = "todo" | "tutores" | "productos" | "categorias";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const tab: Tab = (
    ["tutores", "productos", "categorias"] as const
  ).includes(sp.tab as never)
    ? (sp.tab as Tab)
    : "todo";

  const [products, tutors, matchedCategories, allCategories] =
    await Promise.all([
      query ? searchProducts(query) : Promise.resolve([]),
      query ? searchTutors(query) : Promise.resolve([]),
      query ? searchCategories(query) : Promise.resolve([]),
      listActiveCategories(),
    ]);

  const total = products.length + tutors.length + matchedCategories.length;
  const tabHref = (t: Tab) =>
    `/search?q=${encodeURIComponent(query)}${t === "todo" ? "" : `&tab=${t}`}`;

  const show = (t: Exclude<Tab, "todo">) => tab === "todo" || tab === t;

  return (
    <>
      <div className="bg-brand text-white">
        <Container className="py-10">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[26px]">
            ¿Qué meta vas a conquistar hoy?
          </h1>

          {/* Form GET nativo: navega a /search?q=… sin JS. */}
          <form action="/search" className="mt-5 flex max-w-3xl gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="¿Qué meta vas a conquistar hoy?"
                aria-label="Buscar"
                className="h-12 w-full rounded-[10px] bg-background pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
            <Button type="submit" className="h-12 rounded-[10px] px-6">
              Buscar
            </Button>
          </form>

          {/* El Figma fija una lista de búsquedas frecuentes; aquí salen las
              categorías reales, que además llevan a una búsqueda que funciona. */}
          <p className="mt-5 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">Explorar por categoría:</span>
            {allCategories.map((c) => (
              <Link
                key={c.slug}
                href={`/search?q=${encodeURIComponent(c.name)}`}
                className="rounded-full border border-white/60 px-3 py-1 transition-colors hover:bg-white/10"
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
              <p className="font-semibold">
                Mostrando {total} {total === 1 ? "resultado" : "resultados"}{" "}
                para «{query}»
              </p>

              <div
                role="tablist"
                aria-label="Tipo de resultado"
                className="mt-4 flex flex-wrap gap-1 border-b"
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
                    href={tabHref(id)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                      tab === id
                        ? "border-brand text-brand"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label} {n}
                  </Link>
                ))}
              </div>

              {total === 0 ? (
                <div className="mt-6 flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    Sin resultados para «{query}». Prueba con otra palabra o
                    explora por categoría:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {allCategories.map((c) => (
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
                  <h2 className="text-xl font-bold">Mentorías</h2>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {products.map((p) => (
                      <ProductCard key={p.id} product={p} />
                    ))}
                  </div>
                </section>
              ) : null}

              {show("tutores") && tutors.length > 0 ? (
                <section className="mt-8">
                  <h2 className="text-xl font-bold">Tutores</h2>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {tutors.map((t) => (
                      <TutorCard key={t.id} tutor={t} />
                    ))}
                  </div>
                </section>
              ) : null}

              {show("categorias") && matchedCategories.length > 0 ? (
                <section className="mt-8">
                  <h2 className="text-xl font-bold">Categorías</h2>
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
    </>
  );
}
