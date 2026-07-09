import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { BookingList, type BookingRow } from "@/components/booking-list";

export const metadata = { title: "Reservas recibidas · Enséñame Ya" };

/** US-606 (SCR-TU07b) — el tutor acepta/rechaza sus reservas `pending_acceptance`. */
export default async function TutorReservasPage() {
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, status, total_amount, currency, products(title), sessions(start_at, status)")
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
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Reservas recibidas"
          description="Acepta o rechaza las reservas de tus alumnos (tienes 24 h)."
          actions={
            <Button asChild variant="outline">
              <Link href="/tutor/products">Mis productos</Link>
            </Button>
          }
        />
        <BookingList bookings={bookings} mode="tutor" />
      </Section>
    </Container>
  );
}
