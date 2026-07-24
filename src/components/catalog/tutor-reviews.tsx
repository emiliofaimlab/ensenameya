import { StarIcon } from "lucide-react";

import type { TutorReview } from "@/lib/catalog/queries";

/** Estrellas llenas/vacías para una puntuación 1–5. */
function Stars({
  rating,
  className = "size-4",
}: {
  rating: number;
  className?: string;
}) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={
            n <= rating
              ? `${className} fill-current text-amber-500`
              : `${className} text-muted-foreground/30`
          }
        />
      ))}
    </span>
  );
}

/** "Hace 2 semanas" — el Figma fecha las reseñas en relativo. */
function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Hoy";
  if (days < 7) return `Hace ${days} ${days === 1 ? "día" : "días"}`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return `Hace ${w} ${w === 1 ? "semana" : "semanas"}`;
  }
  const m = Math.round(days / 30);
  if (m < 12) return `Hace ${m} ${m === 1 ? "mes" : "meses"}`;
  const y = Math.round(m / 12);
  return `Hace ${y} ${y === 1 ? "año" : "años"}`;
}

/**
 * Resumen de reseñas de P07: nota grande, estrellas y el histograma por
 * estrellas. Se calcula con las reseñas que se muestran, no con `rating_count`
 * — si no, un rating sembrado dibuja barras sobre una lista vacía.
 */
export function ReviewsSummary({ reviews }: { reviews: TutorReview[] }) {
  if (reviews.length === 0) return null;

  const avg = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
  const buckets = [5, 4, 3, 2, 1].map((n) => ({
    n,
    count: reviews.filter((r) => r.rating === n).length,
  }));

  return (
    <div className="flex flex-wrap items-start gap-12">
      <div>
        <p className="text-[44px] leading-none font-bold text-[#1f1f1f]">
          {avg.toFixed(1)}
        </p>
        <div className="mt-2">
          <Stars rating={Math.round(avg)} />
        </div>
        <p className="mt-1 text-[13px] text-[#666666]">
          {reviews.length} {reviews.length === 1 ? "reseña" : "reseñas"}
        </p>
      </div>

      <ul className="min-w-[198px] flex-1 space-y-1.5">
        {buckets.map(({ n, count }) => (
          <li key={n} className="flex items-center gap-2.5">
            <span className="w-2 text-xs text-[#666666]">{n}</span>
            <span
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e6e6e6]"
              role="img"
              aria-label={`${count} de ${reviews.length} con ${n} estrellas`}
            >
              <span
                className="block h-full rounded-full bg-[#4d4d4d]"
                style={{ width: `${(count / reviews.length) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** US-902 — lista de reseñas en el perfil del tutor. Anónimas (ver query). */
export function TutorReviews({ reviews }: { reviews: TutorReview[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este tutor aún no tiene reseñas.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[#ebebeb]">
      {reviews.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 py-5 first:pt-0">
          <div className="flex items-center gap-2.5">
            {/* Sin nombre de autor: las reseñas son anónimas por diseño de la
                consulta (US-902). El Figma firma con nombre — sería DD-01 sobre
                el ALUMNO, otra decisión de privacidad. */}
            <span className="size-9 shrink-0 rounded-full bg-muted" />
            <div>
              <p className="text-sm font-bold text-[#242424]">Alumno</p>
              <p className="flex items-center gap-1.5 text-xs text-[#666666]">
                {/* UTC → hora local del que mira (RN-02). */}
                <time dateTime={r.createdAt}>{relativeDate(r.createdAt)}</time>·
                <Stars rating={r.rating} className="size-3" />
              </p>
            </div>
          </div>
          {r.comment ? (
            <p className="text-sm text-pretty text-[#525252]">{r.comment}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin comentario.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
