"use client";

import { useEffect } from "react";

/**
 * Lo que al `<details>` nativo le falta para comportarse como un desplegable:
 * cerrarse al clicar fuera, con Escape y al elegir una opción. La exclusión
 * mutua sí es nativa (`<details name="…">`, acordeón exclusivo).
 *
 * Actúa SOLO sobre los que llevan `name`, que es justo el marcador de "esto es
 * un desplegable": los `<details>` sueltos (formularios plegados, FAQ) tienen
 * que quedarse abiertos aunque cliques fuera.
 */
export function DropdownDismiss() {
  useEffect(() => {
    const open = () =>
      document.querySelectorAll<HTMLDetailsElement>("details[name][open]");

    // `pointerdown` fuera: el propio `summary` se salta, o cerraríamos aquí y
    // el toggle nativo lo volvería a abrir en el `click`.
    const onDown = (e: PointerEvent) => {
      for (const d of open()) {
        if (!d.contains(e.target as Node)) d.open = false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      for (const d of open()) d.open = false;
    };
    // Elegir una opción cierra: son enlaces y la navegación es de cliente, así
    // que el nodo sobrevive y el panel se quedaría abierto encima del resultado.
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      el?.closest("details[name] a")?.closest("details")?.removeAttribute("open");
    };

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}
