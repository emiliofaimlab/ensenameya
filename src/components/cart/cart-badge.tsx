"use client";

import Link from "next/link";
import { ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCartBump, useCartCount } from "@/components/cart/use-cart";

/**
 * EY-177 · el carrito en la cabecera, con su contador.
 *
 * El precedente visual es exacto y se copia: `notifications-bell.tsx` recibe su
 * lista `initial` ya resuelta en el layout de servidor y pinta la insignia en
 * el primer render, sin ida y vuelta. Aquí igual — `initial` sale de la cookie
 * leída con `cookies()` en el layout, y por eso el SSR ya trae el número bueno.
 *
 * ⚠️ POR QUÉ ADEMÁS SE RELEE EN EL NAVEGADOR, y por qué eso NO es estado global.
 *
 * En el App Router un layout **no se vuelve a renderizar** al navegar dentro de
 * su propio segmento: Next reutiliza el que ya tiene en la caché del router. O
 * sea que `initial` se queda congelado en el valor que tuviera la última vez que
 * el servidor pintó ESE layout, y el contador mentiría en cuanto alguien
 * añadiera algo. `router.refresh()` (que es lo que hace `AddToCart`) invalida esa
 * caché y arregla el caso normal, pero no cubre los raros: otra pestaña, el
 * botón atrás sobre una entrada cacheada, o la línea que la pantalla de revisión
 * limpia sola tras pagarla.
 *
 * La red de seguridad es `useSyncExternalStore` sobre la propia cookie: React
 * pinta `initial` en el servidor y en la hidratación, y en cuanto está en el
 * navegador vuelve a preguntar y se resuscribe a `CART_EVENT`. No se guarda
 * ninguna copia de la verdad, no hay proveedor, no hay contexto y no hay
 * tienda — que importa porque este contador se pinta desde DOS layouts
 * (`(public)` y `(app)`) que nunca comparten árbol de React: un contexto habría
 * exigido subirlo al layout raíz solo para esto.
 */
export function CartBadge({ initial }: { initial: number }) {
  // En el servidor no hay `document.cookie`: el número lo trae el layout, que
  // sí la leyó con `cookies()`.
  const n = useCartCount(initial);

  /*
   * EY-178 · el salto de la insignia al AÑADIR.
   *
   * ⚠️ El gancho salió de aquí a `use-cart.ts` cuando el «Ir al carrito» del
   * panel de reserva empezó a necesitar exactamente el mismo salto. El porqué
   * de cada decisión (solo al subir, `previo` desde `initial`, los 300 ms) está
   * allí. Aquí queda lo que es propio de la insignia: que sigue haciendo falta
   * porque el botón de «Agregar al carrito» está bajo el dedo y este contador
   * vive en la esquina de arriba.
   */
  const saltando = useCartBump(n, initial);

  return (
    <Button
      variant="ghost"
      size="icon"
      asChild
      className="relative rounded-full"
    >
      <Link
        href="/carrito"
        aria-label={
          n > 0
            ? `Carrito (${n} ${n === 1 ? "mentoría" : "mentorías"})`
            : "Carrito"
        }
      >
        <ShoppingCartIcon className="size-[18px]" />
        {n > 0 ? (
          <span className={`absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-white${saltando ? " animate-cart-bump" : ""}`}>
            {n > 9 ? "9+" : n}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
