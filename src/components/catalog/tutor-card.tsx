import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { initialsFrom } from "@/lib/catalog/format";
import type { TutorCardData } from "@/lib/catalog/queries";
import { RatingStars } from "./rating";

export function TutorCard({ tutor }: { tutor: TutorCardData }) {
  return (
    <Link href={`/tutors/${tutor.id}`} className="group">
      <Card className="h-full transition-colors group-hover:border-ring">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {initialsFrom(tutor.headline)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{tutor.headline ?? "Tutor"}</p>
            <RatingStars avg={tutor.ratingAvg} count={tutor.ratingCount} />
          </div>
        </CardHeader>
        <CardContent className="line-clamp-3 text-sm text-muted-foreground">
          {tutor.bio ?? "Sin biografía todavía."}
        </CardContent>
      </Card>
    </Link>
  );
}
