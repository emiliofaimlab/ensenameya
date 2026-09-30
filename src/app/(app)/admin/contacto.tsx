"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";

/**
 * Correo o teléfono del panel: se pulsa (abre `mailto:`/`tel:`) y se copia.
 * El teléfono lleva además WhatsApp (`wa.me` quiere solo dígitos, sin el `+`).
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
  const digitos = valor.replace(/\D/g, "");
  const href = tipo === "correo" ? `mailto:${valor}` : `tel:+${digitos}`;

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
      {tipo === "telefono" ? (
        <a
          href={`https://wa.me/${digitos}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Abrir en WhatsApp"
          title="WhatsApp"
          className="shrink-0 rounded p-1 text-[#6b6b6b] hover:bg-[#f2f2f2] hover:text-green-600"
        >
          <MessageCircleIcon className="size-3.5" />
        </a>
      ) : null}
    </span>
  );
}
