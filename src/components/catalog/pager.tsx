import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Paginación. Con `totalPages` sale la numerada de P04 (‹ 1 2 3 4 ›); sin él,
 * anterior/siguiente, que es lo que necesitan los listados del panel admin.
 *
 * `targetId` (correo de Verónica, 3-sep-2026: «al oprimir te lleva al inicio de
 * toda la página»): si llega, cada enlace acaba en `#targetId` y Next desplaza
 * a esa sección al cambiar de página en vez de al principio. Medido en dev
 * (8-sep): `router.push("/tutors?page=2#resultados")` deja `scrollY` en 483,5 =
 * el `top` de la sección (659) menos su `scroll-margin-top` (176) — o sea que el
 * App Router respeta el hash Y el margen sin ayuda, y no hace falta ningún
 * `PagerLink` cliente con `scrollIntoView`.
 *
 * El consumidor pone dos cosas en la sección de resultados: el `id` y el
 * `scroll-mt-*`, porque la cabecera es sticky y sin margen el hash la esconde
 * debajo. Medida en el navegador (8-sep, dev): 173 px a 390 (tres filas),
 * 147 a 768 y 73 desde 1024 → `scroll-mt-44 lg:scroll-mt-24` (176 y 96 px:
 * deja 3 y 23 px de aire; a 768 sobran 29, que no molestan).
 */
export function Pager({
  page,
  hasMore,
  totalPages,
  hrefFor,
  targetId,
}: {
  page: number;
  hasMore: boolean;
  totalPages?: number;
  hrefFor: (page: number) => string;
  /** `id` de la sección de resultados: los enlaces llevan `#id` y el cambio de página no sube arriba del todo. */
  targetId?: string;
}) {
  if (page <= 1 && !hasMore) return null;

  const href = (n: number) =>
    targetId ? `${hrefFor(n)}#${targetId}` : hrefFor(n);

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
          href={href(page - 1)}
          label="Página anterior"
        >
          ‹
        </PagerArrow>
        {pages.map((n) => (
          <Link
            key={n}
            href={href(n)}
            aria-current={n === page ? "page" : undefined}
            /* 40 px de alto en móvil y los 38 del Figma desde `lg` (R1): el
               número era el único control del paginador por debajo de los 40
               —las flechas de al lado ya miden 40— y es de los pocos que se
               tocan con el pulgar al final de una lista larga. */
            className={`grid h-10 min-w-10 place-items-center rounded-full px-3 text-[15px] font-medium transition-colors lg:h-[38px] ${
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
          href={href(page + 1)}
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
          <Link href={href(page - 1)}>Anterior</Link>
        </Button>
      ) : (
        <span />
      )}
      {hasMore ? (
        <Button asChild variant="outline">
          <Link href={href(page + 1)}>Siguiente</Link>
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
