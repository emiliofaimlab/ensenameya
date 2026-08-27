"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Slider } from "radix-ui";

import { formatMoney } from "@/lib/catalog/format";
import { STEPS, posToPrice, priceToPos } from "@/lib/catalog/log-scale";

/**
 * DD-04 · "Inversión por clase" de P04 como **rango continuo** (decisión de
 * Jose en EY-114), no los cuatro tramos fijos del Figma.
 *
 * Los extremos salen de los datos (`tutorPriceBounds`), no de constantes: si
 * mañana entra un tutor de 300 US$ el deslizador llega hasta ahí solo.
 *
 * **Escala logarítmica** (`log-scale.ts`): el deslizador se mueve en posiciones
 * y el precio se calcula al vuelo. Con un tutor a 120 US$ y el resto entre 10 y
 * 25, la escala lineal amontonaba los dos pomos en el primer 12 % del
 * recorrido. Los datos no cambian: la URL sigue llevando precios reales.
 *
 * El estado sigue viviendo en la URL, como el resto de filtros de la pantalla:
 * sólo se navega al SOLTAR (`onValueCommit`), no en cada pixel del arrastre —
 * si no, cada movimiento sería una consulta.
 *
 * ponytail: es el único filtro de P04 que necesita JS. Sin él no se pinta el
 * control, pero `?pmin=`/`?pmax=` en la URL siguen filtrando igual, porque
 * quien filtra es el servidor.
 */
export function PriceRange({
  bounds,
  value,
  baseHref,
}: {
  /** Mínimo y máximo reales del catálogo, en unidades menores. */
  bounds: { min: number; max: number };
  /** Rango seleccionado, o `null` si el filtro está sin tocar. */
  value: { min: number; max: number } | null;
  /**
   * La URL de la pantalla con el RESTO de filtros ya puestos y sin `pmin`/`pmax`.
   * Llega hecha en vez de una función porque este componente es de cliente y las
   * funciones no cruzan la frontera desde el servidor; así además la URL la
   * sigue construyendo un solo sitio (`buildHref` de la página).
   */
  baseHref: string;
}) {
  const router = useRouter();

  const hrefFor = ({ pmin, pmax }: { pmin?: number; pmax?: number }) => {
    const [ruta, query = ""] = baseHref.split("?");
    const p = new URLSearchParams(query);
    p.delete("pmin");
    p.delete("pmax");
    p.delete("page"); // cambiar el rango vuelve a la página 1
    if (pmin != null) p.set("pmin", String(pmin));
    if (pmax != null) p.set("pmax", String(pmax));
    const q = p.toString();
    return q ? `${ruta}?${q}` : ruta;
  };
  const actual = value ?? bounds;
  // El estado del control son POSICIONES, no precios: es lo que el deslizador
  // reparte de forma uniforme. El precio se deriva al pintar y al navegar.
  const [pos, setPos] = useState<[number, number]>([
    priceToPos(actual.min, bounds),
    priceToPos(actual.max, bounds),
  ]);
  const precio = (p: number) => posToPrice(p, bounds);

  // Nota: la URL manda. Cuando cambia (limpiar filtros, atrás del navegador) el
  // padre remonta este componente con `key`, así que el estado se reinicia solo
  // — sin efecto que sincronice, que es la forma que React recomienda.

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-[#242424]">Inversión por sesión</p>
        {value ? (
          <a
            href={hrefFor({})}
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            Quitar
          </a>
        ) : null}
      </div>

      <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
        {formatMoney(precio(pos[0]), "USD")} – {formatMoney(precio(pos[1]), "USD")}
      </p>

      <Slider.Root
        className="relative mt-3 flex h-5 w-full touch-none items-center select-none"
        value={pos}
        min={0}
        max={STEPS}
        step={1}
        minStepsBetweenThumbs={1}
        onValueChange={([a, b]) => setPos([a, b])}
        onValueCommit={([a, b]) => {
          const min = precio(a);
          const max = precio(b);
          router.push(
            // Un extremo que coincide con el del catálogo no acota nada: se
            // omite para que la URL no lleve ruido ni marque el filtro activo.
            hrefFor({
              pmin: min > bounds.min ? min : undefined,
              pmax: max < bounds.max ? max : undefined,
            }),
            { scroll: false },
          );
        }}
        aria-label="Rango de precio"
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-[#e0e0e0]">
          <Slider.Range className="absolute h-full rounded-full bg-brand" />
        </Slider.Track>
        {["mínimo", "máximo"].map((etiqueta, i) => (
          <Slider.Thumb
            key={etiqueta}
            aria-label={`Precio ${etiqueta}`}
            // Sin esto un lector de pantalla cantaría la POSICIÓN ("60"), que
            // no significa nada para quien filtra: el valor real es el precio.
            aria-valuetext={formatMoney(precio(pos[i]), "USD")}
            // El punto mide 16 px, por debajo de los 24 que pide WCAG 2.5.8;
            // el `before` agranda el área tocable sin engordar el dibujo.
            className="relative block size-4 rounded-full border-2 border-brand bg-card shadow-sm before:absolute before:-inset-2 before:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        ))}
      </Slider.Root>
    </div>
  );
}
