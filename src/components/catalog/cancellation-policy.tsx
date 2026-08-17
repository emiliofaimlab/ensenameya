import { cn } from "@/lib/utils";
import { CANCELLATION_POLICY as P } from "@/lib/policy";

const rules = [
  `Cancelas con ${P.cutoffHours} h o más de antelación: reembolso del ${P.refundPct.studentEarly} %.`,
  `Cancelas con menos de ${P.cutoffHours} h: reembolso del ${P.refundPct.studentLate} %.`,
  `Si el tutor cancela: reembolso del ${P.refundPct.tutorCancels} %.`,
];

/**
 * US-403 (RN-37/RN-11) — política de cancelación única de la plataforma. Se
 * muestra en el perfil del tutor y el detalle del producto (y en el checkout,
 * EP-06). `compact` = una línea junto al CTA; por defecto = tarjeta con reglas.
 */
export function CancellationPolicy({
  compact = false,
  className,
}: {
  compact?: boolean;
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

  return (
    <section className={cn("rounded-lg border p-4", className)}>
      <h2 className="text-sm font-semibold">Política de cancelación</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        Única de Enséñame Ya, igual para todos los tutores.
      </p>
      <ul className="text-muted-foreground mt-3 flex flex-col gap-1.5 text-sm">
        {rules.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
