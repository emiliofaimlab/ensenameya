
import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { TutorShell } from "@/components/layout/tutor-shell";
import { BookingList, type BookingRow } from "@/components/booking-list";

export const metadata = { title: "Reservas recibidas · Enséñame Ya" };

/** US-606 (SCR-TU07b) — el tutor acepta/rechaza sus reservas `pending_acceptance`. */
export default async function TutorReservasPage() {
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, status, total_amount, currency, products(title), sessions(id, start_at, status)")
    .eq("tutor_id", userId)
    .order("created_at", { ascending: false });

  const bookings: BookingRow[] = (data ?? [])
    .map((b) => ({
      id: b.id,
      status: b.status,
      total_amount: b.total_amount,
      currency: b.currency,
      product_title: b.products?.title ?? "Producto",
      sessions: b.sessions ?? [],
    }))
    // Las que esperan tu respuesta, primero.
    .sort((a, z) =>
      Number(z.status === "pending_acceptance") - Number(a.status === "pending_acceptance"),
    );

  return (
    <TutorShell
          title="Reservas recibidas"
          description="Acepta o rechaza las reservas de tus alumnos (tienes 24 h)."
    >
        <BookingList bookings={bookings} mode="tutor" />
    </TutorShell>
  );
}
