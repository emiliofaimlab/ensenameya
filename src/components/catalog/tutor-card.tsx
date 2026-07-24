import Image from "next/image";
import Link from "next/link";
import { BadgeCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMoney, initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { FeaturedTutor } from "@/lib/catalog/queries";

/**
 * Tarjeta de resultado de P04: composición centrada, avatar de 84px, nombre
 * público (DD-01) y el pie separado por un divisor.
 *
 * ponytail: sin la insignia de tier del Figma. `tutor_tiers` es el tramo de
 * comisión (US-1103, RN-06): publicarlo filtra margen y se lee como ranking de
 * calidad. Ver `docs/BACKLOG.md` §4.2.
 */
export function TutorCard({
  tutor,
  layout = "centered",
}: {
  tutor: FeaturedTutor;
  /** P09 la pinta a 273px alineada a la izquierda y con la bio del tutor. */
  layout?: "centered" | "list";
}) {
  const avatar = storageUrl("avatars", tutor.avatarPath);
  const name = tutor.displayName ?? tutor.headline ?? "Tutor";

  if (layout === "list") {
    return (
      <article className="flex h-full flex-col gap-3 rounded-[16px] border border-[#ebebeb] bg-card p-4 shadow-[0_8px_20px_rgb(0_0_0/0.06)]">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold">
            {avatar ? (
              <Image
                src={avatar}
                alt=""
                width={44}
                height={44}
                className="size-11 object-cover"
                unoptimized
              />
            ) : (
              initialsFrom(name)
            )}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold text-[#212121]">
              {name}
            </h3>
            <p className="flex items-center gap-1 text-[11.5px] text-[#666666]">
              <BadgeCheckIcon className="size-3 text-brand" />
              Tutor verificado
            </p>
          </div>
        </div>

        {tutor.headline || tutor.bio ? (
          <p className="line-clamp-2 text-[13.5px] text-[#525252]">
            {tutor.headline ?? tutor.bio}
          </p>
        ) : null}

        <p className="text-[12.5px] font-medium text-[#4d4d4d]">
          ★ {tutor.ratingAvg?.toFixed(1) ?? "—"} ·{" "}
          {tutor.ratingCount === 1
            ? "1 reseña"
            : `${tutor.ratingCount} reseñas`}
        </p>

        {tutor.categories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tutor.categories.slice(0, 2).map((c) => (
              <span
                key={c.slug}
                className="rounded-full border border-[#d9d9d9] px-2.5 py-1 text-[11.5px] font-medium text-[#4d4d4d]"
              >
                {c.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          {tutor.priceFromMinor !== null && tutor.currency ? (
            <span className="text-sm font-bold text-[#212121]">
              Desde {formatMoney(tutor.priceFromMinor, tutor.currency)}
            </span>
          ) : (
            <span />
          )}
          <Link
            href={`/tutors/${tutor.id}`}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Ver perfil
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="flex h-full flex-col items-center gap-3.5 rounded-[16px] border border-[#ebebeb] bg-card p-5 text-center shadow-[0_8px_22px_rgb(0_0_0/0.06)]">
      <span className="grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xl font-semibold">
        {avatar ? (
          <Image
            src={avatar}
            alt=""
            width={84}
            height={84}
            className="size-[84px] object-cover"
            unoptimized
          />
        ) : (
          initialsFrom(name)
        )}
      </span>

      <div>
        <h3 className="line-clamp-2 text-base font-bold">{name}</h3>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-[#666666]">
          <BadgeCheckIcon className="size-3.5 text-brand" />
          Tutor verificado
        </p>
      </div>

      <p className="text-[13px] font-medium text-[#666666]">
        ★ {tutor.ratingAvg?.toFixed(1) ?? "—"} ·{" "}
        {tutor.ratingCount === 1 ? "1 reseña" : `${tutor.ratingCount} reseñas`}
      </p>

      {tutor.categories.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {tutor.categories.slice(0, 2).map((c) => (
            <span
              key={c.slug}
              className="rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]"
            >
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto w-full border-t border-[#ebebeb] pt-4">
        <div className="flex items-center justify-between gap-3">
          {tutor.priceFromMinor !== null && tutor.currency ? (
            <span className="text-[15px] font-bold text-[#242424]">
              Desde {formatMoney(tutor.priceFromMinor, tutor.currency)}
            </span>
          ) : (
            <span />
          )}
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-[8px] border-brand text-brand hover:bg-brand-muted hover:text-brand"
          >
            <Link href={`/tutors/${tutor.id}`}>Ver perfil</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
