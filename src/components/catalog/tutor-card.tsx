import Link from "next/link";
import { BadgeCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney, initialsFrom } from "@/lib/catalog/format";
import type { FeaturedTutor } from "@/lib/catalog/queries";
import { RatingStars } from "./rating";

/** Tarjeta de resultado de P04. El nombre y la foto no son públicos: manda el headline. */
export function TutorCard({ tutor }: { tutor: FeaturedTutor }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-[20px] border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-muted font-semibold">
          {initialsFrom(tutor.headline)}
        </span>
        <div className="min-w-0">
          {/* line-clamp y no truncate: aquí el título es el headline, más
              largo que el nombre corto que dibuja el Figma. */}
          <h3 className="line-clamp-2 font-bold">
            {tutor.headline ?? "Tutor"}
          </h3>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <BadgeCheckIcon className="size-3.5 text-brand" />
            Tutor verificado
          </p>
        </div>
      </div>

      <RatingStars avg={tutor.ratingAvg} count={tutor.ratingCount} />

      {tutor.categories.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tutor.categories.slice(0, 2).map((c) => (
            <Badge key={c.slug} variant="secondary">
              {c.name}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="line-clamp-2 text-sm text-muted-foreground">
        {tutor.bio ?? "Sin biografía todavía."}
      </p>

      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        {tutor.priceFromMinor !== null && tutor.currency ? (
          <span className="font-bold">
            Desde {formatMoney(tutor.priceFromMinor, tutor.currency)}
          </span>
        ) : (
          <span />
        )}
        <Button
          asChild
          variant="outline"
          className="h-10 rounded-[10px] border-brand text-brand hover:bg-brand-muted hover:text-brand"
        >
          <Link href={`/tutors/${tutor.id}`}>Ver perfil</Link>
        </Button>
      </div>
    </article>
  );
}
