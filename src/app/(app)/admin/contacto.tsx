"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

/**
 * Correo o teléfono del panel: se pulsa (abre `mailto:`/`tel:`) y se copia.
 * Lo comparten las fichas de tutor y alumno y la revisión del tutor.
 */
export function Contacto({
  tipo,
  valor,
}: {
  tipo: "correo" | "telefono";
  valor: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const href =
    tipo === "correo" ? `mailto:${valor}` : `tel:${valor.replace(/[^\d+]/g, "")}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin permiso de portapapeles (http, iframe): queda el texto seleccionable.
    }
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <a
        href={href}
        title={valor}
        className="truncate text-[13px] font-medium text-brand select-all hover:underline"
      >
        {valor}
      </a>
      <button
        type="button"
        onClick={copiar}
        aria-label={copiado ? "Copiado" : `Copiar ${tipo === "correo" ? "correo" : "teléfono"}`}
        title={copiado ? "Copiado" : "Copiar"}
        className="shrink-0 rounded p-1 text-[#6b6b6b] hover:bg-[#f2f2f2] hover:text-[#19191f]"
      >
        {copiado ? <CheckIcon className="size-3.5 text-green-600" /> : <CopyIcon className="size-3.5" />}
      </button>
    </span>
  );
}
