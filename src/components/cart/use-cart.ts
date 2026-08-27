"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cartCountSnapshot, subscribeCart } from "@/lib/cart/cookie";

/**
 * EY-178 · CUÁNTAS MENTORÍAS LLEVA EL CARRITO, Y CUÁNDO CELEBRARLO.
 *
 * Los dos ganchos vivían dentro de `cart-badge.tsx`. Se sacan aquí porque desde
 * el modelo nuevo de botones hay **dos** sitios que necesitan exactamente lo
 * mismo: la insignia de la cabecera y el «Ir al carrito» del panel de reserva.
 * Copiarlos era garantizar que uno de los dos se quedara atrás — y el que se
 * queda atrás es el que miente sobre lo que hay dentro del carrito.
 *
 * ⚠️ No hay estado global, ni contexto, ni tienda: la verdad sigue estando en
 * la cookie `ey-cart` y esto solo la lee. El porqué (dos layouts que nunca
 * comparten árbol de React) está escrito en `lib/cart/cookie.ts`.
 */

/**
 * El número de líneas del carrito **ahora mismo**.
 *
 * `initial` lo resuelve el servidor con `cookies()` y es lo que se pinta en SSR
 * y en la hidratación; en cuanto está en el navegador se vuelve a preguntar a la
 * cookie y se queda suscrito a `CART_EVENT`. Sin `initial` habría un parpadeo
 * de «carrito vacío» en cada carga con el carrito lleno.
 */
export function useCartCount(initial: number): number {
  return useSyncExternalStore(subscribeCart, cartCountSnapshot, () => initial);
}

/**
 * ¿toca dar el salto? `true` durante 300 ms cada vez que el número **SUBE**.
 *
 * ⚠️ Solo cuando sube. Al quitar una línea o al limpiarse la que ya se pagó, la
 * señal se queda quieta: un acuse de recibo que también salta al perder algo
 * deja de significar «hecho» y pasa a significar «ha pasado algo», que no sirve
 * para nada.
 *
 * ⚠️ `previo` arranca en `initial` y no en 0 a propósito — si no, saltaría solo
 * en cada carga de página con el carrito ya lleno.
 *
 * Los 300 ms cubren los 280 de la animación `.animate-cart-bump` de
 * `globals.css`. Si allí cambia la duración, este número va detrás.
 */
export function useCartBump(n: number, initial: number): boolean {
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

  return saltando;
}
