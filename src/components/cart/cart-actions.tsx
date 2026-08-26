"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";

import { removeCartLines } from "@/lib/cart/cookie";
import { cn } from "@/lib/utils";

/**
 * EY-177 · las dos escrituras del carrito que hace la pantalla de revisión.
 *
 * La pantalla es un Server Component (lee la cookie con `cookies()` y resuelve
 * precios contra la base), así que lo único que baja al navegador es esto: un
 * botón que quita y un efecto que limpia. Ninguno de los dos sabe nada de
 * dinero — le dicen a la cookie qué líneas ya no están, y `router.refresh()`
 * hace que el servidor vuelva a pintar la verdad.
 */

/** Quitar una línea del carrito. */
export function RemoveLine({
  lineKey,
  etiqueta,
  className,
}: {
  lineKey: string;
  /** Para el lector de pantalla: «Quitar Álgebra del carrito». */
  etiqueta: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={`Quitar ${etiqueta} del carrito`}
      onClick={() => {
        removeCartLines([lineKey]);
        router.refresh();
      }}
      className={cn(
        "inline-flex items-center gap-1 text-[13px] text-[#6b6b6b] transition-colors hover:text-destructive",
        className,
      )}
    >
      <XIcon className="size-3.5" />
      Quitar
    </button>
  );
}

/** Vaciar el carrito entero. */
export function ClearCart({ keys }: { keys: string[] }) {
  const router = useRouter();
  if (keys.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        removeCartLines(keys);
        router.refresh();
      }}
      className="text-[13px] text-[#6b6b6b] transition-colors hover:text-destructive"
    >
      Vaciar carrito
    </button>
  );
}

/**
 * ⚠️ EL AUTOLIMPIADO DE LO YA COMPRADO. Sin esto el carrito miente.
 *
 * Hoy las líneas se pagan de una en una (ver la nota de EY-176 en
 * `lib/cart/cookie.ts`). Al volver de pagar la primera, esa línea sigue en la
 * cookie: la compra no la borra, porque el checkout no sabe que existe un
 * carrito —y no debe saberlo: es el mismo checkout de una reserva suelta de
 * siempre, y meterle dependencias del carrito es justo lo que este encargo NO
 * hace—.
 *
 * Así que la limpieza se hace al volver a la revisión, y la decide el SERVIDOR:
 * `resolveCart()` busca reservas vivas del alumno que casen exactamente con
 * cada línea y, si alguna ya pasó de `pending_payment`, la da por comprada y la
 * saca de la lista visible. Este componente solo ejecuta esa decisión sobre la
 * cookie, que es lo único que no puede hacer el servidor desde un render.
 *
 * ⚠️ Sin `router.refresh()` a propósito. El servidor YA pintó la página sin
 * esas líneas —vienen aparte, en `compradas`—, así que refrescar sería un viaje
 * de ida y vuelta para pintar exactamente lo mismo. Lo que sí hace falta es que
 * el contador de la cabecera se entere, y de eso ya se encarga el `CART_EVENT`
 * que dispara la escritura de la cookie.
 *
 * El `ref` evita repetir la escritura si React remonta el efecto (StrictMode en
 * desarrollo monta, desmonta y vuelve a montar).
 */
export function PruneBought({ keys }: { keys: string[] }) {
  const hecho = useRef(false);
  useEffect(() => {
    if (hecho.current || keys.length === 0) return;
    hecho.current = true;
    removeCartLines(keys);
  }, [keys]);
  return null;
}
