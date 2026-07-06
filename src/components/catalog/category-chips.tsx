import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { CategoryTag } from "@/lib/catalog/queries";

/** Chips de filtro por categoría. `hrefFor(slug)` construye el enlace (undefined = "Todas"). */
export function CategoryChips({
  categories,
  activeSlug,
  hrefFor,
}: {
  categories: CategoryTag[];
  activeSlug?: string;
  hrefFor: (slug?: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge asChild variant={activeSlug ? "outline" : "default"}>
        <Link href={hrefFor()}>Todas</Link>
      </Badge>
      {categories.map((c) => (
        <Badge
          key={c.slug}
          asChild
          variant={activeSlug === c.slug ? "default" : "outline"}
        >
          <Link href={hrefFor(c.slug)}>{c.name}</Link>
        </Badge>
      ))}
    </div>
  );
}
