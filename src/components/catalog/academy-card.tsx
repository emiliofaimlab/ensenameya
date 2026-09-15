import Image from "next/image";
import Link from "next/link";
import { BuildingIcon, UsersIcon } from "lucide-react";

import { PrecioEnLinea } from "@/components/precio/precio";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { AcademyCardData } from "@/lib/catalog/queries";

/**
 * Tarjeta de academia del listado `/academias`.
 *
 * El color de marca de la academia se usa como ACENTO —la cinta superior, el
 * aro del logo y las iniciales— y nunca como fondo de un texto: `brand_color`
 * lo teclea un humano y un amarillo sobre blanco dejaría la tarjeta ilegible.
 * Calcular luminancia para elegir el color del texto sería la otra salida, y
 * con acentos no hace falta escribir ese código.
 */
export function AcademyCard({ academy }: { academy: AcademyCardData }) {
  const logo = storageUrl("avatars", academy.logoPath);
  // `--marca` alimenta la cinta y el aro; sin color propio cae al azul de
  // Enséñame Ya, que es el mismo que usa el resto del catálogo.
  const marca = academy.brandColor ?? "var(--color-brand)";

  return (
    <article
      className="relative flex h-full flex-col overflow-hidden rounded-[16px] border border-[#ebebeb] bg-card shadow-[0_8px_22px_rgb(0_0_0/0.06)] transition-shadow focus-within:ring-2 focus-within:ring-brand/40 hover:shadow-card-hover"
      style={{ "--marca": marca } as React.CSSProperties}
    >
      <div aria-hidden className="h-1.5 bg-(--marca)" />

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3.5">
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] border-2 border-(--marca) bg-white text-[17px] font-bold text-(--marca)">
            {logo ? (
              <Image
                src={logo}
                alt=""
                width={56}
                height={56}
                className="size-14 object-cover"
                unoptimized
              />
            ) : (
              initialsFrom(academy.name)
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] leading-tight font-bold break-words text-[#212121]">
              {academy.name}
            </h3>
            <p className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-(--marca)">
              <BuildingIcon className="size-3" />
              Academia aliada
            </p>
          </div>
        </div>

        {academy.tagline ? (
          <p className="line-clamp-2 text-[13.5px] text-[#525252]">
            {academy.tagline}
          </p>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-medium text-[#4d4d4d]">
          <span className="inline-flex items-center gap-1">
            <UsersIcon className="size-3.5" />
            {academy.tutorCount === 1
              ? "1 tutor"
              : `${academy.tutorCount} tutores`}
          </span>
          <span aria-hidden>·</span>
          <span>
            {academy.productCount === 1
              ? "1 mentoría"
              : `${academy.productCount} mentorías`}
          </span>
          {/* Sin reseñas no se pinta un 0: cinco estrellas vacías dicen «mala»
              donde lo que hay es «todavía nadie ha valorado». */}
          {academy.ratingAvg !== null && academy.ratingCount > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>
                ★ {academy.ratingAvg.toFixed(1)} ({academy.ratingCount})
              </span>
            </>
          ) : null}
        </p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          {academy.priceFromMinor !== null && academy.priceCurrency ? (
            <span className="text-sm font-bold text-[#212121]">
              Desde{" "}
              <PrecioEnLinea
                amountMinor={academy.priceFromMinor}
                currency={academy.priceCurrency}
              />
            </span>
          ) : (
            <span />
          )}
          {/* Estira su zona de clic a toda la tarjeta (mismo patrón que
              `tutor-card.tsx`). El `aria-label` es obligatorio: el enlace pasa
              a nombrar la tarjeta entera y «Ver academia» repetido en una
              rejilla no dice cuál. */}
          <Link
            href={`/academias/${academy.slug}`}
            aria-label={`Ver la academia ${academy.name}`}
            className="text-xs font-semibold text-brand before:absolute before:inset-0 hover:underline"
          >
            Ver academia
          </Link>
        </div>
      </div>
    </article>
  );
}
