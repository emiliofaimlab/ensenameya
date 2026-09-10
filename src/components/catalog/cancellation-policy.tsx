import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { CANCELLATION_POLICY as P } from "@/lib/policy";

const rules = [
  `Cancelas con ${P.cutoffHours} h o más de antelación: reembolso del ${P.refundPct.studentEarly} %.`,
  `Cancelas con menos de ${P.cutoffHours} h: reembolso del ${P.refundPct.studentLate} %.`,
  `Si el tutor cancela: reembolso del ${P.refundPct.tutorCancels} %.`,
];

const subtitulo = "Única de Enséñame Ya, igual para todos los tutores.";

/** Las tres reglas, idénticas en la tarjeta y en el plegado: una sola verdad. */
function Reglas({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        "text-muted-foreground flex flex-col gap-1.5 text-sm",
        className,
      )}
    >
      {rules.map((r) => (
        <li key={r} className="flex gap-2">
          <span aria-hidden>•</span>
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * US-403 (RN-37/RN-11) — política de cancelación única de la plataforma. Se
 * muestra en el perfil del tutor y el detalle del producto (y en el checkout,
 * EP-06). `compact` = una línea junto al CTA; por defecto = tarjeta con reglas.
 *
 * §5.13 · `variant="folded"` la mete DENTRO del panel de reserva (G-05). El
 * panel compacto tiene que caber entero en 800 px de alto y la tarjeta de tres
 * reglas se comía ella sola el hueco del CTA; plegada ocupa una línea y sigue
 * estando donde hace falta —al lado del botón que cobra—, que es el sitio donde
 * la ley pide que se lea antes de pagar, no tres pantallas más abajo.
 *
 * Es un `<details>` nativo: se abre y se cierra sin una línea de JavaScript, así
 * que esto sigue siendo un Server Component y el buscador ve el texto aunque
 * esté cerrado. Mismo patrón que las FAQ de `products/[id]/page.tsx`.
 */
export function CancellationPolicy({
  compact = false,
  variant = "card",
  className,
}: {
  compact?: boolean;
  variant?: "card" | "folded";
  className?: string;
}) {
  if (compact) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>
        Política de cancelación única de la plataforma: ≥{P.cutoffHours} h{" "}
        {P.refundPct.studentEarly} %, &lt;{P.cutoffHours} h {P.refundPct.studentLate} %,
        cancela el tutor {P.refundPct.tutorCancels} %.
      </p>
    );
  }

  if (variant === "folded") {
    return (
      <details className={cn("group rounded-[10px] border", className)}>
        {/* `list-none` + `marker:hidden`: el triángulo por defecto de `summary`
            aparece en unos navegadores y no en otros, y aquí el indicador es el
            chevron, que además gira al abrirse. */}
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] font-semibold marker:hidden">
          Política de cancelación
          <ChevronDownIcon className="text-brand size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <p className="text-muted-foreground px-3.5 text-xs">{subtitulo}</p>
        <Reglas className="mt-2.5 px-3.5 pb-3 text-[13px]" />
      </details>
    );
  }

  return (
    <section className={cn("rounded-lg border p-4", className)}>
      <h2 className="text-sm font-semibold">Política de cancelación</h2>
      <p className="text-muted-foreground mt-1 text-xs">{subtitulo}</p>
      <Reglas className="mt-3" />
    </section>
  );
}
