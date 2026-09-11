"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { guardarFormatoHora, type FormatoHora } from "@/lib/hora";
import { cn } from "@/lib/utils";

/**
 * El conmutador 12 h / 24 h.
 *
 * ⚠️ NO ES UN AJUSTE DE ESTA PANTALLA. Escribe la cookie `ey-h12` y refresca el
 * árbol de servidor, así que a partir del clic TODO el sitio escribe las horas
 * igual —reservas, sala, agenda, el calendario del tutor—. Se puso así a
 * propósito: un conmutador que solo valiera para la rejilla que tiene debajo
 * dejaría esta pantalla diciendo «1:30 p. m.» y la confirmación de la reserva
 * «13:30», para la misma clase y a un clic de distancia.
 *
 * 🔴 Los CORREOS se quedan en 24 h, y no es un olvido: se componen en un job,
 * sin navegador y sin cookie. Está escrito en `lib/hora.ts`.
 *
 * El estado se lleva en local además de en la cookie para que el botón responda
 * en el mismo fotograma del clic: `router.refresh()` es un viaje al servidor, y
 * sin esto el conmutador se quedaba quieto medio segundo con el dedo encima.
 */
export function FormatoHoraToggle({
  valor,
  className,
}: {
  valor: FormatoHora;
  className?: string;
}) {
  const router = useRouter();
  const [optimista, setOptimista] = useState<FormatoHora>(valor);
  const [, startTransition] = useTransition();

  function elegir(siguiente: FormatoHora) {
    if (siguiente === optimista) return;
    setOptimista(siguiente);
    guardarFormatoHora(siguiente);
    // El árbol de servidor se vuelve a pedir YA con la cookie puesta. En
    // transición para que el resto de la pantalla no parpadee mientras llega.
    startTransition(() => router.refresh());
  }

  return (
    /* `role="group"` y no `radiogroup`: son dos botones que aplican un cambio al
       pulsarse, no un campo de formulario que se envía después. `aria-pressed`
       es lo que dice cuál está puesto. */
    <div
      role="group"
      aria-label="Formato de hora"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-[#e0e0e0] bg-muted p-0.5",
        className,
      )}
    >
      {(["12", "24"] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => elegir(f)}
          aria-pressed={optimista === f}
          className={cn(
            "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            optimista === f
              ? "bg-card text-[#19191f] shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-[#6b6b6b] hover:text-[#19191f]",
          )}
        >
          {f}h
        </button>
      ))}
    </div>
  );
}
