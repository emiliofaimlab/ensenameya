import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * EY-177 · B3.2 — el indicador de los tres pasos: selección → revisión → pago.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ ESTO CONTRADICE UNA DECISIÓN FIRMADA, Y SE PONE A SABIENDAS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El checkout vive en su propio grupo de rutas con el layout DESNUDO —sin
 * cabecera, sin navegación, sin pie, sin chat— por petición literal del cliente
 * recogida en `src/app/(checkout)/layout.tsx:8-12`: «el checkout tiene que estar
 * lo más aislado posible […] tiene que ser "confirmar pago". No debe tener más
 * nada esa página». El argumento técnico que la acompaña es el de cualquier
 * pasarela: cada salida visible de una pantalla de pago es una compra que no
 * termina.
 *
 * Un indicador de pasos es, por definición, contexto de fuera de la pantalla. El
 * responsable aceptó la marcha atrás para que los tres pasos se vean como tres
 * pasos. Se paga lo mínimo:
 *
 *  · **No lleva enlaces.** Los pasos anteriores se pintan como hechos, no como
 *    destinos. La única salida del checkout sigue siendo «Cambiar horario», que
 *    ya existía y que además suelta el hold (D-2) — un enlace «volver al
 *    carrito» aquí dejaría el horario retenido y al alumno mirando un
 *    calendario sin su propio hueco.
 *  · **Va en la PÁGINA, no en el layout.** El layout `(checkout)` lo comparten
 *    dos pantallas, y la otra es `/reservas/[id]/pagar`: retomar el pago de una
 *    reserva vieja desde «Mis reservas» no es el paso 3 de ningún carrito, y
 *    ponerlo allí sería una mentira. Así el aislamiento del armazón se queda
 *    intacto y la marcha atrás se limita a la pantalla donde el cliente la pidió.
 */

const PASOS = ["Selección", "Revisión", "Pago"] as const;

export function CheckoutSteps({
  current,
  className,
}: {
  /** 1, 2 o 3. Los anteriores salen marcados como hechos. */
  current: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <ol
      // `aria-label` y no un encabezado: es orientación, no contenido. Y sin
      // `aria-current="step"` en los ya hechos — solo el actual lo lleva.
      aria-label="Pasos de la compra"
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}
    >
      {PASOS.map((label, i) => {
        const n = i + 1;
        const hecho = n < current;
        const activo = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={activo ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-[13px]",
                activo
                  ? "font-semibold text-[#19191f]"
                  : hecho
                    ? "text-[#4b4b4b]"
                    : "text-[#a3a3a3]",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                  activo
                    ? "bg-brand text-white"
                    : hecho
                      ? "bg-brand/15 text-brand"
                      : "bg-[#ededed] text-[#a3a3a3]",
                )}
              >
                {hecho ? <CheckIcon className="size-3" /> : n}
              </span>
              {label}
            </span>
            {n < PASOS.length ? (
              <span aria-hidden className="h-px w-5 bg-[#e0e0e0] sm:w-8" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
