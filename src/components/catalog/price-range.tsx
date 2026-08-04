"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Slider } from "radix-ui";

import { formatMoney } from "@/lib/catalog/format";

/**
 * DD-04 · "Inversión por clase" de P04 como **rango continuo** (decisión de
 * Jose en EY-114), no los cuatro tramos fijos del Figma.
 *
 * Los extremos salen de los datos (`tutorPriceBounds`), no de constantes: si
 * mañana entra un tutor de 300 US$ el deslizador llega hasta ahí solo.
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
  const [rango, setRango] = useState<[number, number]>([actual.min, actual.max]);

  // Nota: la URL manda. Cuando cambia (limpiar filtros, atrás del navegador) el
  // padre remonta este componente con `key`, así que el estado se reinicia solo
  // — sin efecto que sincronice, que es la forma que React recomienda.

  // Paso de 1 US$: el catálogo se mueve en dólares enteros y un paso más fino
  // sólo daría rangos imposibles de clavar con el ratón.
  const paso = 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-[#242424]">Inversión por clase</p>
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
        {formatMoney(rango[0], "USD")} – {formatMoney(rango[1], "USD")}
      </p>

      <Slider.Root
        className="relative mt-3 flex h-5 w-full touch-none items-center select-none"
        value={rango}
        min={bounds.min}
        max={bounds.max}
        step={paso}
        minStepsBetweenThumbs={1}
        onValueChange={([a, b]) => setRango([a, b])}
        onValueCommit={([a, b]) =>
          router.push(
            // Un extremo que coincide con el del catálogo no acota nada: se
            // omite para que la URL no lleve ruido ni marque el filtro activo.
            hrefFor({
              pmin: a > bounds.min ? a : undefined,
              pmax: b < bounds.max ? b : undefined,
            }),
            { scroll: false },
          )
        }
        aria-label="Rango de precio"
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-[#e0e0e0]">
          <Slider.Range className="absolute h-full rounded-full bg-brand" />
        </Slider.Track>
        {["mínimo", "máximo"].map((etiqueta) => (
          <Slider.Thumb
            key={etiqueta}
            aria-label={`Precio ${etiqueta}`}
            className="block size-4 rounded-full border-2 border-brand bg-card shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        ))}
      </Slider.Root>
    </div>
  );
}
