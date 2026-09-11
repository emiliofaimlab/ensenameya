import Link from "next/link";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Pager } from "@/components/catalog/pager";
import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import { EmptyResults } from "@/components/catalog/empty-results";
import { FilterPills, type FilterPill } from "@/components/catalog/filter-pills";
import { PriceRange } from "@/components/catalog/price-range";
import { TutorCard } from "@/components/catalog/tutor-card";
import { AVAILABILITY, TutorFilters } from "@/components/catalog/tutor-filters";
import { LANGUAGES } from "@/components/catalog/product-filters";
import { textosDePrecio } from "@/lib/fx";
import {
  listApprovedTutors,
  listActiveCategories,
  tutorPriceBounds,
  type AvailabilityFilter,
  type TutorSort,
} from "@/lib/catalog/queries";

export const metadata = { title: "Explorar tutores · Enséñame Ya" };

const PAGE_SIZE = 12;

const SORTS: { value: TutorSort; label: string }[] = [
  { value: "rating", label: "Mejor valorados" },
  { value: "reviews", label: "Más reseñas" },
];

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    page?: string;
    rating?: string;
    avail?: string;
    pmin?: string;
    pmax?: string;
    lang?: string;
    sort?: string;
  }>;
}) {
  const {
    cat,
    page: pageParam,
    rating: ratingParam,
    avail: availParam,
    pmin: pminParam,
    pmax: pmaxParam,
    lang: langParam,
    sort: sortParam,
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const minRating = Number(ratingParam) || undefined;
  const availability = (["today", "week", "weekend"] as const).find(
    (v) => v === availParam,
  );
  // La query string es texto libre: un número que no lo es se ignora, no se
  // pasa al filtro (mismo criterio que los estados de US-1104). En unidades
  // menores, que es como viaja el precio en toda la app.
  const num = (v?: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  // Un rango al revés (?pmin=50&pmax=10, escrito a mano) devolvía 0 resultados
  // —correcto— pero dejaba los pomos cruzados. Se intercambian: es lo que quien
  // lo escribió quiso decir, y el control no puede quedar en un estado imposible.
  //
  // Se comparan a mano y NO con `.sort()`: `Array.prototype.sort` manda los
  // `undefined` al final del array sin llamar al comparador (así lo manda la
  // especificación), así que un `?pmax=7500` suelto se convertía en
  // `[7500, undefined]` — el máximo pasaba a ser el mínimo y el filtro se daba
  // la vuelta. Solo fallaba al mover el pomo derecho, que es el único caso que
  // deja `pmin` vacío.
  const desde = num(pminParam);
  const hasta = num(pmaxParam);
  const invertido = desde != null && hasta != null && desde > hasta;
  const pmin = invertido ? hasta : desde;
  const pmax = invertido ? desde : hasta;
  const language = LANGUAGES.find((l) => l.id === langParam)?.id;
  const sort = (["rating", "reviews"] as const).find((v) => v === sortParam);

  const [{ tutors, hasMore, total }, categories, priceBounds] = await Promise.all([
    listApprovedTutors({
      categorySlug: cat,
      minRating,
      availability,
      minPrice: pmin,
      maxPrice: pmax,
      language,
      sort,
      page,
    }),
    listActiveCategories(),
    tutorPriceBounds(),
  ]);

  /** Todos los filtros viven en la URL; al cambiar uno se vuelve a la página 1. */
  const buildHref = (next: {
    cat?: string;
    rating?: number;
    avail?: AvailabilityFilter;
    pmin?: number;
    pmax?: number;
    lang?: string;
    sort?: TutorSort;
    page?: number;
  }) => {
    const p = new URLSearchParams();
    if (next.cat) p.set("cat", next.cat);
    if (next.rating) p.set("rating", String(next.rating));
    if (next.avail) p.set("avail", next.avail);
    if (next.pmin != null) p.set("pmin", String(next.pmin));
    if (next.pmax != null) p.set("pmax", String(next.pmax));
    if (next.lang) p.set("lang", next.lang);
    if (next.sort) p.set("sort", next.sort);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const q = p.toString();
    return q ? `/tutors?${q}` : "/tutors";
  };

  const current = { cat, rating: minRating, avail: availability, pmin, pmax, lang: language, sort };
  /** ¿hay filtro que quitar? El orden no cuenta: es preferencia de vista. */
  const anyFilter =
    Boolean(cat) ||
    minRating != null ||
    Boolean(availability) ||
    pmin != null ||
    pmax != null ||
    Boolean(language);
  // Rango elegido: sólo cuenta si al menos un extremo acota de verdad.
  const price =
    priceBounds && (pmin != null || pmax != null)
      ? { min: pmin ?? priceBounds.min, max: pmax ?? priceBounds.max }
      : null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const priceBaseHref = buildHref({ ...current, pmin: undefined, pmax: undefined });

  /**
   * El rango elegido, para el rótulo de la píldora móvil. Va por
   * `textosDePrecio` y no por `formatMoney` porque el `current` de una píldora
   * es un STRING y no admite componente.
   *
   * ⚠️ Aquí va SOLO la cifra local: la píldora es un chip de 40 px con scroll
   * horizontal y el par completo no cabe. El dólar está a la vista en esta
   * misma pantalla por partida doble —el deslizador que abre esta píldora lo
   * pinta bajo el rango, y cada tarjeta de tutor lleva su «Desde … (US$ …)»—.
   *
   * No cuesta dos viajes: `monedaDelVisitante()` está memoizada con `cache()`
   * y el layout raíz ya la resolvió para esta petición.
   */
  const rango = price
    ? await Promise.all([
        textosDePrecio(price.min, "USD"),
        textosDePrecio(price.max, "USD"),
      ])
    : null;

  /**
   * Filtros MÓVILES (Verónica, 3-sep-2026: «dropdowns en slider uno al lado
   * del otro … estilo Shein», IMG_4157). Mismas opciones que `TutorFilters` y
   * la misma URL —cada href sale de `buildHref` sobre `current`, como los chips
   * del hero—, sólo cambia la superficie. Por debajo de `lg` se pintan ellas y
   * el panel lateral se esconde; desde 1024 al revés, y el escritorio no se
   * mueve (R1).
   */
  const filtrosMovil: FilterPill[] = [
    {
      key: "cat",
      label: "Categoría",
      current: categories.find((c) => c.slug === cat)?.name,
      options: categories.map((c) => ({
        label: c.name,
        active: c.slug === cat,
        href: buildHref({ ...current, cat: c.slug === cat ? undefined : c.slug }),
      })),
    },
    // El deslizador (DD-04) es un componente de cliente; como nodo de React se
    // puede pasar desde el servidor. Mismo `key` que en el panel: remonta al
    // cambiar la URL (ver PriceRange).
    ...(priceBounds
      ? [
          {
            key: "price",
            label: "Inversión por sesión",
            current: rango
              ? `${rango[0].local ?? rango[0].usd} – ${rango[1].local ?? rango[1].usd}`
              : undefined,
            panel: (
              <PriceRange
                key={`${price?.min ?? ""}-${price?.max ?? ""}`}
                bounds={priceBounds}
                value={price}
                baseHref={priceBaseHref}
              />
            ),
          },
        ]
      : []),
    {
      key: "rating",
      label: "Valoración",
      current: minRating ? `${minRating} o más` : undefined,
      // 0 = "Cualquiera": el estado sin filtro, igual que en el panel.
      //
      // Lista de UNA elección, como los radios: la opción marcada NO se
      // desmarca al tocarla —para eso está «Cualquiera»—. Con el toggle del
      // panel lateral, «✓ 4.5 o más» y «Cualquiera» apuntaban las dos a
      // `/tutors`, y `FilterPills` (que usa el href como `key` de cada fila)
      // avisaba por consola de dos hijos con la misma clave (revisión 8-sep).
      // Así ningún href se repite, sea cual sea el estado.
      options: [4.5, 4, 0].map((r) => ({
        label: r === 0 ? "Cualquiera" : `${r} o más`,
        active: r === 0 ? !minRating : minRating === r,
        href: buildHref({ ...current, rating: r === 0 ? undefined : r }),
      })),
    },
    {
      key: "avail",
      label: "Disponibilidad",
      current: AVAILABILITY.find((a) => a.value === availability)?.label,
      options: AVAILABILITY.map(({ value, label }) => ({
        label,
        active: availability === value,
        href: buildHref({ ...current, avail: availability === value ? undefined : value }),
      })),
    },
    {
      key: "lang",
      label: "Idioma del tutor",
      current: LANGUAGES.find((l) => l.id === language)?.label,
      options: LANGUAGES.map(({ id, label }) => ({
        label,
        active: language === id,
        href: buildHref({ ...current, lang: language === id ? undefined : id }),
      })),
    },
  ];

  return (
    <>
      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-12">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-2xl font-bold sm:text-3xl">Explorar tutores</h1>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-semibold">
              <span className="size-1.5 rounded-full bg-white" />
              {total} {total === 1 ? "tutor verificado" : "tutores verificados"}
            </span>
          </div>
          <p className="mt-4 max-w-3xl text-pretty text-[15px] text-white/90">
            Encuentra a tu mentor ideal y asegura el resultado que buscas.
            Conéctate con expertos verificados de toda Latinoamérica listos para
            transformar tu forma de aprender en vivo.
          </p>

          {/* La búsqueda por texto vive en /search (US-303), pero acotada a
              TUTORES: si buscas desde este módulo no quieres ver clases ni
              categorías mezcladas (24-jul). Sin desplegable a propósito.

              MÓVIL (Verónica, 3-sep-2026: «bajar botón de buscar», IMG_4112):
              por debajo de `sm` el formulario va en columna y el botón se
              estira solo a los 350 px del contenido (`align-items: stretch`,
              sin `w-full` que luego haya que deshacer). Medido en el Figma
              «P04 · Hero» (PNG a escala 2, ÷2): input 46 de alto, 14 px de
              hueco (`gap-3.5`), botón 47 —el mismo alto que ya tenía— con la
              etiqueta centrada en 15 px semibold. Desde `sm` es la fila de
              siempre: 47 / `gap-2.5` / botón a su ancho. */}
          <form
            action="/search"
            className="mt-6 flex flex-col gap-3.5 sm:flex-row sm:gap-2.5"
          >
            <input type="hidden" name="tab" value="tutores" />
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                name="q"
                placeholder="¿Qué habilidad pro vas a dominar hoy? (ej. hablar inglés, programar desde cero…)"
                aria-label="¿Qué habilidad pro vas a dominar hoy?"
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

          {/* Verónica, 3-sep-2026 («sustituir iconos por nombres … y hacerlo
              slider, que no queden en 2 líneas», IMG_4112): por debajo de `lg`
              píldoras con el NOMBRE en una sola fila con scroll, como las
              «Matemáticas · Inglés · Programación…» del Figma P04.
              `scroll={false}`: elegir categoría no manda al principio de la
              página. Desde 1024, los chips de ícono de siempre (R1).

              Los 16 px medidos entre el botón y la fila van en ESTE div y no
              en la tira: la tira lleva `max-lg:-my-1` (aire para el anillo de
              foco) y esa variante pisaba al `mt-4` del consumidor — medido:
              margen real −4 y los chips pegados al botón (revisión 8-sep).
              Aquí los márgenes colapsan: 16 + (−4) = 12, más los 4 de
              `py-1`, son los 16 del Figma en móvil y tablet; desde `lg` la
              tira no lleva margen y son los mismos 16 de siempre.
              `role="group"` + nombre: la tira de píldoras de abajo ya se
              anuncia como «Filtros de tutores»; esta se quedaba en «lista,
              9 elementos» sin decir de qué. */}
          <div role="group" aria-label="Categorías" className="mt-4">
            <CategoryIconChips
              categories={categories}
              activeSlug={cat}
              hrefFor={(slug) =>
                buildHref({ ...current, cat: slug === cat ? undefined : slug })
              }
              layout="strip"
              variant="text"
              scroll={false}
            />
          </div>
        </Container>
      </div>

      <Container>
        <Section className="grid gap-8 lg:grid-cols-[248px_1fr]">
          <TutorFilters
            categories={categories}
            activeSlug={cat}
            minRating={minRating}
            availability={availability}
            price={price}
            priceBounds={priceBounds}
            priceBaseHref={priceBaseHref}
            language={language}
            // RV-16 · el orden va DESPUÉS del spread a propósito: `next` trae
            // el estado de los filtros y el día que alguien le añada un `sort`
            // (aunque sea `undefined`) el orden se perdería en silencio.
            hrefFor={(next) => buildHref({ ...next, sort })}
            // Por debajo de `lg` mandan las píldoras de abajo (Verónica, 3-sep).
            className="hidden lg:block"
          />

          {/* `id` + `scroll-mt`: el paginador enlaza a `#resultados` para que
              cambiar de página no suba al principio de toda la página
              (Verónica, 3-sep-2026, IMG_4117). El margen es el alto de la
              cabecera sticky: 173 px a 390, 73 desde 1024 (ver Pager).

              ⚠️ `min-w-0` no es decorativo. Esta columna es un ítem de la
              rejilla de `Section`, y una tira con scroll (`scroll-strip`)
              aporta su ancho de CONTENIDO como min-content: la pista `auto`
              se iba a 766 px en una pantalla de 390 y la página entera tenía
              scroll horizontal (medido: `grid-template-columns: 766.6px`, la
              primera tarjeta de 766 de ancho). Con `min-width: 0` la pista
              vuelve a los 350 disponibles. Desde `lg` no cambia nada: la
              pista es `1fr` y el contenido ya cabía. */}
          <div id="resultados" className="min-w-0 scroll-mt-44 lg:scroll-mt-24">
            <FilterPills
              className="lg:hidden"
              ariaLabel="Filtros de tutores"
              clearHref={buildHref({ sort })}
              filters={filtrosMovil}
            />

            {/* Cabecera de resultados. En móvil el contador y «Ordenar» caben
                en UNA fila, como en el Figma P05 («86 productos disponibles» +
                píldora «Ordenar ▾», medido: texto 13 px, píldora 35-38 de alto):
                el contador baja a 13 px y el desplegable esconde «por: {valor}»
                hasta `sm`. `mt-5`: 20 px bajo las píldoras; desde `lg` no las
                hay y vuelve a 0.

                El contador lleva `max-lg:min-w-0 max-lg:flex-1`: con un
                contador largo (tres cifras, o «mentorías listas para
                reservar» en P05) la fila se partía a 360 px y «Ordenar» caía
                a una segunda línea; así el texto envuelve dentro de su
                columna y la píldora se queda a la derecha. La píldora sube de
                38 a 40 por debajo de `lg` (tacto; desde 1024 los 38 del
                Figma). */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 lg:mt-0">
              <p className="text-[13px] font-medium text-[#666666] max-lg:min-w-0 max-lg:flex-1 sm:text-[15px]">
                {total}{" "}
                {total === 1
                  ? "experto listo para guiarte"
                  : "expertos listos para guiarte"}
              </p>

              {/* ponytail: `<details>` nativo — el desplegable del Figma sin JS
                  ni componente de cliente; cada opción es un enlace. */}
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
                      {SORTS.find((s) => s.value === (sort ?? "rating"))!.label}
                    </span>
                  </span>
                  <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                {/* Filas de 44 px por debajo de `lg` (tacto), 36 desde 1024 como hoy. */}
                <ul className="absolute right-0 z-10 mt-1 w-52 rounded-[8px] border bg-card p-1 shadow-md">
                  {SORTS.map((s) => (
                    <li key={s.value}>
                      <Link
                        href={buildHref({ ...current, sort: s.value })}
                        className="block rounded-[6px] px-3 py-2 text-[13.5px] hover:bg-muted max-lg:py-3"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {tutors.length === 0 ? (
              // RV-11 · mismo estado vacío que el buscador (ver EmptyResults).
              <EmptyResults
                className="mt-6"
                message="No hay tutores para este filtro todavía."
                action={
                  anyFilter
                    ? { href: buildHref({ sort }), label: "Quitar los filtros" }
                    : undefined
                }
                categories={categories}
                hrefFor={(slug) => buildHref({ cat: slug, sort })}
                /* Mismos chips que arriba: en una fila y con nombre. Sin esto,
                   el estado vacío era el único sitio de la pantalla donde las
                   burbujas volvían a envolver en dos líneas. */
                layout="strip"
                variant="text"
              />
            ) : (
              <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {tutors.map((t) => (
                  <TutorCard key={t.id} tutor={t} />
                ))}
              </div>
            )}

            <Pager
              page={page}
              hasMore={hasMore}
              totalPages={totalPages}
              hrefFor={(n) => buildHref({ ...current, page: n })}
              targetId="resultados"
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
