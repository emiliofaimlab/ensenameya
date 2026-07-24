import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Paginación. Con `totalPages` sale la numerada de P04 (‹ 1 2 3 4 ›); sin él,
 * anterior/siguiente, que es lo que necesitan los listados del panel admin.
 */
export function Pager({
  page,
  hasMore,
  totalPages,
  hrefFor,
}: {
  page: number;
  hasMore: boolean;
  totalPages?: number;
  hrefFor: (page: number) => string;
}) {
  if (page <= 1 && !hasMore) return null;

  if (totalPages && totalPages > 1) {
    // Ventana de 4 páginas alrededor de la actual: con muchas páginas la fila
    // no se desborda y sigue siendo navegable.
    const start = Math.max(1, Math.min(page - 1, totalPages - 3));
    const pages = Array.from(
      { length: Math.min(4, totalPages) },
      (_, i) => start + i,
    ).filter((n) => n <= totalPages);

    return (
      <nav
        aria-label="Paginación"
        className="mt-8 flex items-center justify-center gap-2"
      >
        <PagerArrow
          disabled={page <= 1}
          href={hrefFor(page - 1)}
          label="Página anterior"
        >
          ‹
        </PagerArrow>
        {pages.map((n) => (
          <Link
            key={n}
            href={hrefFor(n)}
            aria-current={n === page ? "page" : undefined}
            className={`grid h-[38px] min-w-10 place-items-center rounded-full px-3 text-[15px] font-medium transition-colors ${
              n === page
                ? "bg-brand text-white"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {n}
          </Link>
        ))}
        <PagerArrow
          disabled={!hasMore}
          href={hrefFor(page + 1)}
          label="Página siguiente"
        >
          ›
        </PagerArrow>
      </nav>
    );
  }

  return (
    <div className="mt-8 flex items-center justify-between">
      {page > 1 ? (
        <Button asChild variant="outline">
          <Link href={hrefFor(page - 1)}>Anterior</Link>
        </Button>
      ) : (
        <span />
      )}
      {hasMore ? (
        <Button asChild variant="outline">
          <Link href={hrefFor(page + 1)}>Siguiente</Link>
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

function PagerArrow({
  disabled,
  href,
  label,
  children,
}: {
  disabled: boolean;
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  const className =
    "grid size-10 place-items-center rounded-full text-[15px] text-[#a8a8a8]";
  if (disabled) {
    return (
      <span aria-hidden className={`${className} opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={`${className} hover:bg-muted`}
    >
      {children}
    </Link>
  );
}
