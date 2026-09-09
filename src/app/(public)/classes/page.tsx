import Link from "next/link";
import { ArrowRightIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { EmptyResults } from "@/components/catalog/empty-results";
import { FilterPills } from "@/components/catalog/filter-pills";
import { Pager } from "@/components/catalog/pager";
import { ProductCard } from "@/components/catalog/product-card";
import {
  MODELS,
  PRICE_RANGES,
  SESSION_RANGES,
  LEVELS,
  LANGUAGES,
  ProductFilters,
  productFilterGroups,
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

  /** ¿hay algo que quitar? El orden no cuenta: es una preferencia de vista, no
   *  un filtro, y quitarlo no devuelve ni un resultado más. */
  const anyFilter = Object.values(active).some(Boolean);

  /**
   * Filtros MÓVILES (Verónica, 3-sep-2026: «mismo comentario que en explorar
   * tutores … en desarrollo ocupa demasiado espacio», IMG_4116): los mismos
   * seis grupos del panel lateral (`productFilterGroups`) como píldoras
   * desplegables, y cada href sale de `buildHref` sobre `active` + `sort`,
   * exactamente como los chips del hero (RV-16). Por debajo de `lg` se pintan
   * ellas y el panel se esconde; desde 1024 al revés (R1).
   */
  const filtrosMovil = productFilterGroups(categories).map((g) => ({
    key: g.key,
    label: g.title,
    current: g.options.find((o) => o.id === active[g.key])?.label,
    options: g.options.map((o) => {
      const on = active[g.key] === o.id;
      // El parche va tipado aparte: una clave calculada de tipo unión se
      // ensancha a índice `string` y chocaría con el `page?: number` de
      // `buildHref` (`ProductFilters` hace exactamente lo mismo).
      const patch: ProductFilterState = { [g.key]: on ? undefined : o.id };
      return {
        label: o.label,
        active: on,
        href: buildHref({ ...active, ...patch, sort }),
      };
    }),
  }));

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
          {/* R4 (acuerdo del 17-ago): «mentoría» al 100 %. El Figma P05 decía
              «Clases, mentorías y paquetes»: «clases» sale y entra «sesiones»
              (palabra permitida), con la misma longitud para que el párrafo
              siga en 4 líneas a 390 — la versión larga con los tres modelos
              («Sesiones individuales, paquetes y mentorías por hora») sumaba
              una quinta línea al hero (medido). */}
          <p className="mt-4 max-w-3xl text-pretty text-[15px] text-white/90">
            Elige el servicio ideal para ti y asegura el resultado que buscas
            hoy. Sesiones, mentorías y paquetes con una meta clara, medible y
            diseñada para tu éxito.
          </p>

          {/* Acotada a MENTORÍAS: buscando desde este módulo no se quieren
              tutores ni categorías mezclados (24-jul). Sin desplegable.

              MÓVIL (Verónica, 3-sep-2026: «bajar botón y centrar y alargar»,
              IMG_4115): por debajo de `sm` el formulario va en columna y el
              botón se estira solo a los 350 px del contenido (`align-items:
              stretch`). Medido en el Figma «P05 · Hero» (escala 2, ÷2): 14 px
              de hueco (`gap-3.5`), botón 47 —el alto que ya tenía— con la
              etiqueta centrada en 15 px semibold; el input mide 44 ahí y 46 en
              P04, y se unifica en 46 (un alto de input para las dos
              pantallas). Desde `sm`, la fila de siempre. */}
          <form
            action="/search"
            className="mt-6 flex flex-col gap-3.5 sm:flex-row sm:gap-2.5"
          >
            <input type="hidden" name="tab" value="productos" />
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder="¿Qué resultado vas a lograr hoy? (ej. hablar inglés, aprobar cálculo…)"
                aria-label="¿Qué resultado vas a lograr hoy?"
                className="h-[46px] w-full rounded-[10px] border border-[#d9d9d9] bg-background pr-3 pl-10 text-sm text-foreground placeholder:text-[#5c5c5c] focus-visible:outline-none sm:h-[47px]"
              />
            </div>
            <Button
              type="submit"
              className="h-[47px] rounded-[10px] px-6 max-sm:text-[15px] max-sm:font-semibold"
            >
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
                      {/* RV-16 · `sort` viaja con el resto. Era el único enlace
                          de la pantalla que lo dejaba caer: ordenabas por
                          precio, tocabas "Paquete" y volvías a "Más
                          relevantes" sin que nada lo dijera. */}
                      <Link
                        href={buildHref({
                          ...active,
                          sort,
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
            // Por debajo de `lg` mandan las píldoras de abajo (Verónica, 3-sep).
            className="hidden lg:block"
          />

          {/* `id` + `scroll-mt`: el paginador enlaza a `#resultados` y cambiar
              de página deja a la vista el principio de ESTA sección, no el de
              toda la página (Verónica, 3-sep-2026: «te lleva al inicio de toda
              la página … confunde», IMG_4117). El margen es el alto de la
              cabecera sticky: 173 px a 390, 73 desde 1024 (ver Pager).

              ⚠️ `min-w-0` no es decorativo: esta columna es un ítem de la
              rejilla de `Section` y la tira de píldoras (scroll container
              `nowrap`) aporta su ancho de contenido como min-content, así que
              la pista `auto` se salía de la pantalla (medido en P04: 766 px en
              390, con scroll horizontal de página). Con `min-width: 0` la
              pista vuelve a los 350 disponibles; desde `lg` (`1fr`) no cambia
              nada porque el contenido ya cabía. */}
          <div id="resultados" className="min-w-0 scroll-mt-44 lg:scroll-mt-24">
            <FilterPills
              className="lg:hidden"
              ariaLabel="Filtros de mentorías"
              clearHref={buildHref({ sort })}
              filters={filtrosMovil}
            />

            {/* Cabecera de resultados en UNA fila a 375/390, como el Figma P05
                («86 productos disponibles» + píldora «Ordenar ▾»; medido: texto
                13 px, píldora 35-38 de alto): contador a 13 px y el desplegable
                sin «por: {valor}» hasta `sm`. `mt-5`: 20 px bajo las píldoras;
                desde `lg` no las hay y vuelve a 0.

                `max-lg:min-w-0 max-lg:flex-1` en el contador: «15 mentorías
                listas para reservar» + «Ordenar ▾» suman 332 px, y a 360 (o a
                375 con tres cifras) la fila se partía y la píldora caía a una
                segunda línea (medido, revisión 8-sep). Así el texto envuelve
                dentro de su columna y la píldora se queda a la derecha. La
                píldora sube de 38 a 40 por debajo de `lg` (tacto). */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 lg:mt-0">
              <p className="text-[13px] font-medium text-[#666666] max-lg:min-w-0 max-lg:flex-1 sm:text-[15px]">
                {total}{" "}
                {total === 1
                  ? "mentoría lista para reservar"
                  : "mentorías listas para reservar"}
              </p>

              {/* ponytail: `<details>` nativo, igual que en P04. `name` lo marca
                  como desplegable: se cierra fuera/Escape/al elegir. */}
              <details name="orden" className="group relative">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-[8px] border border-[#d1d1d1] px-3.5 text-[13.5px] font-medium text-[#474747] marker:hidden lg:h-[38px]">
                  {/* Un solo span = un solo ítem flex, como el texto suelto de
                      antes: desde `sm` se pinta idéntico, píxel a píxel.
                      «por: {valor}» va con `sr-only` y no con `hidden` por
                      debajo de `sm`: lo visible es «Ordenar ▾» (Figma P05),
                      pero el lector de pantalla sigue oyendo el orden actual. */}
                  <span>
                    Ordenar
                    <span className="max-sm:sr-only">
                      {" "}
                      por:{" "}
                      {SORTS.find((s) => s.value === (sort ?? "recent"))!.label}
                    </span>
                  </span>
                  <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                {/* Filas de 44 px por debajo de `lg` (tacto), 36 desde 1024 como hoy. */}
                <ul className="absolute right-0 z-10 mt-1 w-60 rounded-[8px] border bg-card p-1 shadow-md">
                  {SORTS.map((s) => (
                    <li key={s.value}>
                      <Link
                        href={buildHref({ ...active, sort: s.value })}
                        className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted max-lg:py-3"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {products.length === 0 ? (
              // RV-11 · mismo estado vacío que el buscador. Las burbujas se
              // quedan en ESTA pantalla (`?cat=`) en vez de mandar al índice
              // de categorías: es un filtro más, no un cambio de sitio.
              <EmptyResults
                className="mt-6"
                message="No hay mentorías para este filtro todavía."
                action={
                  anyFilter
                    ? { href: buildHref({ sort }), label: "Quitar los filtros" }
                    : undefined
                }
                categories={categories}
                hrefFor={(slug) => buildHref({ cat: slug, sort })}
                /* Igual que en Explorar tutores: los chips del estado vacío en
                   una fila y con nombre, no envolviendo en dos. */
                layout="strip"
                variant="text"
              />
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
              targetId="resultados"
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
