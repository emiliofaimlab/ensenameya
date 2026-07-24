import Link from "next/link";

import type { AvailabilityFilter, CategoryTag } from "@/lib/catalog/queries";

const AVAILABILITY: { value: AvailabilityFilter; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "weekend", label: "Fines de semana" },
];

/**
 * Panel de filtros de P04. Cada opción es un enlace: el estado vive en la URL,
 * así que funciona sin JS y es compartible.
 *
 * Faltan dos grupos del Figma y no es descuido: **Inversión por clase** necesita
 * el precio de entrada materializado en el tutor (DD-04 / `EY-114`) — hoy sale
 * de sus productos y filtrar por él rompería la paginación— y **Idioma del
 * tutor** necesita el campo idioma (DD-03 / `EY-113`), que no existe. Se montan
 * cuando existan los datos; un filtro que no filtra es peor que ninguno.
 */
export function TutorFilters({
  categories,
  activeSlug,
  minRating,
  availability,
  hrefFor,
}: {
  categories: CategoryTag[];
  activeSlug?: string;
  minRating?: number;
  availability?: AvailabilityFilter;
  hrefFor: (next: {
    cat?: string;
    rating?: number;
    avail?: AvailabilityFilter;
  }) => string;
}) {
  return (
    <aside className="h-fit rounded-[16px] border border-[#dbdbdb] bg-card p-[22px] lg:sticky lg:top-24">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold">Filtros</h2>
        {activeSlug || minRating || availability ? (
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
            <li key={c.slug}>
              <Link
                href={hrefFor({
                  cat: active ? undefined : c.slug,
                  rating: minRating,
                  avail: availability,
                })}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-[#b3b3b3] bg-card"
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

      <p className="mt-5 text-sm font-bold text-[#242424]">Valoración</p>
      <ul className="mt-2 space-y-1.5">
        {[4.5, 4, 0].map((r) => {
          // 0 = "Cualquiera": es el estado sin filtro, no un valor más.
          const active = r === 0 ? !minRating : minRating === r;
          return (
            <li key={r}>
              <Link
                href={hrefFor({
                  cat: activeSlug,
                  rating: r === 0 || active ? undefined : r,
                  avail: availability,
                })}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-[#b3b3b3] bg-card"
                  }`}
                >
                  {active ? "✓" : null}
                </span>
                {r === 0 ? "Cualquiera" : `${r} o más`}
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-sm font-bold text-[#242424]">Disponibilidad</p>
      <ul className="mt-2 space-y-1.5">
        {AVAILABILITY.map(({ value, label }) => {
          const active = availability === value;
          return (
            <li key={value}>
              <Link
                href={hrefFor({
                  cat: activeSlug,
                  rating: minRating,
                  avail: active ? undefined : value,
                })}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-[#b3b3b3] bg-card"
                  }`}
                >
                  {active ? "✓" : null}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
