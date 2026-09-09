import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { CategoryIconChips } from "@/components/catalog/category-icon-chips";
import { ProductCard } from "@/components/catalog/product-card";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import type { PanelSuggestions } from "./sugerencias";

/** "Matemáticas, Inglés y Programación" — la última coma es una "y". */
function enumerar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? "";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

/**
 * N-30 · "Sugeridas para ti" en el panel del alumno (AL02).
 *
 * El subtítulo NO es decorativo: dice de dónde salen las tarjetas. Un carrusel
 * de recomendaciones que no explica por qué recomienda lo que recomienda se lee
 * como publicidad; y cuando la lista NO viene de sus temas —porque no eligió
 * ninguno, o porque los suyos aún no tienen nada publicado— hay que decirlo,
 * no dejar que parezca que el sistema cree que esto es lo suyo.
 *
 * Las burbujas del final solo aparecen en esos dos casos, y llevan a las
 * categorías que HOY tienen oferta: es la salida de RV-11, la misma que usa
 * `EmptyResults` en el catálogo.
 */
export function SugerenciasCard({ data }: { data: PanelSuggestions }) {
  const desdeSusTemas = data.source === "interests";

  const subtitulo = desdeSusTemas
    ? `Por los temas que te interesan: ${enumerar(data.temas.map((c) => c.name))}.`
    : data.source === "no-interests"
      ? "Todavía no nos dijiste qué temas te interesan, así que te mostramos lo último que se publicó."
      : // Cubre los dos motivos de `no-offer` —que sus temas no tengan nada
        // publicado, y que ya lo tenga todo reservado— sin mentir en ninguno.
        "Ahora mismo no hay nada nuevo en tus temas. Mientras tanto, lo último del catálogo.";

  return (
    <PanelCard>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <PanelCardTitle className="text-[22px]">
            {desdeSusTemas ? "Sugeridas para ti" : "Empieza por aquí"}
          </PanelCardTitle>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">{subtitulo}</p>
        </div>
        <Link
          href="/classes"
          className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
        >
          Ver todas
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>

      {/* `compact`: la columna del panel es más estrecha que la rejilla del
          catálogo, y estas tarjetas conviven con las filas de reservas. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.products.map((p) => (
          <ProductCard key={p.id} product={p} compact />
        ))}
      </div>

      {!desdeSusTemas && data.conOferta.length > 0 ? (
        <div className="mt-5 flex flex-col items-start gap-2 border-t border-[#e0e0e0] pt-4">
          <p className="text-[13px] text-[#6b6b6b]">O elige un tema:</p>
          {/* `tone="light"`: la tarjeta del panel es blanca (ver CategoryIconChips).

              Verónica (3-sep-2026, captura 27 del panel a 390): «slider y
              sustituir por textos en lugar de iconos». `layout="strip"` = UNA
              fila con scroll horizontal por debajo de `lg` (antes: 9 círculos
              en dos filas, medido 316×96); `variant="text"` = el nombre de la
              categoría en vez del ícono. Desde `lg` no cambia nada (R1).

              ⚠️ El sangrado que trae el componente es el de `Container`
              (20/24/32) y aquí el padre es una `PanelCard`, que es `p-5` FIJO a
              todos los anchos (medido: 20 px a 390 y a 768). Se pisa con 20 en
              los tres tramos para que la tira llegue justo al borde interior
              de la tarjeta: el último chip asoma cortado por ese borde, que es
              la señal de que hay más. */}
          <CategoryIconChips
            categories={data.conOferta}
            hrefFor={(slug) => `/categories/${slug}`}
            tone="light"
            layout="strip"
            variant="text"
            className="-mx-5 px-5 scroll-px-5 sm:-mx-5 sm:px-5 sm:scroll-px-5 md:-mx-5 md:px-5 md:scroll-px-5"
          />
        </div>
      ) : null}
    </PanelCard>
  );
}
