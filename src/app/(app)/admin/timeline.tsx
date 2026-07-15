/**
 * "Logs básicos por entidad" (AC de US-1104) sin tabla de auditoría: la traza
 * se deriva de los timestamps que las propias entidades ya guardan
 * (`created_at`, `paid_at`, `cancelled_at`…) más los eventos de webhook.
 *
 * ponytail: una auditoría de verdad (quién hizo qué, con actor y diff) es otra
 * historia y otra tabla. Esto responde "¿qué le pasó a esto y cuándo?", que es
 * lo que pide el AC y lo que se pregunta en soporte.
 */
export type TimelineEntry = {
  at: string; // ISO UTC
  label: string;
  detail?: string;
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Sin eventos registrados.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3 rounded-lg border p-4">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />
            {i < entries.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
          </div>
          <div className="min-w-0 pb-1">
            <p className="text-sm font-medium">{e.label}</p>
            {e.detail ? (
              <p className="break-all text-sm text-muted-foreground">{e.detail}</p>
            ) : null}
            {/* UTC en BD → hora local del que mira (RN-02). */}
            <time className="text-xs text-muted-foreground" dateTime={e.at}>
              {new Date(e.at).toLocaleString("es")}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
