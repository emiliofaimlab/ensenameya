import Link from "next/link";

import type { AvailabilityFilter, CategoryTag } from "@/lib/catalog/queries";
import { PriceRange } from "@/components/catalog/price-range";
import { LANGUAGES } from "@/components/catalog/product-filters";

const AVAILABILITY: { value: AvailabilityFilter; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "weekend", label: "Fines de semana" },
];

/**
 * Panel de filtros de P04. Cada opción es un enlace: el estado vive en la URL,
 * así que funciona sin JS y es compartible.
 *
 * "Idioma del tutor" se deriva de las clases que publica (DD-03): no hay
 * columna de idioma en el tutor, y lo que el alumno pregunta de verdad es si
 * DA CLASES en ese idioma.
 */
export function TutorFilters({
  categories,
  activeSlug,
  minRating,
  availability,
  price,
  priceBounds,
  priceBaseHref,
  language,
  hrefFor,
}: {
  categories: CategoryTag[];
  activeSlug?: string;
  minRating?: number;
  availability?: AvailabilityFilter;
  /** DD-04 · rango elegido, o null si no se ha tocado. */
  price: { min: number; max: number } | null;
  /** Extremos reales del catálogo; sin ellos no hay deslizador que pintar. */
  priceBounds: { min: number; max: number } | null;
  /** URL con el resto de filtros, para el deslizador (ver PriceRange). */
  priceBaseHref: string;
  language?: string;
  hrefFor: (next: {
    cat?: string;
    rating?: number;
    avail?: AvailabilityFilter;
    pmin?: number;
    pmax?: number;
    lang?: string;
  }) => string;
}) {
  /** Una opción del panel: casilla + etiqueta, con el estado en la URL. */
  const Option = ({
    active,
    href,
    children,
  }: {
    active: boolean;
    href: string;
    children: React.ReactNode;
  }) => (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <span
          className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
            active ? "border-brand bg-brand text-white" : "border-[#b3b3b3] bg-card"
          }`}
        >
          {active ? "✓" : null}
        </span>
        {children}
      </Link>
    </li>
  );

  return (
    <aside className="h-fit rounded-[16px] border border-[#dbdbdb] bg-card p-[22px] lg:sticky lg:top-24">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold">Filtros</h2>
        {activeSlug || minRating || availability || price || language ? (
          <Link
            href={hrefFor({})}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Limpiar
          </Link>
        ) : null}
      </div>

      <p className="mt-5 text-sm font-bold text-[#242424]">Categoría</p>
      <ul className="mt-2 space-y-1.5">
        {categories.map((c) => {
          const active = c.slug === activeSlug;
          return (
            <Option
              key={c.slug}
              active={active}
              href={hrefFor({
                cat: active ? undefined : c.slug,
                rating: minRating,
                avail: availability,
                pmin: price?.min,
                pmax: price?.max,
                lang: language,
              })}
            >
              {c.name}
            </Option>
          );
        })}
      </ul>

      {/* El orden del Figma pone la inversión justo después de la categoría.
          Es un rango continuo, no tramos (decisión de EY-114). Sin catálogo con
          precios no se pinta: un deslizador de 0 a 0 no filtra nada. */}
      {priceBounds ? (
        <div className="mt-5">
          <PriceRange
            // Reinicia el deslizador cuando la URL cambia (ver PriceRange).
            key={`${price?.min ?? ""}-${price?.max ?? ""}`}
            bounds={priceBounds}
            value={price}
            baseHref={priceBaseHref}
          />
        </div>
      ) : null}

      <p className="mt-5 text-sm font-bold text-[#242424]">Valoración</p>
      <ul className="mt-2 space-y-1.5">
        {[4.5, 4, 0].map((r) => {
          // 0 = "Cualquiera": es el estado sin filtro, no un valor más.
          const active = r === 0 ? !minRating : minRating === r;
          return (
            <Option
              key={r}
              active={active}
              href={hrefFor({
                cat: activeSlug,
                rating: r === 0 || active ? undefined : r,
                avail: availability,
                pmin: price?.min,
                pmax: price?.max,
                lang: language,
              })}
            >
              {r === 0 ? "Cualquiera" : `${r} o más`}
            </Option>
          );
        })}
      </ul>

      <p className="mt-5 text-sm font-bold text-[#242424]">Disponibilidad</p>
      <ul className="mt-2 space-y-1.5">
        {AVAILABILITY.map(({ value, label }) => {
          const active = availability === value;
          return (
            <Option
              key={value}
              active={active}
              href={hrefFor({
                cat: activeSlug,
                rating: minRating,
                avail: active ? undefined : value,
                pmin: price?.min,
                pmax: price?.max,
                lang: language,
              })}
            >
              {label}
            </Option>
          );
        })}
      </ul>

      {/* DD-03 · sale de las clases que publica, no de una columna del tutor. */}
      <p className="mt-5 text-sm font-bold text-[#242424]">Idioma del tutor</p>
      <ul className="mt-2 space-y-1.5">
        {LANGUAGES.map(({ id, label }) => {
          const active = language === id;
          return (
            <Option
              key={id}
              active={active}
              href={hrefFor({
                cat: activeSlug,
                rating: minRating,
                avail: availability,
                pmin: price?.min,
                pmax: price?.max,
                lang: active ? undefined : id,
              })}
            >
              {label}
            </Option>
          );
        })}
      </ul>
    </aside>
  );
}
