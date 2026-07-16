import { StarIcon } from "lucide-react";

import type { TutorReview } from "@/lib/catalog/queries";

/** Estrellas llenas/vacías para una puntuación 1–5. */
function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={
            n <= rating
              ? "size-4 fill-current text-amber-500"
              : "size-4 text-muted-foreground/30"
          }
        />
      ))}
    </span>
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
    <ul className="flex flex-col gap-4">
      {reviews.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <Stars rating={r.rating} />
            {/* UTC → hora local del que mira (RN-02). */}
            <time className="text-xs text-muted-foreground" dateTime={r.createdAt}>
              {new Date(r.createdAt).toLocaleDateString("es")}
            </time>
          </div>
          {r.comment ? (
            <p className="text-sm text-pretty">{r.comment}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin comentario.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
