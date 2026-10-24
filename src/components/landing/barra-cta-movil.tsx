"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { LANDING_CIERRE_ID, LANDING_HERO_CTA_ID } from "./ids";

/**
 * Barra de CTA fija abajo, SOLO en móvil (`sm:hidden`), para `/ensena` y
 * `/aprende`. El botón llega ya resuelto en servidor como `children`
 * (`RegistroYa`: modal de alta para el anónimo, destino de `getVisitorState`
 * con sesión — regla de oro 13); aquí solo se decide CUÁNDO se ve.
 *
 * Se esconde mientras el CTA del hero está en pantalla (dos botones iguales a
 * la vista es ruido) y desde que asoma el cierre azul en adelante: ahí ya hay
 * un botón igual y, más abajo, el pie, que la barra taparía.
 *
 * `conChat`: con sesión el `ChatLauncher` flota abajo a la derecha; se le deja
 * su hueco como hace la barra de `booking-panel` (`pe-[72px]`).
 */
export function BarraCtaMovil({
  children,
  conChat = false,
}: {
  children: React.ReactNode;
  conChat?: boolean;
}) {
  const [heroVisible, setHeroVisible] = useState(true);
  const [cierreAlcanzado, setCierreAlcanzado] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(LANDING_HERO_CTA_ID);
    const cierre = document.getElementById(LANDING_CIERRE_ID);
    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.target === hero) setHeroVisible(e.isIntersecting);
        // Visible o ya por encima del borde superior: el cierre está "alcanzado".
        if (e.target === cierre) {
          setCierreAlcanzado(e.isIntersecting || e.boundingClientRect.top < 0);
        }
      }
    });
    // Las dos landings pintan siempre el hero: sin él la barra se quedaría
    // oculta, que es el fallo del lado bueno (nunca tapa nada).
    if (hero) io.observe(hero);
    if (cierre) io.observe(cierre);
    return () => io.disconnect();
  }, []);

  const visible = !heroVisible && !cierreAlcanzado;

  return (
    <div
      // Oculta = fuera de la pantalla y fuera del orden de tabulación.
      inert={!visible}
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgb(0_0_0/0.08)] backdrop-blur transition-transform duration-200 ease-out motion-reduce:transition-none sm:hidden",
        conChat && "pe-[72px]",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      {children}
    </div>
  );
}

