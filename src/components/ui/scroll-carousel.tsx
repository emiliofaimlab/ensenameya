"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Carrusel de tarjetas: pista con scroll horizontal, anclaje por tarjeta y dos
 * flechas.
 *
 * ── POR QUÉ NO SE INSTALA EMBLA / SWIPER / KEEN ─────────────────────────────
 * Porque el navegador ya hace esto. `overflow-x: auto` + `scroll-snap` da el
 * arrastre táctil, la inercia, el anclaje y —lo que ninguna librería regala
 * gratis— el comportamiento de teclado correcto: al tabular, el enlace que
 * recibe el foco se desplaza a la vista él solo. Lo único que falta en
 * escritorio son las flechas, que son doce líneas. Una dependencia de 15 kB
 * para eso no se paga.
 *
 * ⚠️ NO es el «carrusel» de `testimonials.tsx`. Aquel es una marquesina de CSS
 * puro con la pista duplicada y `aria-hidden` en las copias: no se puede
 * controlar, no se puede parar y sus tarjetas no pueden llevar enlaces (habría
 * dos destinos idénticos, uno oculto). Sirve para decorar la portada y no vale
 * para contenido en el que hay que poder pinchar.
 *
 * La pista es un `<ul>`; quien lo usa pone los `<li>` con su propio ancho fijo
 * (`shrink-0`), que es lo que hace que haya algo que desplazar.
 */
export function ScrollCarousel({
  label,
  className,
  children,
}: {
  /** Para el lector de pantalla: qué es esta pista. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pista = useRef<HTMLUListElement>(null);
  const [puede, setPuede] = useState({ atras: false, adelante: false });

  const medir = useCallback(() => {
    const el = pista.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // Los 4 px de holgura no son manía: con anchos fraccionarios `scrollLeft`
    // no llega nunca exactamente a `max`, y sin margen la flecha de avanzar se
    // quedaba encendida —y sin efecto— al final del recorrido.
    setPuede({ atras: el.scrollLeft > 4, adelante: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    medir();
    const el = pista.current;
    if (!el) return;
    // `ResizeObserver` y no `window.resize`: la pista también cambia de ancho
    // cuando se pliega el menú lateral del panel, sin que la ventana se mueva.
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir]);

  const mover = (signo: 1 | -1) => {
    const el = pista.current;
    if (!el) return;
    // Se avanza por PÁGINAS (90 % de lo visible) y no por un ancho de tarjeta
    // fijo: caben distintas tarjetas según el sitio disponible, y un salto fijo
    // dejaría media tarjeta cortada en unos tamaños y no en otros.
    el.scrollBy({
      left: signo * el.clientWidth * 0.9,
      // Se consulta la preferencia del sistema en vez de dar el desplazamiento
      // suave por hecho: `behavior: "smooth"` NO respeta `prefers-reduced-
      // motion` por sí solo, al contrario que la regla CSS equivalente.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const flecha =
    "grid size-8 place-items-center rounded-full border border-[#e0e0e0] bg-card text-[#4d4d4d] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className={cn("relative", className)}>
      <ul
        ref={pista}
        onScroll={medir}
        // `tabIndex={-1}` y NO 0: la pista no debe ser una parada de tabulación
        // propia, porque los enlaces de dentro ya lo son y pararse dos veces en
        // el mismo sitio confunde. Firefox la hace enfocable sola por tener
        // scroll; esto lo desactiva sin perder el desplazamiento con flechas.
        tabIndex={-1}
        role="list"
        aria-label={label}
        className={cn(
          "flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1",
          // Barra oculta: el desplazamiento se comunica con las flechas y con
          // la tarjeta cortada del borde, y una barra fina dentro de una
          // tarjeta del panel ensucia más de lo que informa.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {children}
      </ul>

      {/* Las flechas solo se montan si hay algo que desplazar: con tres
          tarjetas en una pantalla ancha no hay recorrido, y dos botones
          apagados permanentes son ruido. `puede` empieza en `false/false`, así
          que en el primer render del servidor no hay flechas — se encienden
          tras medir, que es cuando de verdad se sabe. */}
      {puede.atras || puede.adelante ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className={flecha}
            onClick={() => mover(-1)}
            disabled={!puede.atras}
            aria-label="Anterior"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            className={flecha}
            onClick={() => mover(1)}
            disabled={!puede.adelante}
            aria-label="Siguiente"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
