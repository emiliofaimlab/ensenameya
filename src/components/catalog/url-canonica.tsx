"use client";

import { useEffect } from "react";

/**
 * Quien llega a la ficha por el uuid (los ~20 enlaces internos, los correos ya
 * enviados) ve en la barra la URL con slug, y es la que comparte. Sin redirect a
 * propósito: un `redirect()` alcanzado por navegación de cliente deja la
 * pantalla en blanco (regla de oro 13). `replaceState` lo integra el App Router.
 */
export function UrlCanonica({ path }: { path: string }) {
  useEffect(() => {
    // ⚠️ Diferido: en la primera carga el efecto del hijo corre ANTES que el del
    // App Router que parchea `replaceState`, y el cambio se le escaparía a Next.
    const t = setTimeout(() =>
      window.history.replaceState(
        null,
        "",
        path + window.location.search + window.location.hash,
      ),
    );
    return () => clearTimeout(t);
  }, [path]);
  return null;
}
