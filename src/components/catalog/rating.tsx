import { StarIcon } from "lucide-react";

/** Rating compacto del tutor. Sin reseñas aún (EP-09, S3) → texto neutro. */
export function RatingStars({
  avg,
  count,
}: {
  avg: number | null;
  count: number;
}) {
  if (!avg || count === 0) {
    return <span className="text-xs text-muted-foreground">Sin reseñas</span>;
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <StarIcon className="size-3.5 fill-current text-amber-500" />
      <span className="font-medium text-foreground">{avg.toFixed(1)}</span>
      <span>({count})</span>
    </span>
  );
}
