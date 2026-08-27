import Link from "next/link";

import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import type { CategoryTag } from "@/lib/catalog/queries";
import { cn } from "@/lib/utils";

/**
 * RV-11 · el mismo callejón, la misma salida.
 *
 * El BUSCADOR sin resultados ya ofrecía por dónde seguir: las categorías reales
 * y "Ver todas". Los listados —P05, P04, P06— se quedaban en un párrafo gris,
 * "prueba con otra categoría", sin decir cuáles ni enlazar a ninguna: con los
 * filtros puestos y cero resultados, la única salida era el botón de atrás.
 * Son dos estados vacíos del MISMO producto y no pueden tener dos criterios.
 *
 * Esto es el estado vacío de P09 extraído tal cual —no un patrón nuevo—, para
 * que al cambiarlo cambie en las cuatro pantallas a la vez.
 */
export function EmptyResults({
  message,
  categories,
  hrefFor = (slug) => `/categories/${slug}`,
  action,
  className,
}: {
  /** Qué no se encontró, con las palabras de la pantalla que lo dice. */
  message: string;
  categories: CategoryTag[];
  /**
   * A dónde lleva cada burbuja. Por defecto a la categoría; los listados con
   * filtros la sobrescriben para quedarse en la MISMA pantalla ya filtrada —
   * salir del listado para volver a entrar es la salida peor.
   */
  hrefFor?: (slug: string) => string;
  /** La salida directa: quitar los filtros, salir de la categoría, ampliar. */
  action?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      <p className="text-sm text-muted-foreground">
        {message}
        {action ? (
          <>
            {" "}
            <Link
              href={action.href}
              className="font-medium text-brand hover:underline"
            >
              {action.label}
            </Link>
            .
          </>
        ) : null}
      </p>

      {/* Sin categorías activas no hay salida que ofrecer y las burbujas
          sobran: se queda el mensaje solo, que ya es lo que había. */}
      {categories.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            O empieza por una categoría:
          </p>
          {/* `tone="light"` — estas pantallas son de fondo blanco; el "hero" del
              home dibuja la píldora en claro y aquí no se vería. */}
          <CategoryIconChips
            categories={categories}
            hrefFor={hrefFor}
            tone="light"
          />
        </>
      ) : null}
    </div>
  );
}
