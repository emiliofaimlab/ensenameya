"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Convierte la pantalla en blanco en una recarga.
 *
 * ## Qué fallo tapa
 *
 * Cuando una navegación de CLIENTE cruza de grupo de rutas y se encuentra un
 * `redirect()` de SERVIDOR, el router de Next 16 se queda con el árbol vacío:
 * el `<body>` se queda sin nada y el cliente pide el RSC de esa URL en bucle.
 * Medido contra un build de producción el 11-sep-2026: 0 caracteres en
 * pantalla y hasta 1367 peticiones en 5 segundos. La MISMA URL cargada de cero
 * renderiza perfectamente — y eso es justo lo que hace esto.
 *
 * ## Por qué existe además de los arreglos
 *
 * La causa se arregla en origen —resolviendo el destino antes de navegar— y
 * `npm run check:enlaces` impide que vuelva a colarse un enlace a pelo. Pero
 * la comprobación estática solo ve literales: un `href` calculado, una guarda
 * nueva o una ruta que empiece a redirigir mañana se le escapan. Esta red no
 * arregla nada, hace algo más modesto y más difícil de perder: que el peor
 * desenlace posible sea **una recarga** en vez de una pantalla muerta.
 *
 * ## Por qué no entra en bucle
 *
 * - Solo mira DESPUÉS de una navegación, y una sola vez por URL y por pestaña
 *   (`sessionStorage`). Si tras recargar sigue vacía, no insiste: algo peor
 *   pasa y taparlo sería esconderlo.
 * - El umbral es «prácticamente nada»: 0 caracteres visibles Y sin `<main>`.
 *   Una página lenta de verdad enseña ya la cabecera y el pie —medido: 443
 *   caracteres—, así que no la toca.
 * - Deja rastro en consola antes de recargar, para que el fallo siga siendo
 *   diagnosticable en vez de desaparecer.
 */
export function RedAntiBlanco() {
  const pathname = usePathname();

  useEffect(() => {
    const t = setTimeout(() => {
      // `<main>` lo pinta el shell de todas las pantallas; que no exista ya es
      // señal de que el árbol se quedó vacío, no de que algo tarde.
      const hayMain = Boolean(document.querySelector("main"));
      const visible = document.body.innerText.trim().length;
      if (hayMain || visible > 0) return;

      const clave = `ey-blanco:${location.pathname}${location.search}`;
      try {
        if (sessionStorage.getItem(clave)) return;
        sessionStorage.setItem(clave, "1");
      } catch {
        // Cookies/almacenamiento bloqueados: sin memoria no se puede garantizar
        // que no se repita, así que mejor no recargar que arriesgar un bucle.
        return;
      }

      console.error(
        "[red anti-blanco] el árbol quedó vacío tras navegar; recargando entera",
        location.href,
      );
      window.location.reload();
    }, 3000);

    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}
