"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type FilterPill = {
  /** Identificador estable del filtro (`cat`, `price`, `lang`…). */
  key: string;
  /** Rótulo de la píldora cuando no hay nada elegido. */
  label: string;
  /** Lo elegido; sustituye al rótulo y pinta la píldora en azul. */
  current?: string;
  /** Opciones como enlaces: el estado vive en la URL, como en los paneles laterales. */
  options?: { label: string; href: string; active?: boolean }[];
  /**
   * Contenido libre del panel (p. ej. el deslizador de precio). Si llega, gana
   * a `options`.
   */
  panel?: React.ReactNode;
};

/**
 * Filtros de catálogo en MÓVIL: una fila de píldoras desplegables con scroll
 * horizontal y UN panel debajo con el filtro abierto — «estilo Shein», que es
 * la referencia que mandó Verónica (correo del 3-sep-2026, IMG_4157).
 *
 * Es la versión táctil de los `<details>` de la fila de `category-explorer`
 * (386:1558) y sustituye en pantallas pequeñas al panel lateral de P04/P05,
 * que a 390 px empujaba los resultados media pantalla hacia abajo.
 *
 * Medidas del Figma móvil `P06 · tabs-filters` (PNG a escala 2, ÷2): píldora
 * de 36 px de alto, radio 8, borde #d1d1d1, texto ≈13,5 px #474747, padding
 * lateral ≈14,5, 8 px entre píldoras, y la última cortada por el borde
 * derecho —es la señal de que hay más—. La píldora se sube a 40 px por el
 * tacto (mínimo del proyecto); el resto se copia tal cual.
 *
 * ── POR QUÉ EL PANEL VA EN FLUJO Y NO FLOTANDO ──────────────────────────────
 * Los `<details>` de escritorio abren una lista `absolute` bajo su píldora.
 * Aquí la fila tiene `overflow-x: auto`, y un `overflow` en un eje convierte
 * al otro en `auto` también: todo lo posicionado que se salga se RECORTA. Un
 * solo panel debajo de la fila, en flujo, no se recorta, no tapa la primera
 * tarjeta y deja la lista de opciones con toda la anchura para las filas de
 * 44 px.
 *
 * ponytail: solo estado local (`open`) y sin cerrar al tocar fuera — el panel
 * está en flujo, así que no tapa nada que haya que rescatar; se cierra al
 * elegir, al volver a tocar la píldora o con Escape.
 */
