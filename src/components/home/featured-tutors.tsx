import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { RatingStars } from "@/components/catalog/rating";
import { formatMoney, initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { FeaturedTutor } from "@/lib/catalog/queries";

export function FeaturedTutors({ tutors }: { tutors: FeaturedTutor[] }) {
  if (tutors.length === 0) return null;

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold">Tutores destacados</h2>
            <Link
              href="/tutors"
              className="text-sm font-medium text-brand hover:underline"
            >
              Ver todos →
            </Link>
          </div>

          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {tutors.map((t) => {
              const avatar = storageUrl("avatars", t.avatarPath);
              const name = t.displayName ?? t.headline ?? "Tutor";
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-2 rounded-[20px] bg-card p-5 shadow-card"
                >
                  {/* Cabecera del Figma: foto a la izquierda, nombre + titular al lado. */}
                  <div className="flex items-start gap-3">
                    <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold">
                      {avatar ? (
                        <Image
                          src={avatar}
                          alt=""
                          width={56}
                          height={56}
                          className="size-14 object-cover"
                          unoptimized
                        />
                      ) : (
                        initialsFrom(name)
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{name}</p>
                      <p className="line-clamp-2 text-[13px] text-muted-foreground">
                        {t.headline ?? t.bio ?? "Sin biografía todavía."}
                      </p>
                    </div>
                  </div>

                  <RatingStars avg={t.ratingAvg} count={t.ratingCount} />
                  {t.priceFromMinor !== null && t.currency ? (
                    <p className="text-sm font-semibold">
                      Desde {formatMoney(t.priceFromMinor, t.currency)}
                    </p>
                  ) : null}
                  <Button
                    asChild
                    variant="outline"
                    className="mt-auto h-10 w-fit rounded-[10px] border-brand text-brand hover:bg-brand-muted hover:text-brand"
                  >
                    <Link href={`/tutors/${t.id}`}>Ver perfil</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
