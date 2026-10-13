"use client";

import { useCallback, useSyncExternalStore, type RefObject } from "react";

/**
 * EY-221 · Pantalla completa del CONTENEDOR de la sala (vídeo + presentación +
 * contador + chat), con la Fullscreen API. No es el botón de Daily —ese pone
 * a pantalla completa solo su iframe, y se llevaba por delante todo lo nuestro;
 * por eso sigue apagado (`showFullscreenButton: false`).
 *
 * ⚠️ En pantalla completa SOLO se ve el subárbol del contenedor. Lo que se
 * pinte por portal en el `body` —los toasts de sonner, los diálogos de Radix—
 * queda detrás. Por eso todo lo de EY-221 (panel de materiales, indicador de
 * mano, contador) se pinta DENTRO del contenedor y no con portales.
 */
function suscribir(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

const sinCambios = () => () => {};

export function usePantallaCompleta(ref: RefObject<HTMLElement | null>) {
  const activa = useSyncExternalStore(
    suscribir,
    // En esta página lo único que se pone a pantalla completa es el contenedor.
    () => document.fullscreenElement !== null,
    () => false,
  );
  const soportada = useSyncExternalStore(
    sinCambios,
    () => document.fullscreenEnabled,
    () => false,
  );

  const alternar = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ref.current?.requestFullscreen();
    } catch (e) {
      console.warn("[sala] pantalla completa:", e);
    }
  }, [ref]);

  return { activa, soportada, alternar };
}
