import Link from "next/link";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, BOOKING_STATUS_LABEL } from "@/lib/booking";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Mi panel · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

// El chat vive mientras la reserva está viva o recién completada (EP-17); la
// ventana real (2 días antes) la gobierna `send_message`.
const CHAT_BOOKING = new Set<BookingStatus>(["confirmed", "in_progress", "completed"]);

/**
 * SCR-AL02 — Dashboard del alumno. Destino de `pickHome` tras entrar (Doc 3):
 * próximas clases (con acceso a sala; la ventana la gobierna RN-18) y reservas
 * recientes. El widget de referidos (FL-04) llega con US-1301 (S4).
 */
export default async function AppHome() {
  const { user } = await requireUser();
  const supabase = await createClient();

  const [{ data: profile }, { data: nextSessions }, { data: bookings }] = await Promise.all([
    // El nombre sale del PERFIL, no de `user_metadata`: el metadata es un
    // espejo que se queda viejo si el perfil cambia después.
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("sessions")
      .select("id, start_at, status, bookings(products(title))")
      .eq("student_id", user.id)
      .in("status", ["scheduled", "in_progress"])
      // Por el FIN, no por el inicio: una clase empezada sigue entrable hasta
      // 10 min después de acabar (RN-18) y debe seguir a la vista.
      .gte("end_at", new Date().toISOString())
      .order("start_at")
      .limit(4),
    supabase
      .from("bookings")
      .select("id, status, total_amount, currency, products(title), reviews(rating)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(4),
  ]);

  const firstName = profile?.full_name?.split(" ")[0];
  const hasActivity = (bookings ?? []).length > 0;

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title={firstName ? `Hola, ${firstName}` : "Tu panel"}
          description={
            hasActivity
              ? "Tus próximas clases y el estado de tus reservas."
              : "Aquí verás tus próximas clases. Por ahora, empieza explorando."
          }
          actions={
            hasActivity ? (
              <Button asChild variant="outline">
                <Link href="/tutors">Explorar tutores</Link>
              </Button>
            ) : undefined
          }
        />

        {!hasActivity ? (
          <Card>
            <CardHeader>
              <CardTitle>Aún no tienes clases reservadas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
              <p>Descubre tutores y reserva tu primera clase 1:1 en vivo.</p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/tutors">Explorar tutores</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/classes">Ver clases</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Próximas clases</h2>
              {(nextSessions ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No tienes clases agendadas.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(nextSessions ?? []).map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {s.bookings?.products?.title ?? "Clase"}
                        </p>
                        <p className="text-xs text-muted-foreground first-letter:uppercase">
                          {formatSessionTime(s.start_at)}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/room/${s.id}`}>Ir a la sala</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Reservas recientes</h2>
                <Link href="/reservas" className="text-sm underline underline-offset-4">
                  Ver todas
                </Link>
              </div>
              <ul className="flex flex-col gap-2">
                {(bookings ?? []).map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {b.products?.title ?? "Clase"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatMoney(b.total_amount, b.currency)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* El chat cuelga de la reserva (EP-17), no de la sesión. */}
                      {CHAT_BOOKING.has(b.status) ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/chat/${b.id}`}>Chat</Link>
                        </Button>
                      ) : null}
                      {/* RN-17/28: reseñar solo si está completada y sin reseña. */}
                      {b.status === "completed" && !b.reviews ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href="/reservas">Dejar reseña</Link>
                        </Button>
                      ) : null}
                      <Badge variant="outline">{BOOKING_STATUS_LABEL[b.status]}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Section>
    </Container>
  );
}
