import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { tutorNames } from "@/lib/booking";
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
  await requireUser();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, products(title, tutor_id), sessions(start_at, status), reviews(rating, comment)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();
  if (booking.status !== "completed") redirect(`/reservas/${id}`);

  const names = await tutorNames(supabase, [booking.products?.tutor_id]);
  const tutor = names.get(booking.products?.tutor_id ?? "") ?? "tu tutor";
  const lastSession = [...(booking.sessions ?? [])]
    .filter((s) => s.status === "completed")
    .sort((a, b) => b.start_at.localeCompare(a.start_at))[0];

  return (
    <PanelShell back={{ href: `/reservas/${id}`, label: "Volver al detalle" }}>
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#19191f]">
          Deja tu reseña
        </h1>
        <p className="mt-1 text-sm text-[#6b6b6b]">
          Tu opinión ayuda a otros estudiantes a elegir. Califica tu experiencia
          con {tutor}.
        </p>
      </div>

      <PanelCard className="max-w-[944px]">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-[#6b6b6b]">
            {initialsFrom(tutor)}
          </span>
          <div>
            <p className="text-sm font-semibold text-[#19191f]">{tutor}</p>
            <p className="text-xs text-[#6b6b6b]">
              {booking.products?.title ?? "Clase"}
              {lastSession
                ? ` · Sesión completada ${new Date(
                    lastSession.start_at,
                  ).toLocaleDateString("es", { day: "numeric", month: "short" })}`
                : ""}
            </p>
          </div>
        </div>

        <hr className="my-5 border-[#e0e0e0]" />

        <ReviewForm bookingId={booking.id} existing={booking.reviews} />
      </PanelCard>
    </PanelShell>
  );
}
