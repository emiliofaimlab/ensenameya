import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import { EmptyResults } from "@/components/catalog/empty-results";
import { FilterPills, type FilterPill } from "@/components/catalog/filter-pills";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import { TutorCard } from "@/components/catalog/tutor-card";
import {
  MODELS,
  PRICE_RANGES,
  SESSION_RANGES,
  LEVELS,
  LANGUAGES,
  type ProductFilterState,
} from "@/components/catalog/product-filters";
import {
  getCategoryBySlug,
  listActiveCategories,
  listActiveProducts,
  listApprovedTutors,
  type ProductSort,
  type TeachingLevel,
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
  level?: string;
  lang?: string;
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
    level: LEVELS.some((l) => l.id === sp.level) ? sp.level : undefined,
    lang: LANGUAGES.some((l) => l.id === sp.lang) ? sp.lang : undefined,
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
      // una mentoría de Matemáticas puede estar también en Preparación de exámenes.
      secondCategorySlug: secondary,
      model: active.model as PricingModel | undefined,
      minPriceMinor: price?.min,
      maxPriceMinor: price?.max,
      minSessions: sessions?.min,
      maxSessions: sessions?.max,
      level: active.level as TeachingLevel | undefined,
      language: active.lang,
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
    for (const key of ["model", "price", "sessions", "level", "lang", "tema"] as const) {
      if (next[key]) p.set(key, next[key]!);
    }
    if (next.sort) p.set("sort", next.sort);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `${base}?${q}` : base;
  };

  /** ¿hay filtro que quitar? El orden queda fuera: es preferencia de vista, y
   *  quitarlo no devuelve ni un resultado más. */
  const anyFilter = Object.values(active).some(Boolean);

  /**
   * RV-16 · irse a otra categoría no se lleva los filtros —son de ÉSTA— pero
   * sí el orden: quien está mirando "de menor a mayor" lo sigue estando al
   * cambiar de categoría. `buildHref` no sirve aquí porque va atado a `base`.
   */
  const categoryHref = (s: string) =>
    sort ? `/categories/${s}?sort=${sort}` : `/categories/${s}`;

  const total = tab === "productos" ? products.total : tutors.total;
  const ratings = tutors.tutors
    .map((t) => t.ratingAvg)
    .filter((r): r is number => r !== null);
  const ratingAvg = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : null;

  const title = category ? `Explorar ${category.name}` : "Explorar categorías";
  const description =
    category?.description ??
    (category
      ? "Asegura los resultados que deseas de la mano de tutores validados, enfocados en lo que quieres conquistar."
      : "Elige por dónde empezar. Cada categoría reúne mentorías con una meta concreta y tutores verificados listos para acompañarte en vivo.");

  /**
   * Desplegables de filtro de la fila horizontal (386:1558). Los MISMOS datos
   * alimentan dos pintados: los `<details>` de escritorio y, por debajo de
   * `lg`, las píldoras de `FilterPills` (correo de Verónica, 3-sep-2026:
   * «opciones solo una línea en slider y dropdown»). De ahí el tipo
   * `FilterPill` y el `active` de cada opción, que es la casilla marcada del
   * panel móvil; los `<details>` lo ignoran.
   */
  const dropdowns: FilterPill[] = [
    {
      key: "tema",
      label: "Temas",
      current: categories.find((c) => c.slug === active.tema)?.name,
      options: categories
        .filter((c) => c.slug !== slug)
        .map((c) => ({
          label: c.name,
          active: active.tema === c.slug,
          href: buildHref({
            ...active,
            tab,
            sort,
            tema: active.tema === c.slug ? undefined : c.slug,
          }),
        })),
    },
    {
      key: "price",
      label: "Precio",
      current: PRICE_RANGES.find((r) => r.id === active.price)?.label,
      options: PRICE_RANGES.map((r) => ({
        label: r.label,
        active: active.price === r.id,
        href: buildHref({
          ...active,
          tab,
          sort,
          price: active.price === r.id ? undefined : r.id,
        }),
      })),
    },
    {
      key: "sessions",
      label: "Duración",
      current: SESSION_RANGES.find((r) => r.id === active.sessions)?.label,
      options: SESSION_RANGES.map((r) => ({
        label: r.label,
        active: active.sessions === r.id,
        href: buildHref({
          ...active,
          tab,
          sort,
          sessions: active.sessions === r.id ? undefined : r.id,
        }),
      })),
    },
    {
      key: "model",
      label: "Tipo",
      current: MODELS.find((m) => m.id === active.model)?.label,
      options: MODELS.map((m) => ({
        label: m.label,
        active: active.model === m.id,
        href: buildHref({
          ...active,
          tab,
          sort,
          model: active.model === m.id ? undefined : m.id,
        }),
      })),
    },
    // DD-03 · los mismos dos que P05, aquí como desplegables de la fila.
    {
      key: "level",
      label: "Nivel",
      current: LEVELS.find((l) => l.id === active.level)?.label,
      options: LEVELS.map((l) => ({
        label: l.label,
        active: active.level === l.id,
        href: buildHref({
          ...active,
          tab,
          sort,
          level: active.level === l.id ? undefined : l.id,
        }),
      })),
    },
    {
      key: "lang",
      label: "Idioma",
      current: LANGUAGES.find((l) => l.id === active.lang)?.label,
      options: LANGUAGES.map((l) => ({
        label: l.label,
        active: active.lang === l.id,
        href: buildHref({
          ...active,
          tab,
          sort,
          lang: active.lang === l.id ? undefined : l.id,
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

          {/* Acotada al módulo (24-jul), y el módulo depende de dónde estés:
              en el índice buscas CATEGORÍAS; dentro de una, lo que el
              explorador muestre (mentorías o tutores) de esa categoría.

              ── MÓVIL (correo de Verónica, 3-sep-2026: «en diseño va abajo
              centrado - se puede ajustar así para que vaya acorde a otras
              páginas») ── Por debajo de `sm` el botón va DEBAJO del input, a
              ancho completo, y la tarjeta blanca que los envolvía desaparece:
              el input es la caja blanca (Figma «P06 · hero-mobile»: input y
              botón de 350 de ancho, radio 10, apilados). Las alturas NO son
              las de ese frame (input 38, botón 40, 8 px entre ellos, rótulo
              13 px): son las del sistema que pide Verónica —«acorde a otras
              páginas»—, que es el buscador de P01/P04/P05: 46 / 46 / 12 y
              rótulo 15 px semibold (Doc 24 §24.3); un input de 38 queda por
              debajo del mínimo táctil. Desde `sm` vuelve la tarjeta de hoy. */}
          <form
            action="/search"
            className="mt-6 flex max-w-[720px] flex-col gap-3 sm:flex-row sm:gap-1.5 sm:rounded-[10px] sm:bg-card sm:p-[5px]"
          >
            <input type="hidden" name="tab" value={slug ? tab : "categorias"} />
            {slug ? <input type="hidden" name="cat" value={slug} /> : null}
            <div className="relative flex-1 max-sm:rounded-[10px] max-sm:bg-card">
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
                // El anillo de foco solo en móvil: ahí el input es la caja
                // blanca suelta sobre la foto; en la tarjeta de escritorio no
                // lo había y no se toca (R1).
                className="h-[46px] w-full bg-transparent pr-3 pl-10 text-[13.5px] text-foreground placeholder:text-[#6b6b6b] focus-visible:outline-none max-sm:rounded-[10px] max-sm:focus-visible:ring-2 max-sm:focus-visible:ring-brand sm:h-11"
              />
            </div>
            <Button
              type="submit"
              className="h-[46px] w-full rounded-[10px] px-6 text-[15px] font-semibold sm:h-11 sm:w-auto sm:text-[13.5px] sm:font-medium"
            >
              Buscar
            </Button>
          </form>

          {/* Categorías colapsadas a ícono; se despliegan al hover y la activa
              va fija (patrón del home, acuerdo 24-jul). Sin corte "ver más":
              esta pantalla ES el índice de todas.

              Móvil (Verónica, 3-sep: «eliminar 2 líneas, hacer slider
              categorías» y «la pantalla brinca cuando se elige una
              categoría»): `layout="strip"` = UNA fila con scroll que sangra
              hasta el borde por debajo de `lg`; `scroll={false}` = elegir
              categoría no devuelve al principio de la página (medido antes:
              scrollY 420 → 0). Se quedan los ÍCONOS: es lo que dibuja el
              Figma «P06 · hero-mobile» (círculos de 36 a 8 px, 10 px bajo el
              botón) y no pidió nombres aquí. `lg:` restituye los 14 px y los
              20 de hoy (R1). ⚠️ `mt-1.5` y no `mt-2.5`: la tira lleva
              `py-1 -my-1` (aire para el anillo de foco), y un `mt-*` propio
              PISA ese −4 de arriba en vez de sumarse — medido: con `mt-2.5`
              los círculos quedaban a 14 del botón, no a 10. */}
          <CategoryIconChips
            className="max-lg:mt-1.5 lg:mt-5 lg:gap-3.5"
            categories={categories}
            activeSlug={slug}
            hrefFor={categoryHref}
            limit={0}
            layout="strip"
            scroll={false}
          />
        </Container>
      </section>

      <Container>
        <Section>
          {/* Verónica, 3-sep («subir: ordenar»): pestañas y «Ordenar» en la
              MISMA fila también en móvil (Figma «P06 · tabs-filters», frame
              00: segmented de 178 + desplegable a la derecha). Sin `flex-wrap`:
              lo que hacía bajar el orden a una segunda línea. Cabe a 375
              porque por debajo de `sm` las pestañas se compactan a `px-4`
              (medido 15-16 en el Figma; hoy `px-5`) y el desplegable dice solo
              «Ordenar»: con «Ordenar: Más relevantes» el propio frame del
              Figma mide 358 y ya no cabe en los 350 de contenido. */}
          <div className="flex items-center justify-between gap-3">
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
                  // Cambiar de pestaña tampoco sube al principio (misma queja
                  // que en el buscador). `py-2.5` bajo `sm`: 40 px de alto por
                  // tacto (el Figma da 38 en una caja de 46).
                  scroll={false}
                  className={`rounded-[8px] px-4 py-2.5 text-sm font-medium transition-colors sm:px-5 sm:py-2 ${
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
              // `name` = acordeón exclusivo nativo: abrir uno cierra los demás
              // del grupo, así los paneles no se pisan entre sí.
              <details name="explorador" className="group relative shrink-0">
                <summary
                  className={`flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-[8px] border px-3.5 text-[13.5px] font-medium marker:hidden sm:h-[38px] ${
                    // En móvil el rótulo no dice qué orden hay puesto, así que
                    // la píldora se pinta en azul cuando no es el de siempre,
                    // como hacen las de filtro con algo elegido. Desde `sm` el
                    // rótulo ya lo dice y el borde es el de hoy.
                    sort && sort !== "recent"
                      ? "max-sm:border-brand max-sm:text-brand sm:border-[#d1d1d1] sm:text-[#474747]"
                      : "border-[#d1d1d1] text-[#474747]"
                  }`}
                >
                  <span className="sm:hidden">Ordenar</span>
                  <span className="hidden sm:inline">
                    Ordenar:{" "}
                    {SORTS.find((s) => s.value === (sort ?? "recent"))!.label}
                  </span>
                  <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="absolute right-0 z-10 mt-1 w-60 rounded-[8px] border bg-card p-1 shadow-md">
                  {SORTS.map((s) => {
                    const current = s.value === (sort ?? "recent");
                    return (
                      <li key={s.value}>
                        {/* La marca de «este es el puesto» solo bajo `sm`, que
                            es donde el rótulo no lo dice; en escritorio la
                            lista es la de hoy. */}
                        <Link
                          href={buildHref({ ...active, tab, sort: s.value })}
                          scroll={false}
                          aria-current={current ? "true" : undefined}
                          className={`block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted ${
                            current ? "max-sm:font-semibold max-sm:text-brand" : ""
                          }`}
                        >
                          {s.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ) : null}
          </div>

          {/* Filtros en fila (P06 no tiene panel lateral). "Nivel" e "Idioma"
              del Figma se quedan fuera: son DD-03 (`EY-113`), el producto no
              tiene esas columnas.

              Verónica, 3-sep («opciones solo una línea en slider y
              dropdown»): por debajo de `lg` la fila es `FilterPills` —una
              tira con scroll y UN panel debajo, con los mismos `dropdowns`—;
              los `<details>` de hoy se quedan para escritorio (`hidden
              lg:flex`, R1). */}
          {tab === "productos" ? (
            <>
              <FilterPills
                className="mt-5 lg:hidden"
                ariaLabel="Filtros de mentorías"
                clearHref={buildHref({ tab, sort })}
                filters={dropdowns}
              />
              <div className="mt-5 hidden flex-wrap items-center gap-2.5 lg:flex">
                {dropdowns.map((d) => (
                  <details key={d.key} name="explorador" className="group relative">
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
                      {d.options?.map((o) => (
                        <li key={o.label}>
                          <Link
                            href={o.href}
                            scroll={false}
                            className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted"
                          >
                            {o.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
                {anyFilter ? (
                  <Link
                    href={buildHref({ tab, sort })}
                    scroll={false}
                    className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Limpiar
                  </Link>
                ) : null}
              </div>
            </>
          ) : null}

          {/* `id` + `scroll-mt`: el `Pager` ancla aquí al cambiar de página en
              vez de subir al principio (ver pager.tsx: 173 px de cabecera
              sticky a 390, 73 desde 1024). Hoy Matemáticas tiene 2 productos
              con `PAGE_SIZE = 12`, o sea UNA página y el paginador no se
              pinta —«no hay selector de página» no era un fallo—; queda listo
              para cuando haya más. */}
          <div id="resultados" className="mt-6 scroll-mt-44 lg:scroll-mt-24">
            {tab === "productos" ? (
              products.products.length === 0 ? (
                // RV-11 · mismo estado vacío que el buscador (ver EmptyResults).
                // Aquí las burbujas SÍ llevan al índice de categorías: estás
                // dentro de una y la salida natural es cambiarte de categoría.
                <EmptyResults
                  message="Aún no hay mentorías que encajen con este filtro."
                  action={
                    anyFilter
                      ? {
                          href: buildHref({ tab, sort }),
                          label: "Quitar los filtros",
                        }
                      : undefined
                  }
                  categories={categories}
                  hrefFor={categoryHref}
                  layout="strip"
                  variant="text"
                />
              ) : (
                <div className="grid gap-[25px] sm:grid-cols-2 lg:grid-cols-3">
                  {products.products.map((p) => (
                    <ProductCard key={p.id} product={p} accent="brand" />
                  ))}
                </div>
              )
            ) : tutors.tutors.length === 0 ? (
              // La pestaña de tutores no lleva filtros propios: solo la
              // categoría, así que la única salida útil son las burbujas.
              <EmptyResults
                message={
                  category
                    ? `Aún no hay tutores en ${category.name}.`
                    : "Aún no hay tutores publicados."
                }
                categories={categories}
                hrefFor={categoryHref}
                layout="strip"
                variant="text"
              />
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
              targetId="resultados"
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
