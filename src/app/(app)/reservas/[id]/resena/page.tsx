import { notFound, redirect } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate, tutorNames } from "@/lib/booking";
import {
  PanelCard,
  PanelShell,
} from "@/components/layout/panel-shell";
import { initialsFrom } from "@/lib/catalog/format";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Deja tu reseña · Enséñame Ya" };

/**
 * SCR-AL08 — dejar reseña, como página (antes era un diálogo). Solo tras
 * completar la reserva (RN-17); si no, de vuelta al detalle. `submit_review`
 * hace upsert, así que la misma pantalla edita una reseña existente.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const [{ data: booking }, { data: me }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, status, products(title, tutor_id), sessions(start_at, status), reviews(rating, comment, author_display)",
      )
      .eq("id", id)
      .maybeSingle(),
    // Cómo quedaría su firma. Lo enmascara la misma función que usa la RPC, así
    // que lo que ve aquí es exactamente lo que se publicaría.
    supabase.rpc("mask_person_name", { p_name: user.user_metadata?.full_name ?? null }),
  ]);

  if (!booking) notFound();
  if (booking.status !== "completed") redirect(`/reservas/${id}`);

  const names = await tutorNames(supabase, [booking.products?.tutor_id]);
  const tutor = names.get(booking.products?.tutor_id ?? "") ?? "tu tutor";
  const lastSession = [...(booking.sessions ?? [])]
    .filter((s) => s.status === "completed")
    .sort((a, b) => b.start_at.localeCompare(a.start_at))[0];

  return (
    <PanelShell
      back={{ href: `/reservas/${id}`, label: "Volver al detalle" }}
      title="Deja tu reseña"
      description={`Tu opinión ayuda a otros estudiantes a elegir. Califica tu experiencia con ${tutor}.`}
    >

      <PanelCard className="max-w-[944px]">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-[#6b6b6b]">
            {initialsFrom(tutor)}
          </span>
          <div>
            <p className="text-sm font-semibold text-[#19191f]">{tutor}</p>
            <p className="text-xs text-[#6b6b6b]">
              {booking.products?.title ?? "Mentoría"}
              {/* RN-01/02 · esto es un componente SERVER: sin `timeZone` el
                  render corre en la zona del servidor (UTC en Vercel) y la
                  clase de las 21:00 de un alumno en Caracas salía fechada al
                  día siguiente. `formatShortDate` es el mismo formateador que
                  usa el resto del panel. */}
              {lastSession
                ? ` · Sesión completada ${formatShortDate(lastSession.start_at, tz)}`
                : ""}
            </p>
          </div>
        </div>

        <hr className="my-5 border-[#e0e0e0]" />

        <ReviewForm
          bookingId={booking.id}
          existing={
            booking.reviews
              ? {
                  rating: booking.reviews.rating,
                  comment: booking.reviews.comment,
                  authorDisplay: booking.reviews.author_display,
                }
              : null
          }
          suggestedName={me ?? null}
        />
      </PanelCard>
    </PanelShell>
  );
}
