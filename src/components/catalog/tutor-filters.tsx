import Link from "next/link";

import type { CategoryTag } from "@/lib/catalog/queries";

/**
 * Panel de filtros de P04. Cada opción es un enlace: el estado vive en la URL,
 * así que funciona sin JS y es compartible.
 * ponytail: sin filtro de precio — el mínimo por tutor sale de sus productos y
 * filtrar por él rompería la paginación; pide una columna materializada.
 */
export function TutorFilters({
  categories,
  activeSlug,
  minRating,
  hrefFor,
}: {
  categories: CategoryTag[];
  activeSlug?: string;
  minRating?: number;
  hrefFor: (next: { cat?: string; rating?: number }) => string;
}) {
  return (
    <aside className="h-fit rounded-2xl border bg-card p-5 lg:sticky lg:top-24">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold">Filtros</h2>
        {activeSlug || minRating ? (
          <Link
            href={hrefFor({})}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Limpiar
          </Link>
        ) : null}
      </div>

      <p className="mt-5 text-sm font-bold">Categoría</p>
      <ul className="mt-2 space-y-1.5">
        {categories.map((c) => {
          const active = c.slug === activeSlug;
          return (
            <li key={c.slug}>
              <Link
                href={hrefFor({
                  cat: active ? undefined : c.slug,
                  rating: minRating,
                })}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    active ? "border-brand bg-brand text-white" : "bg-card"
                  }`}
                >
                  {active ? "✓" : null}
                </span>
                {c.name}
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-sm font-bold">Valoración</p>
      <ul className="mt-2 space-y-1.5">
        {[4.5, 4].map((r) => {
          const active = minRating === r;
          return (
            <li key={r}>
              <Link
                href={hrefFor({
                  cat: activeSlug,
                  rating: active ? undefined : r,
                })}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    active ? "border-brand bg-brand text-white" : "bg-card"
                  }`}
                >
                  {active ? "✓" : null}
                </span>
                {r} o más
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
