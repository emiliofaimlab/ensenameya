import { requireTutorProfile } from "@/lib/auth/tutor";
import { listTutorReviews } from "@/lib/catalog/queries";
import { createClient } from "@/lib/supabase/server";
import { PanelCard } from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";

export const metadata = { title: "Mis reseñas · Enséñame Ya" };

/**
 * EY-230 · las reseñas del tutor, DENTRO de su panel. Es a donde lleva el
 * aviso `review_received_tutor`. Son los mismos componentes y la misma consulta
 * que la ficha pública (`/tutores/[id]`): lo que el tutor lee aquí es
 * exactamente lo que ven los alumnos. La nota y el recuento salen de
 * `tutor_profiles`, igual que allí, porque la lista se corta en 50.
 */
export default async function TutorResenasPage() {
  const { userId } = await requireTutorProfile();
  const supabase = await createClient();

  const [reviews, { data: perfil }] = await Promise.all([
    listTutorReviews(userId),
    supabase
      .from("tutor_profiles")
      .select("rating_avg, rating_count")
      .eq("profile_id", userId)
      .maybeSingle(),
  ]);

  const total = perfil?.rating_count ?? 0;

  return (
    <TutorShell
      userId={userId}
      title="Mis reseñas"
      description="Lo que dicen de ti los alumnos que terminaron una mentoría. Es lo mismo que ven en tu ficha pública."
    >
      <PanelCard>
        {reviews.length === 0 ? (
          <p className="text-[13px] text-[#6b6b6b]">
            Todavía no tienes reseñas. Aparecen aquí cuando un alumno valora una
            mentoría terminada.
          </p>
        ) : (
          <>
            <ReviewsSummary
              reviews={reviews}
              avg={perfil?.rating_avg ?? undefined}
              count={total > 0 ? total : undefined}
            />
            <hr className="my-5 border-[#ebebeb]" />
            <TutorReviews withContext reviews={reviews} />
          </>
        )}
      </PanelCard>
    </TutorShell>
  );
}
