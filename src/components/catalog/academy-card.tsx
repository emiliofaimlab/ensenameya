import Image from "next/image";
import Link from "next/link";
import { BuildingIcon } from "lucide-react";

import { PrecioEnLinea } from "@/components/precio/precio";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { AcademyCardData } from "@/lib/catalog/queries";

/**
 * Tarjeta de academia del listado `/academias`.
 *
 * **Es la misma tarjeta que la de tutor** (`tutor-card.tsx`, variante
 * `centered`), pedido del 15-sep: misma caja, mismo avatar de 84, mismo
 * `line-clamp-1` en el nombre, misma línea de reseñas, mismos chips y el mismo
 * pie con divisor, «Desde …» y botón outline. Lo único que cambia es lo que
 * dicen: «Academia aliada» en vez de «Tutor verificado», los chips cuentan
 * tutores y mentorías, y el destino es `/academias/<slug>`.
 *
 * No se reutiliza `TutorCard` con un `variant`: son dos tipos de datos
 * distintos (`AcademyCardData` no tiene `categories` ni `avatarPath`) y
 * encajarlos obligaría a inventar un tipo común que solo existiría para esto.
 * Duplicar 60 líneas de marcado es más barato de leer que esa abstracción.
 *
 * El color de marca se usa SOLO en las iniciales: `brand_color` lo teclea un
 * humano y un fondo de ese color con texto encima dejaría la tarjeta ilegible.
 */
export function AcademyCard({ academy }: { academy: AcademyCardData }) {
  const logo = storageUrl("avatars", academy.logoPath);
  const marca = academy.brandColor ?? "var(--color-brand)";

  const chips = [
    academy.tutorCount === 1 ? "1 tutor" : `${academy.tutorCount} tutores`,
    academy.productCount === 1
      ? "1 mentoría"
      : `${academy.productCount} mentorías`,
  ];

  return (
    <article className="relative flex h-full flex-col items-center gap-3.5 rounded-[16px] border border-[#ebebeb] bg-card p-5 text-center shadow-[0_8px_22px_rgb(0_0_0/0.06)] transition-shadow focus-within:ring-2 focus-within:ring-brand/40 hover:shadow-card-hover">
      <span
        className="grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xl font-semibold"
        style={{ color: marca }}
      >
        {logo ? (
          <Image
            src={logo}
            alt=""
            width={84}
            height={84}
            className="size-[84px] object-cover"
            unoptimized
          />
        ) : (
          initialsFrom(academy.name)
        )}
      </span>

      <div>
        {/* Una línea, como la tarjeta de tutor: un nombre de dos líneas baja
            todo el interior y desalinea la tarjeta de sus vecinas de fila. El
            `title` guarda el entero. */}
        <h3
          title={academy.name}
          className="line-clamp-1 text-base font-bold"
        >
          {academy.name}
        </h3>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-[#666666]">
          <BuildingIcon className="size-3.5" style={{ color: marca }} />
          Academia aliada
        </p>
      </div>

      {/* Mismo renglón que el tutor, con la misma raya cuando no hay nota: un
          0 pintaría «mala valoración» donde lo que hay es «aún nadie ha
          valorado». */}
      <p className="text-[13px] font-medium text-[#666666]">
        ★ {academy.ratingAvg?.toFixed(1) ?? "—"} ·{" "}
        {academy.ratingCount === 1
          ? "1 reseña"
          : `${academy.ratingCount} reseñas`}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <span
            key={c}
            className="rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]"
          >
            {c}
          </span>
        ))}
      </div>

      <div className="mt-auto w-full border-t border-[#ebebeb] pt-4">
        <div className="flex items-center justify-between gap-3">
          {academy.priceFromMinor !== null && academy.priceCurrency ? (
            <span className="text-[15px] font-bold text-[#242424]">
              Desde{" "}
              <PrecioEnLinea
                amountMinor={academy.priceFromMinor}
                currency={academy.priceCurrency}
              />
            </span>
          ) : (
            <span />
          )}
          {/* ⚠️ Enlace PELADO, no `<Button asChild>`: el
              `active:…translate-y-px` de `buttonVariants` encoge este overlay
              justo al pulsarlo y la tarjeta deja de navegar. El porqué entero,
              en `catalog/tutor-card.tsx`. */}
          <Link
            href={`/academias/${academy.slug}`}
            aria-label={`Ver la academia ${academy.name}`}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] border border-brand bg-background px-4 text-sm font-medium text-brand transition-colors before:absolute before:inset-0 hover:bg-brand-muted"
          >
            Ver academia
          </Link>
        </div>
      </div>
    </article>
  );
}
