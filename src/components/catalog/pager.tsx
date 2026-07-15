import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Paginación anterior/siguiente. `hrefFor(page)` construye cada enlace. */
export function Pager({
  page,
  hasMore,
  hrefFor,
}: {
  page: number;
  hasMore: boolean;
  hrefFor: (page: number) => string;
}) {
  if (page <= 1 && !hasMore) return null;
  return (
    <div className="flex items-center justify-between">
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
