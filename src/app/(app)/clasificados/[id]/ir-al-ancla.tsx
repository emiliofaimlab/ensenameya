"use client";

import { useEffect } from "react";

/**
 * NTF-58 enlaza a `/clasificados/<id>#postulacion-<id>`. En carga completa (el
 * correo) el navegador baja solo; en navegación de CLIENTE (la campana) el
 * `loading.tsx` se come el salto y `:target` no se aplica. Esto lo repone:
 * baja a la postulación y la marca con `data-destacada`.
 */
export function IrAlAncla() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    el.dataset.destacada = "1";
    el.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
