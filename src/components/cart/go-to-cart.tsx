"use client";

import Link from "next/link";
import { ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCartBump, useCartCount } from "@/components/cart/use-cart";

/**
 * EY-177 · B3.6 · «IR AL CARRITO», Y LA CONDICIÓN QUE LO GOBIERNA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ APARECE PORQUE EL CARRITO TIENE ALGO, **NO** PORQUE ACABES DE AÑADIR.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ésa es toda la regla, y es la que arregla el modelo anterior. Hasta ahora
 * «Ir al carrito» solo existía como consecuencia de haber pulsado «Agregar»: era
 * el segundo de los dos botones que SUSTITUÍAN al principal. O sea que dependía
 * de lo que hubieras hecho en esta vida del componente, y no de un hecho. Con
 * eso, quien recargaba la ficha, volvía con el botón atrás o abría un enlace
 * compartido se quedaba sin puerta al carrito aunque tuviera tres mentorías
 * dentro.
 *
 * Aquí la condición es `n > 0` y punto: sobrevive a la recarga, vuelve al
 * entrar desde otra pantalla y **desaparece sola al vaciar el carrito** —
 * incluso desde otra pestaña, porque `useCartCount` está suscrito a la cookie y
 * no a un `useState` propio.
 *
 * ⚠️ ES UN COMPONENTE APARTE DE `AddToCart` Y NO UN TROZO SUYO. Son dos
 * condiciones distintas: el principal depende de la SELECCIÓN (mentoría + hora)
 * y éste del CARRITO. Meterlos en el mismo componente obligaría a pasarle la
 * selección a algo que no la necesita, y volvería a atarlos — que es justo el
 * error que se está deshaciendo. Además así el panel puede pintarlo también
 * bajo el CTA del PAQUETE, que no pasa por `AddToCart`.
 */
export function GoToCart({
  initial,
  className,
  /*
   * ⚠️ 42 px Y NO 51, Y ESTÁ MEDIDO CONTRA UN COSTE CONOCIDO. En la ficha, esta
   * zona es la barra `sticky bottom-0` de B3.5, que en móvil FLOTA sobre el
   * panel y ya documenta un solape transitorio con los controles de arriba.
   * Apilar un segundo botón la hace más alta —de ~85 a ~135 px—, o sea que ese
   * solape empeora un poco. Se acepta a sabiendas: el modelo nuevo exige que la
   * acción principal y la puerta al carrito estén las DOS a la vista, y ponerlos
   * en fila (que es como convivían los dos del modelo viejo) haría que la
   * principal midiera media barra. Lo que sí se hace es no gastar de más: 42 px
   * de alto y tipografía secundaria, que es lo mínimo cómodo para un pulgar.
   */
  buttonClassName = "h-[42px] w-full text-[13.5px]",
}: {
  /** Líneas que había al pintar en servidor (`cartCount()`). Evita el parpadeo. */
  initial: number;
  className?: string;
  buttonClassName?: string;
}) {
  const n = useCartCount(initial);
  const saltando = useCartBump(n, initial);

  if (n === 0) return null;

  return (
    <div className={className}>
      {/* `outline` y no relleno: el botón lleno de esta zona es «Agregar al
          carrito», que es la acción principal de la pantalla. Dos botones
          rellenos seguidos se leen como dos acciones igual de importantes. */}
      <Button asChild variant="outline" className={cn(buttonClassName)}>
        <Link href="/carrito">
          <ShoppingCartIcon className="size-4" />
          Ir al carrito
          {/*
            EY-178 · EL SALTO **EN EL PUNTO DE LA ACCIÓN**.
            La insignia de la cabecera ya salta (`cart-badge.tsx`), pero vive en
            la esquina de arriba mientras el botón está bajo el dedo: en un
            teléfono, la mitad del acuse de recibo ocurría donde nadie miraba.
            Este contador está a 8 px del sitio donde se acaba de pulsar.

            Se REUSA `.animate-cart-bump` de `globals.css` —la misma clase, los
            mismos 280 ms— en vez de inventar otra animación: dos acuses del
            mismo hecho con dos tiempos distintos se leen como dos cosas.
            Y por eso el número va aquí dentro y no solo en la cabecera: sin una
            cifra que cambie, un salto no dice CUÁNTAS llevas.
          */}
          <span
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-white",
              saltando && "animate-cart-bump",
            )}
          >
            {n > 9 ? "9+" : n}
          </span>
        </Link>
      </Button>
    </div>
  );
}
