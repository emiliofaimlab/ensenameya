"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cartCountSnapshot, subscribeCart } from "@/lib/cart/cookie";

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
  const n = useSyncExternalStore(
    subscribeCart,
    cartCountSnapshot,
    // En el servidor no hay `document.cookie`: el número lo trae el layout, que
    // sí la leyó con `cookies()`.
    () => initial,
  );

  /*
   * EY-178 · el salto de la insignia al AÑADIR.
   *
   * ⚠️ Solo cuando el número SUBE. Al quitar una línea o al limpiarse la que ya
   * se pagó, la insignia se queda quieta: un acuse de recibo que también salta
   * al perder algo deja de significar «hecho» y pasa a significar «ha pasado
   * algo», que no sirve para nada.
   *
   * Hace falta porque el botón de «Agregar al carrito» cambia justo debajo del
   * dedo mientras el contador vive en la esquina de arriba: sin el salto, la
   * mitad de la respuesta ocurre donde nadie está mirando.
   *
   * `previo` arranca en `initial` y no en 0 a propósito — si no, la insignia
   * saltaría sola en cada carga de página con el carrito ya lleno.
   */
  const previo = useRef(initial);
  const [saltando, setSaltando] = useState(false);
  useEffect(() => {
    const subio = n > previo.current;
    previo.current = n;
    if (!subio) return;
    setSaltando(true);
    const t = setTimeout(() => setSaltando(false), 300);
    return () => clearTimeout(t);
  }, [n]);

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
