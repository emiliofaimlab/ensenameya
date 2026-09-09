"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 🔑 LA PANTALLA DE CONFIRMACIÓN SE REFRESCA SOLA MIENTRAS EL COBRO SE ACREDITA.
 *
 * ── POR QUÉ NO HACÍA FALTA ANTES Y AHORA SÍ ─────────────────────────────────
 *
 * Con Stripe, el alumno salía al formulario alojado, pagaba y volvía. Ese viaje
 * de ida y vuelta daba de sobra para que el webhook aterrizara, así que cuando
 * esta pantalla se pintaba la reserva ya estaba en `pending_acceptance` y la
 * rama de «Estamos confirmando tu pago» casi nunca se veía.
 *
 * Con el checkout transparente de dLocal (dictado del 9-sep-2026) no hay viaje:
 * el alumno pulsa «Pagar» y aterriza aquí en el acto, **antes** de que el
 * webhook haya llegado. Sin esto vería «Estamos confirmando tu pago» y ahí se
 * quedaría hasta que recargara a mano — sobre un pago que ya se hizo. Es la
 * clase de pantalla que hace que alguien pague dos veces.
 *
 * ── LO QUE ESTE COMPONENTE **NO** HACE ──────────────────────────────────────
 *
 * No acredita nada ni pregunta por el pago a ningún proveedor. Solo vuelve a
 * pedir la página, que lee el estado de la base. Quien mueve `payments` a
 * `paid` sigue siendo el webhook y solo el webhook (regla de oro 2).
 *
 * ⚠️ Y SE RINDE. Nueve intentos, cada dos segundos: si en ~18 segundos el
 * webhook no ha entrado, algo pasa y refrescar cien veces no lo va a arreglar —
 * solo castiga al servidor y calienta el teléfono. El texto de la pantalla ya
 * dice que puede cerrar y que se le avisa por correo, que es la verdad.
 */
const CADA_MS = 2000;
const INTENTOS = 9;

export function EsperaConfirmacion() {
  const router = useRouter();
  const [intentos, setIntentos] = useState(0);

  useEffect(() => {
    if (intentos >= INTENTOS) return;
    const t = setTimeout(() => {
      setIntentos((n) => n + 1);
      router.refresh();
    }, CADA_MS);
    return () => clearTimeout(t);
  }, [intentos, router]);

  // No pinta nada: la pantalla ya cuenta lo que está pasando. Lo único que
  // aporta al lector de pantalla es que esto es una zona que cambia sola, y eso
  // lo dice el `aria-live` del texto que ya existe arriba.
  return null;
}
