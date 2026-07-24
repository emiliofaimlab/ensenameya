import Image from "next/image";
import Link from "next/link";
import { ArrowUpRightIcon, StarIcon } from "lucide-react";

import {
  formatMoney,
  initialsFrom,
  priceUnitLabel,
  sessionsLabel,
  storageUrl,
} from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";

/**
 * Tarjeta de producto de P05 y P06. El botón circular cambia de color según la
 * pantalla: naranja en el catálogo general, azul en la página de categoría.
 */
export function ProductCard({
  product,
  accent = "primary",
  action = "circle",
  compact = false,
}: {
  product: ProductCardData;
  accent?: "primary" | "brand";
  /** `ver` = botón outline "Ver" (P07); `circle` = botón circular (P05/P06). */
  action?: "circle" | "ver";
  /** P09 la usa a 273px: miniatura y tipografías más pequeñas, tutor en una línea. */
  compact?: boolean;
}) {
  const sessions = sessionsLabel(product);
  const thumb = storageUrl("product-images", product.imagePath);
  const tutorAvatar = storageUrl("avatars", product.tutor?.avatarPath ?? null);
  const tutorName =
    product.tutor?.displayName ?? product.tutor?.headline ?? "Tutor";

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[16px] border border-[#ebebeb] bg-card shadow-[0_8px_22px_rgb(0_0_0/0.06)]">
      {/* Miniatura 276×140 (DD-02). Sin imagen se pinta la banda igual para que
          las tarjetas de la rejilla no queden desalineadas. */}
      {thumb ? (
        <Image
          src={thumb}
          alt=""
          width={276}
          height={compact ? 120 : 140}
          className={`w-full object-cover ${compact ? "h-[120px]" : "h-[140px]"}`}
          unoptimized
        />
      ) : (
        <div
          className={`w-full bg-muted ${compact ? "h-[120px]" : "h-[140px]"}`}
        />
      )}

      <div
        className={`flex flex-1 flex-col ${compact ? "gap-2 p-3.5" : "gap-3 p-[18px]"}`}
      >
        <h3
          className={`line-clamp-2 font-bold text-[#242424] ${compact ? "text-sm" : "text-base"}`}
        >
          {product.title}
        </h3>

        {product.tutor && compact ? (
          <p className="truncate text-xs text-[#666666]">
            {tutorName}
            {product.tutor.ratingAvg !== null
              ? ` · ★ ${product.tutor.ratingAvg.toFixed(1)}`
              : ""}
          </p>
        ) : product.tutor ? (
          <div className="flex items-center gap-2">
            {/* Sin foto, iniciales — como el resto del sitio. */}
            <span className="grid size-[26px] shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold">
              {tutorAvatar ? (
                <Image
                  src={tutorAvatar}
                  alt=""
                  width={26}
                  height={26}
                  className="size-[26px] object-cover"
                  unoptimized
                />
              ) : (
                initialsFrom(tutorName)
              )}
            </span>
            <Link
              href={`/tutors/${product.tutor.id}`}
              className="truncate text-[13px] font-medium text-[#474747] hover:underline"
            >
              {tutorName}
            </Link>
            {product.tutor.ratingAvg !== null ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] text-[#666666]">
                ·
                <StarIcon className="size-3.5 fill-primary text-primary" />
                {product.tutor.ratingAvg.toFixed(1)}
              </span>
            ) : null}
          </div>
        ) : null}

        {sessions ? (
          <p
            className={
              compact ? "text-xs text-[#666666]" : "text-[13px] text-[#666666]"
            }
          >
            {sessions} · En vivo 1 a 1
          </p>
        ) : null}

        {product.categories.length > 0 && !compact ? (
          <div className="flex flex-wrap gap-2">
            {product.categories.slice(0, 2).map((c) => (
              <span
                key={c.slug}
                className="rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]"
              >
                {c.name}
              </span>
            ))}
          </div>
        ) : null}

        <div
          className={`mt-auto border-t border-[#ebebeb] ${compact ? "pt-2.5" : "pt-3"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span
              className={`font-bold text-[#242424] ${compact ? "text-[13.5px]" : "text-[15px]"}`}
            >
              {formatMoney(product.priceAmount, product.currency)} ·{" "}
              {priceUnitLabel(product)}
            </span>
            {action === "ver" ? (
              <Link
                href={`/products/${product.id}`}
                className="shrink-0 rounded-[8px] border-[1.5px] border-brand px-4 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-muted"
              >
                Ver
              </Link>
            ) : (
              <Link
                href={`/products/${product.id}`}
                aria-label={`Ver detalle de ${product.title}`}
                className={`grid size-10 shrink-0 place-items-center rounded-full text-white transition-colors ${
                  accent === "brand"
                    ? "bg-brand hover:bg-brand-foreground"
                    : "bg-primary hover:bg-primary/85"
                }`}
              >
                <ArrowUpRightIcon className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
