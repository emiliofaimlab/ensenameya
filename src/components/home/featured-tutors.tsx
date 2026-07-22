import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { RatingStars } from "@/components/catalog/rating";
import { formatMoney, initialsFrom } from "@/lib/catalog/format";
import type { FeaturedTutor } from "@/lib/catalog/queries";

export function FeaturedTutors({ tutors }: { tutors: FeaturedTutor[] }) {
  if (tutors.length === 0) return null;

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Tutores destacados
            </h2>
            <Link
              href="/tutors"
              className="text-sm font-medium text-brand hover:underline"
            >
              Ver todos →
            </Link>
          </div>

          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {tutors.map((t) => (
              <li
                key={t.id}
                className="flex flex-col items-center gap-2 rounded-[20px] bg-card p-6 text-center"
              >
                {/* Sin foto: profiles no es público y no hay columna de avatar. */}
                <span className="grid size-14 place-items-center rounded-full bg-muted font-semibold">
                  {initialsFrom(t.headline)}
                </span>
                <p className="text-[15px] font-semibold">
                  {t.headline ?? "Tutor"}
                </p>
                <p className="line-clamp-2 text-[13px] text-muted-foreground">
                  {t.bio ?? "Sin biografía todavía."}
                </p>
                <RatingStars avg={t.ratingAvg} count={t.ratingCount} />
                {t.priceFromMinor !== null && t.currency ? (
                  <p className="text-sm font-semibold">
                    Desde {formatMoney(t.priceFromMinor, t.currency)}
                  </p>
                ) : null}
                <Button
                  asChild
                  variant="outline"
                  className="mt-2 h-10 rounded-[10px] border-brand text-brand hover:bg-brand-muted hover:text-brand"
                >
                  <Link href={`/tutors/${t.id}`}>Ver perfil</Link>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
