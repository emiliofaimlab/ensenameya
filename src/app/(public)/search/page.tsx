import Link from "next/link";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import { categoryIcon } from "@/components/catalog/category-icons";
import { EmptyResults } from "@/components/catalog/empty-results";
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
  searchParams: Promise<{
    q?: string;
    tab?: string;
    sort?: string;
    cat?: string;
  }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const tab: Tab = (["tutores", "productos", "categorias"] as const).includes(
    sp.tab as never,
  )
    ? (sp.tab as Tab)
    : "todo";
  const sort: Sort = sp.sort === "rating" ? "rating" : "relevancia";
  // Filtro por categoría: llega al entrar a buscar desde una categoría concreta
  // (`/categories/[slug]`). Acota tutores y mentorías; las categorías que casan
  // por texto dejan de tener sentido cuando ya estás dentro de una.
  const cat = sp.cat?.trim() || undefined;

  const [productsRaw, tutorsRaw, matchedCategories, categories] =
    await Promise.all([
      query ? searchProducts(query, cat) : Promise.resolve([]),
      query ? searchTutors(query, cat) : Promise.resolve([]),
      query && !cat ? searchCategories(query) : Promise.resolve([]),
      listCategoriesWithCounts(),
    ]);
  const catName = categories.find((c) => c.slug === cat)?.name ?? cat;

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
  const hrefFor = (next: { tab?: Tab; sort?: Sort; cat?: string | null }) => {
    const p = new URLSearchParams({ q: query });
    if (next.tab && next.tab !== "todo") p.set("tab", next.tab);
    if (next.sort && next.sort !== "relevancia") p.set("sort", next.sort);
    // `null` = quitar el filtro; `undefined` = conservar el vigente.
    const nextCat = next.cat === undefined ? cat : (next.cat ?? undefined);
    if (nextCat) p.set("cat", nextCat);
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

          {/* Form GET nativo: navega a /search?q=… sin JS.

              Móvil (correo de Verónica, 3-sep-2026: «Buscar moverlo abajo,
              alargar botón y centrar»): por debajo de `sm` el botón va debajo
              del input, los dos a ancho completo. Medido en el Figma «P09 ·
              hero-busqueda» (PNG a escala 2, ÷2): input y botón de 350×51 con
              10 px entre ellos, radio ≈12 y rótulo «Buscar» de 15 px. Se
              redondea a 52 (el escritorio sigue en 54, R1). */}
          <form
            action="/search"
            className="mt-4 flex w-full max-w-[720px] flex-col gap-2.5 sm:flex-row"
          >
            {/* Al refinar la búsqueda se conserva el ámbito con el que llegaste. */}
            {cat ? <input type="hidden" name="cat" value={cat} /> : null}
            {tab !== "todo" ? (
              <input type="hidden" name="tab" value={tab} />
            ) : null}
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#737373]" />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="¿Qué meta vas a conquistar hoy?"
                aria-label="Buscar"
                className="h-[52px] w-full rounded-[12px] bg-background pr-3 pl-11 text-base text-[#2e2e2e] placeholder:text-[#737373] focus-visible:outline-none sm:h-[54px]"
              />
            </div>
            <Button
              type="submit"
              className="h-[52px] w-full rounded-[12px] px-7 text-[15px] font-semibold sm:h-[54px] sm:w-auto sm:font-medium"
            >
              Buscar
            </Button>
          </form>

          {/* El Figma fija cinco búsquedas inventadas; aquí van las categorías
              reales, que además llevan a una búsqueda que devuelve algo.

              Móvil (Verónica, 3-sep: «Búsqueda frecuente centrar» y
              «categorías solo una línea y slider»): por debajo de `lg` el
              rótulo va centrado en su propia línea y los chips debajo en UNA
              fila con scroll que sangra hasta el borde (Figma «P09 ·
              hero-busqueda»: rótulo centrado, chips de 30 de alto a 8 px, el
              último cortado por la derecha). El truco del centrado: la tira
              (`scroll-strip`) tiene UN hijo, la `<ul>`, con `mx-auto` — si
              cabe, los márgenes automáticos la centran; si desborda, el
              espacio libre es negativo, los márgenes valen 0 y la fila
              arranca por la izquierda y se desplaza. Sin JS. Desde `lg` el
              rótulo y los chips vuelven a la misma línea centrada de hoy
              (R1: idéntico mientras quepan en una línea, que a 1024 sobra). */}
          <nav
            aria-label="Búsquedas frecuentes"
            className="mt-5 flex flex-col items-center gap-2 text-[13px] max-lg:self-stretch lg:flex-row lg:flex-wrap lg:justify-center"
          >
            <p className="font-medium">Búsquedas frecuentes:</p>
            <div className="max-lg:scroll-strip -mx-5 -my-1 px-5 py-1 scroll-px-5 max-lg:self-stretch sm:-mx-6 sm:px-6 sm:scroll-px-6 md:-mx-8 md:px-8 md:scroll-px-8 lg:mx-0 lg:my-0 lg:flex lg:px-0 lg:py-0">
              <ul className="mx-auto flex gap-2">
                {categories.slice(0, 5).map((c) => (
                  <li key={c.slug}>
                    {/* El chip mide 32 (el Figma, 30) y el mínimo táctil es 40:
                        el `before:` estira la zona de toque 4 px por arriba y
                        por abajo sin mover un píxel de lo que se ve —los
                        `py-1 -my-1` de la tira son justo ese aire—. Solo bajo
                        `lg`: en escritorio no hace falta. */}
                    <Link
                      href={`/search?q=${encodeURIComponent(c.name)}`}
                      className="relative flex rounded-full bg-brand-foreground px-3 py-1.5 font-medium whitespace-nowrap transition-opacity hover:opacity-90 max-lg:before:absolute max-lg:before:inset-x-0 max-lg:before:-inset-y-1"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
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
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-base font-semibold text-[#292929]">
                  Encontramos {total}{" "}
                  {total === 1 ? "resultado exitoso" : "resultados exitosos"}{" "}
                  para &quot;{query}&quot;
                </p>
                {cat ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-muted py-1 pr-1 pl-3 text-[13px] font-medium text-brand">
                    En {catName}
                    <Link
                      href={hrefFor({ tab, sort, cat: null })}
                      aria-label={`Quitar el filtro de categoría ${catName}`}
                      className="grid size-5 place-items-center rounded-full transition-colors hover:bg-brand hover:text-white"
                    >
                      <XIcon className="size-3" />
                    </Link>
                  </span>
                ) : null}
              </div>

              {/* Móvil (Verónica, 3-sep: «brinca al elegir opción», sobre las
                  pestañas): por debajo de `sm` la fila es la del Figma «P09 ·
                  tabs-sort» —el segmented en una tira con scroll que se corta
                  por el borde derecho, y «Ordenar por» DEBAJO, a la derecha—.
                  Desde `sm` vuelve la fila de hoy (pestañas a la izquierda,
                  orden a la derecha, envolviendo si no cabe). */}
              <div className="mt-4 flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                {/* Segmented control del Figma, igual que en P06. */}
                <div
                  role="tablist"
                  aria-label="Tipo de resultado"
                  // US-1601: a 360 px las cuatro pestañas suman más que la
                  // pantalla y sacaban scroll horizontal a TODA la página.
                  // Entonces se dejaron envolver (dos filas: la queja de
                  // Verónica). Ahora, bajo `sm`, la caja gris ES el contenedor
                  // con scroll (`scroll-strip`): sangra hasta el borde por la
                  // derecha (`-mr-5`, el padding del `Container`) y repone
                  // ese sangrado como padding interior (`pr-6` = 20 + los 4
                  // de la caja) para que la última pestaña llegue a verse
                  // entera al final del recorrido. En desktop envuelve como
                  // siempre. Las pestañas vuelven a `px-4.5` también en móvil
                  // (medido 18,5 en el Figma): el `px-3` era solo para que
                  // cupieran, y ya no hace falta.
                  className="flex gap-0.5 rounded-[10px] bg-[#ededed] p-1 max-sm:scroll-strip max-sm:-mr-5 max-sm:pr-6 sm:flex-wrap"
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
                      // `scroll={false}`: cambiar de pestaña no sube al
                      // principio de la página. `py-2.5` bajo `sm`: 40 px de
                      // alto por tacto (el Figma da 39).
                      scroll={false}
                      className={`rounded-[8px] px-4.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:py-2 ${
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
                <details name="orden" className="group relative max-sm:self-end">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-[#595959] marker:hidden sm:min-h-0">
                    Ordenar por: {SORTS.find((s) => s.value === sort)!.label}
                    <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="absolute right-0 z-10 mt-1 w-52 rounded-[8px] border bg-card p-1 shadow-md">
                    {SORTS.map((s) => (
                      <li key={s.value}>
                        <Link
                          href={hrefFor({ tab, sort: s.value })}
                          scroll={false}
                          className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                        >
                          {s.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>

              {/* RV-11 · el estado vacío de esta pantalla es el bueno, y ahora
                  vive en `EmptyResults`: lo comparten P04, P05 y P06. */}
              {total === 0 ? (
                <EmptyResults
                  className="mt-6"
                  message={
                    cat
                      ? `Sin resultados para "${query}" dentro de ${catName}.`
                      : `Sin resultados para "${query}". Prueba con otra palabra.`
                  }
                  action={
                    cat
                      ? {
                          href: hrefFor({ tab, sort, cat: null }),
                          label: "Buscar en todas las categorías",
                        }
                      : undefined
                  }
                  categories={categories}
                  layout="strip"
                  variant="text"
                />
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
          reales de tutores por categoría.

          Móvil (Verónica, 3-sep: «en diseño se divide en cuadros pequeños —
          me gusta más—, como está actualmente ocupa demasiado espacio»): dos
          columnas por debajo de `sm`. Medido en el Figma «P09 · Categorías
          destacadas» (÷2): tarjetas de 165 a 16 px, radio 16, padding 20,
          ícono en cuadrado de 48 con radio 12, nombre 15 px semibold, recuento
          13 px #666. El fondo oscuro se queda (el frame lo pinta blanco, pero
          es lo que hay en escritorio y lo que Verónica vio). Desde `sm` las
          3/6 columnas y los tamaños de hoy (R1). */}
      <div className="bg-[#14141a] text-white">
        <Container className="py-14">
          <h2 className="text-[23px] font-semibold">Explorar por categoría</h2>
          <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.slice(0, 6).map((c) => {
              const Icon = categoryIcon(c.icon);
              return (
                <li key={c.slug}>
                  <Link
                    href={`/categories/${c.slug}`}
                    className="flex h-full flex-col items-center gap-2 rounded-[16px] bg-card p-5 text-center transition-transform hover:-translate-y-0.5"
                  >
                    <span className="grid size-12 place-items-center rounded-[12px] bg-brand-muted text-brand sm:rounded-full">
                      <Icon className="size-5" />
                    </span>
                    <p className="text-[15px] font-semibold text-[#14141a] sm:text-[13.5px]">
                      {c.name}
                    </p>
                    <p className="text-[13px] text-[#666666] sm:text-[11.5px]">
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
