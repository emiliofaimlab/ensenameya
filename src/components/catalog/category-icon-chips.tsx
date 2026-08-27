import Link from "next/link";
import { LayoutGridIcon } from "lucide-react";

import { categoryIcon } from "@/components/catalog/category-icons";
import type { CategoryTag } from "@/lib/catalog/queries";
import { cn } from "@/lib/utils";

/**
 * Burbujas de categoría **colapsadas a ícono**, con la etiqueta que se despliega
 * al pasar el ratón (o al enfocar con teclado) — el patrón del home (P01), ahora
 * en todas las vistas de exploración (acuerdo 24-jul). La categoría **activa**
 * va siempre desplegada y resaltada. Si hay más de `limit`, una burbuja
 * "Ver todas" enlaza al índice para no acumular decenas de círculos.
 *
 * `tone`: "hero" (por defecto) para fondos oscuros/de color (la píldora blanca
 * aparece al hover, como en el home); "light" para fondos claros (añade sombra
 * y borde para que la píldora resalte).
 */
export function CategoryIconChips({
  categories,
  activeSlug,
  hrefFor,
  limit = 8,
  moreHref = "/categories",
  tone = "hero",
  className,
}: {
  categories: CategoryTag[];
  activeSlug?: string;
  /** Enlace de cada burbuja. En filtros, alterna la categoría (undefined = quitar). */
  hrefFor: (slug: string) => string;
  /** Cuántas burbujas antes de "Ver todas" (0 = todas, sin corte). */
  limit?: number;
  moreHref?: string;
  tone?: "hero" | "light";
  className?: string;
}) {
  const shown = limit > 0 ? categories.slice(0, limit) : categories;
  const hasMore = limit > 0 && categories.length > limit;

  // Píldora que envuelve al chip: blanca al hover (o fija si está activo). En
  // fondo claro necesita sombra/borde para despegarse del fondo.
  const pill =
    tone === "light"
      ? { hover: "hover:bg-card hover:shadow-sm focus-visible:bg-card", active: "bg-card shadow-sm ring-1 ring-border" }
      : { hover: "hover:bg-background focus-visible:bg-background", active: "bg-background shadow-sm" };

  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {shown.map((c) => {
        const Icon = categoryIcon(c.icon);
        const active = c.slug === activeSlug;
        return (
          <li key={c.slug}>
            <Link
              href={hrefFor(c.slug)}
              aria-label={c.name}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center rounded-full p-1 text-sm font-semibold text-foreground transition-colors",
                active ? pill.active : pill.hover,
              )}
            >
              {/* Círculo naranja; azul al desplegarse (hover) o si está activo. */}
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full text-primary-foreground transition-colors",
                  active
                    ? "bg-brand"
                    : "bg-primary group-hover:bg-brand group-focus-visible:bg-brand",
                )}
              >
                <Icon className="size-4.5" />
              </span>
              {/* El nombre solo ocupa sitio al desplegarse (o si está activo). */}
              <span
                className={cn(
                  "grid transition-[grid-template-columns] duration-200",
                  active
                    ? "grid-cols-[1fr]"
                    : "grid-cols-[0fr] group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]",
                )}
              >
                <span className="min-w-0 overflow-hidden whitespace-nowrap">
                  <span className="px-2.5">{c.name}</span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}

      {hasMore ? (
        <li>
          <Link
            href={moreHref}
            aria-label="Ver todas las categorías"
            className={cn(
              "group flex items-center rounded-full p-1 text-sm font-semibold text-foreground transition-colors",
              pill.hover,
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-brand group-hover:text-white group-focus-visible:bg-brand group-focus-visible:text-white">
              <LayoutGridIcon className="size-4.5" />
            </span>
            <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]">
              <span className="min-w-0 overflow-hidden whitespace-nowrap">
                <span className="px-2.5">Ver todas</span>
              </span>
            </span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
