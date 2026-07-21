import Link from "next/link";
import { StarIcon, VideoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatMoney, modelLabel, sessionsLabel } from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";

/** Tarjeta de producto de P05 (y del listado por categoría). */
export function ProductCard({ product }: { product: ProductCardData }) {
  const sessions = sessionsLabel(product);

  return (
    <article className="flex h-full flex-col gap-3 rounded-[20px] border bg-card p-5">
      <h3 className="font-bold">{product.title}</h3>

      {product.tutor ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
          <Link
            href={`/tutors/${product.tutor.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {product.tutor.headline ?? "Tutor"}
          </Link>
          {product.tutor.ratingAvg !== null ? (
            <span className="inline-flex items-center gap-0.5">
              <StarIcon className="size-3.5 fill-primary text-primary" />
              {product.tutor.ratingAvg}
            </span>
          ) : null}
        </p>
      ) : null}

      {sessions ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <VideoIcon className="size-3.5" />
          {sessions} · En vivo 1 a 1
        </p>
      ) : null}

      {product.outcome ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {product.outcome}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-primary-muted px-3 py-1 text-xs font-semibold text-primary-muted-foreground">
          {modelLabel(product)}
        </span>
        {product.categories.slice(0, 2).map((c) => (
          <Badge key={c.slug} variant="secondary">
            {c.name}
          </Badge>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        <span className="text-lg font-bold">
          {formatMoney(product.priceAmount, product.currency)}
        </span>
        <Link
          href={`/products/${product.id}`}
          className="text-[13px] font-semibold text-brand hover:underline"
        >
          Ver detalle →
        </Link>
      </div>
    </article>
  );
}