export function FilterPills({
  filters,
  clearHref,
  className,
  ariaLabel = "Filtros",
}: {
  filters: FilterPill[];
  /** URL sin ningún filtro; «Limpiar» solo se pinta si hay algo elegido. */
  clearHref?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const id = useId();
  const pildoras = useRef(new Map<string, HTMLButtonElement>());

  const panelId = `${id}-panel`;
  const pillId = (key: string) => `${id}-pill-${key}`;
  const abierto = filters.find((f) => f.key === open) ?? null;
  const algunActivo = filters.some((f) => f.current);

  return (
    <div
      className={className}
      // Escape cierra y devuelve el foco a la píldora, esté el foco donde esté
      // (en la propia píldora o dentro del panel).
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        const key = open;
        setOpen(null);
        pildoras.current.get(key)?.focus();
      }}
    >
      {/* `scroll-strip` (globals.css) es la tira: sin barra, con anclaje y sin
          «atrás» del navegador al llegar al final. El sangrado hasta el borde
          del viewport lo pone el consumidor, como dice la propia utilidad: los
          márgenes negativos deshacen el padding del `Container` (20 / 24 / 32),
          el padding lo repone y `scroll-px-*` lo iguala para que el anclaje
          alinee la píldora con el contenido. Así la primera píldora queda
          alineada y la última asoma cortada por la derecha.
          `py-1 -my-1`: un contenedor con scroll recorta lo que asoma fuera de
          sus hijos, y sin ese aire el anillo de foco de la píldora se quedaba
          sin los 3 px de arriba y abajo. */}
      <div
        role="group"
        aria-label={ariaLabel}
        className="scroll-strip -mx-5 -my-1 gap-2 px-5 py-1 scroll-px-5 sm:-mx-6 sm:px-6 sm:scroll-px-6 md:-mx-8 md:px-8 md:scroll-px-8"
      >
        {/* ⚠️ «Limpiar» va PRIMERO, no al final. Medido a 390 con los cinco
            filtros de /tutors: al final empieza en x≈795, o sea 400 px fuera
            de la pantalla — quien acaba de marcar dos filtros ve dos píldoras
            azules y ninguna forma de deshacerlas sin arrastrar la tira a
            ciegas. Delante se ve siempre y es donde Shein pone el estado de
            los filtros, que es la referencia que dio Verónica. Solo aparece
            cuando hay algo que limpiar, así que la fila no se mueve por él en
            el caso normal. */}
        {algunActivo && clearHref ? (
          <Link
            href={clearHref}
            /* Igual que las opciones del panel: quitar los filtros no puede
               llevarte al principio de la página. */
            scroll={false}
            onClick={() => setOpen(null)}
            className="flex h-10 items-center rounded-[8px] px-2 text-[13px] font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* «Limpiar filtros» y no «Limpiar» a secas: en los paneles de
                escritorio la palabra va pegada al título «Filtros», que le da
                el objeto; aquí no hay título, y a un dedo del buscador del
                hero un «Limpiar» suelto se lee como «limpiar la búsqueda». */}
            Limpiar filtros
          </Link>
        ) : null}

        {filters.map((f) => {
          const isOpen = f.key === open;
          return (
            <button
              key={f.key}
              type="button"
              id={pillId(f.key)}
              ref={(el) => {
                if (el) pildoras.current.set(f.key, el);
                else pildoras.current.delete(f.key);
              }}
              aria-expanded={isOpen}
              aria-controls={panelId}
              /* Con un valor elegido el texto visible pasa a ser el VALOR
                 («Hoy», «4.5 o más»), así que el nombre accesible perdía el
                 filtro al que pertenece: un lector de pantalla oía «Hoy,
                 botón, contraído» sin saber que eso es Disponibilidad. El
                 `aria-label` repone el par y sigue conteniendo el texto
                 visible, que es lo que pide 2.5.3 (etiqueta en el nombre). */
              aria-label={f.current ? `${f.label}: ${f.current}` : undefined}
              onClick={() => setOpen(isOpen ? null : f.key)}
              className={cn(
                // `flex-shrink: 0` y el anclaje los pone `scroll-strip` a sus hijos.
                "flex h-10 items-center gap-1.5 rounded-[8px] border bg-card px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                f.current
                  ? // `text-brand-foreground` (#036fda) y no `text-brand`
                    // (#0080ff): a 13,5 px el azul de marca sobre blanco da
                    // 3,8:1 y AA pide 4,5. El borde sí se queda en `brand`,
                    // que como componente solo necesita 3:1. A ojo son el
                    // mismo azul; el token ya existe para esto.
                    "border-brand text-brand-foreground"
                  : isOpen
                    ? "border-[#474747] text-foreground"
                    : "border-[#d1d1d1] text-[#474747]",
              )}
            >
              {f.current ?? f.label}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
              />
            </button>
          );
        })}
      </div>

      {/* El panel existe siempre (oculto cuando no hay nada abierto) para que
          el `aria-controls` de cada píldora apunte a un nodo real. */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={abierto ? pillId(abierto.key) : undefined}
        hidden={!abierto}
        className="mt-3 rounded-[12px] border border-[#e0e0e0] bg-card p-3"
      >
        {abierto?.panel ??
          (abierto?.options ? (
            // Una columna a 390; dos desde `sm:` para que diez categorías no
            // sean 440 px de panel en una tablet.
            <ul className="grid gap-x-3 sm:grid-cols-2">
              {/* ⚠️ La clave de cada fila es la ETIQUETA, no el `href`: dos
                  opciones del mismo grupo pueden compartir destino —«Cualquiera»
                  y la valoración ya activa apuntan las dos a la URL sin
                  `rating`— y con claves repetidas React avisa por consola y
                  puede saltarse o duplicar filas. Las etiquetas sí son únicas
                  dentro de un filtro. */}
              {abierto.options.map((o) => (
                <li key={`${abierto.key}:${o.label}`}>
                  {/* Fila de 44 px (tacto) con la misma casilla de 18 px que
                      los paneles laterales. Elegir navega y cierra. */}
                  <Link
                    href={o.href}
                    aria-current={o.active ? "true" : undefined}
                    /* ⚠️ `scroll={false}`, y es EL MISMO fallo que Verónica
                       reportó en los chips de categoría («brinca al elegir
                       opción», 3-sep). Next devuelve la página a scrollY 0 al
                       cambiar los parámetros de búsqueda, así que elegir un
                       filtro desde media página abajo te sube al hero y hay
                       que volver a bajar para ver el resultado del filtro que
                       acabas de tocar. Aquí duele más que en los chips: el
                       panel está abierto justo encima de los resultados. */
                    scroll={false}
                    onClick={() => setOpen(null)}
                    className="flex min-h-11 items-center gap-2.5 rounded-[8px] px-2 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-[18px] shrink-0 place-items-center rounded-[5px] border text-[11px]",
                        o.active
                          ? "border-brand bg-brand text-white"
                          : "border-[#b3b3b3] bg-card",
                      )}
                    >
                      {o.active ? "✓" : null}
                    </span>
                    {o.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null)}
      </div>
    </div>
  );
}
