import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { BookingList, type BookingRow } from "@/components/booking-list";

export const metadata = { title: "Mis reservas · Enséñame Ya" };

/**
 * US-603 (SCR-AL06) — el alumno ve sus reservas: estado, sesiones agendadas y
 * total. Tras la aceptación del tutor pasa a `confirmed` con sus sesiones.
 */
export default async function ReservasPage() {
  const { user } = await requireUser();

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, products(title), sessions(id, start_at, status), reviews(rating, comment)",
    )
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });

  const bookings: BookingRow[] = (data ?? []).map((b) => ({
    id: b.id,
    status: b.status,
    total_amount: b.total_amount,
    currency: b.currency,
    product_title: b.products?.title ?? "Producto",
    sessions: b.sessions ?? [],
    // `reviews.booking_id` es UNIQUE (1:1) → Supabase lo da como objeto.
    review: b.reviews ?? null,
  }));

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Mis reservas"
          description="El estado de tus clases y sus horarios."
        />
        <BookingList bookings={bookings} mode="student" />
      </Section>
    </Container>
  );
}
