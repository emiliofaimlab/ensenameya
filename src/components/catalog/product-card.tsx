import Image from "next/image";
import Link from "next/link";
import { ArrowUpRightIcon, StarIcon } from "lucide-react";

import { ProductCover } from "@/components/catalog/product-cover";
import {
  initialsFrom,
  perSessionLabel,
  priceDisplay,
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
  // RV-08 · manda el total de la reserva, no la tarifa (ver `priceDisplay`).
  const precio = priceDisplay(product);
  /**
   * RV-09 · el paquete sale más barato por sesión y la tarjeta no lo decía.
   *
   * La nota del precio en un paquete es "paquete · 6 sesiones": repite lo que ya
   * dice la línea de arriba ("6 × 60 min") y calla lo único que sirve para
   * comparar con una clase suelta — cuánto cuesta CADA sesión. `perSessionLabel`
   * lo dice y trae también el recuento, así que SUSTITUYE a la nota en lugar de
   * apilarse encima. Es el mismo criterio que ya sigue el panel de reserva de
   * P08, y aquí importa más: el catálogo es donde se comparan mentorías.
   *
   * Devuelve `null` fuera de `per_package` y en paquetes de una sola sesión, así
   * que el resto de tarjetas no cambian.
   *
   * ⚠️ LO QUE **NO** SE PINTA, y no por olvido: ni "ahorras un 20 %" ni un precio
   * tachado. Un producto `per_package` no conoce hoy el precio de la sesión
   * suelta del mismo tutor —no hay columna de referencia—, así que cualquier
   * ahorro saldría de compararlo con otro producto por casualidad o de un
   * importe tecleado sin control. Eso ya no sería una promoción, sería
   * publicidad engañosa, y los Términos publicados describen el flujo real de
   * compra. Con dato de verdad detrás se puede añadir; sin él, no.
   */
  const porSesion = perSessionLabel(product);
  const tutorAvatar = storageUrl("avatars", product.tutor?.avatarPath ?? null);
  const tutorName =
    product.tutor?.displayName ?? product.tutor?.headline ?? "Tutor";

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[16px] border border-[#ebebeb] bg-card shadow-[0_8px_22px_rgb(0_0_0/0.06)]">
      {/* Miniatura 276×140 (DD-02). MN-09 · sin imagen se pinta el icono de
          categoría, no una banda gris: la caja ocupa lo mismo en los dos casos
          (por eso el alto va en `className`, que `ProductCover` aplica a las dos
          ramas) y la rejilla no se desalinea. */}
      <ProductCover
        product={product}
        width={276}
        height={compact ? 120 : 140}
        className={compact ? "h-[120px]" : "h-[140px]"}
      />

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
            {/* N-12 · `min-w-0` en el PROPIO enlace: es un ítem flex, y sin él
                `min-width:auto` le impide encoger, así que el `truncate` no
                recortaba nada y un nombre largo empujaba a la estrella fuera
                de la tarjeta. El subrayado del hover sigue el recorte. */}
            <Link
              href={`/tutors/${product.tutor.id}`}
              className="min-w-0 truncate text-[13px] font-medium text-[#474747] hover:underline"
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
          <div className="flex items-end justify-between gap-3">
            {/* Precio destacado (24-jul): el monto grande arriba y la unidad
                pequeña debajo, para que sea el ancla visual de la tarjeta.
                RV-08: el monto grande es lo que se COBRA por reservar; la
                tarifa por hora, cuando la hay, es la línea de abajo. */}
            <div className="min-w-0">
              <p
                className={`font-bold text-[#19191f] ${compact ? "text-base" : "text-[19px]"} leading-tight`}
              >
                {precio.amount}
              </p>
              {/* RV-09 · la equivalencia por sesión puede no caber en una línea
                  a 276px, así que en ese caso se deja envolver en vez de
                  recortarse: un "Equivale a 16,00 US…" cortado no informa de
                  nada. La nota corriente sigue con `truncate`. */}
              <p
                className={`text-[#666666] ${compact ? "text-[11px]" : "text-xs"} ${
                  porSesion ? "text-pretty" : "truncate"
                }`}
              >
                {porSesion ?? precio.note}
              </p>
            </div>
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
