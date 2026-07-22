import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime, BOOKING_STATUS_LABEL } from "@/lib/booking";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Mi panel · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

// El chat vive mientras la reserva está viva o recién completada (EP-17); la
// ventana real (2 días antes) la gobierna `send_message`.
const CHAT_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);

/** Resumen del saludo. Se arma con lo que hay, para no prometer plurales falsos. */
function summary(upcoming: number, awaiting: number): string {
  const parts: string[] = [];
  if (upcoming > 0) {
    parts.push(
      `${upcoming} ${upcoming === 1 ? "clase próxima" : "clases próximas"}`,
    );
  }
  if (awaiting > 0) {
    parts.push(
      `${awaiting} ${awaiting === 1 ? "esperando aceptación del tutor" : "esperando aceptación de los tutores"}`,
    );
  }
  if (parts.length === 0) return "Aquí verás tus próximas clases y tus reservas.";
  return `Tienes ${parts.join(" y ")}.`;
}

/**
 * SCR-AL02 — Dashboard del alumno. Destino de `pickHome` tras entrar (Doc 3):
 * próximas sesiones (con acceso a sala; la ventana la gobierna RN-18) y
 * sesiones pasadas. El widget de referidos (FL-04) llega con US-1301 (S4).
 */
export default async function AppHome() {
  const { user } = await requireUser();
  const supabase = await createClient();

  const [
    { data: profile },
    { data: nextSessions },
    { data: awaitingRows },
    { data: pastRows },
  ] = await Promise.all([
    // El nombre sale del PERFIL, no de `user_metadata`: el metadata es un
    // espejo que se queda viejo si el perfil cambia después.
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("sessions")
      .select("id, start_at, status, booking_id, bookings(status, products(title))")
      .eq("student_id", user.id)
      .in("status", ["scheduled", "in_progress"])
      // Por el FIN, no por el inicio: una clase empezada sigue entrable hasta
      // 10 min después de acabar (RN-18) y debe seguir a la vista.
      .gte("end_at", new Date().toISOString())
      .order("start_at")
      .limit(4),
    supabase
      .from("bookings")
      .select("id, status, created_at, products(title)")
      .eq("student_id", user.id)
      .eq("status", "pending_acceptance")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("bookings")
      .select("id, status, created_at, products(title), reviews(rating)")
      .eq("student_id", user.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const firstName = profile?.full_name?.split(" ")[0];
  const upcoming = nextSessions ?? [];
  const awaiting = awaitingRows ?? [];
  const completed = pastRows ?? [];
  const hasActivity = upcoming.length + awaiting.length + completed.length > 0;

  return (
    <div className="bg-muted">
      <Container>
        <Section className="grid gap-6 lg:grid-cols-[232px_1fr]">
          <AppSidebar />

          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-[28px] font-bold tracking-tight">
                {firstName ? `Hola, ${firstName}` : "Tu panel"}
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {summary(upcoming.length, awaiting.length)}
              </p>
            </div>

            {!hasActivity ? (
              <div className="rounded-2xl bg-card p-8">
                <h2 className="text-xl font-bold">
                  Aún no tienes clases reservadas
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Descubre tutores y reserva tu primera clase 1 a 1 en vivo.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button asChild>
                    <Link href="/tutors">Explorar tutores</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/classes">Ver mentorías</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <section className="rounded-2xl bg-card p-6">
                  <h2 className="text-[22px] font-bold tracking-tight">
                    Próximas sesiones
                  </h2>
                  {upcoming.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No tienes clases agendadas.
                    </p>
                  ) : (
                    <ul className="mt-4 divide-y">
                      {upcoming.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {s.bookings?.products?.title ?? "Clase"}
                            </p>
                            <p className="text-xs text-muted-foreground first-letter:uppercase">
                              {formatSessionTime(s.start_at)} · tu hora local
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Disponible 10 min antes
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {s.bookings?.status ? (
                              <Badge variant="outline">
                                {BOOKING_STATUS_LABEL[s.bookings.status]}
                              </Badge>
                            ) : null}
                            {/* El chat es más útil ANTES de la clase que después:
                                la próxima es donde se pregunta "¿llevo algo?". */}
                            <Button asChild size="sm" variant="ghost">
                              <Link href={`/chat/${s.booking_id}`}>Chat</Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/room/${s.id}`}>Entrar a sala</Link>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {awaiting.length > 0 ? (
                  <section className="rounded-2xl bg-card p-6">
                    <h2 className="text-[22px] font-bold tracking-tight">
                      Esperando al tutor
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reembolso del 100% si no acepta en 24 h.
                    </p>
                    <ul className="mt-4 divide-y">
                      {awaiting.map((b) => (
                        <li
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {b.products?.title ?? "Clase"}
                            </p>
                            <p className="text-xs text-muted-foreground first-letter:uppercase">
                              {formatSessionTime(b.created_at)} · tu hora local
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {BOOKING_STATUS_LABEL[b.status]}
                            </Badge>
                            <Button asChild size="sm" variant="outline">
                              <Link href="/reservas">Ver detalle</Link>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {completed.length > 0 ? (
                  <section className="rounded-2xl bg-card p-6">
                    <h2 className="text-[22px] font-bold tracking-tight">
                      Sesiones pasadas
                    </h2>
                    <ul className="mt-4 divide-y">
                      {completed.map((b) => (
                        <li
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {b.products?.title ?? "Clase"}
                            </p>
                            <p className="text-xs text-muted-foreground first-letter:uppercase">
                              {formatSessionTime(b.created_at)} · tu hora local
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {CHAT_BOOKING.has(b.status) ? (
                              <Button asChild size="sm" variant="ghost">
                                <Link href={`/chat/${b.id}`}>Chat</Link>
                              </Button>
                            ) : null}
                            {/* RN-17/28: reseñar solo si está completada y sin reseña. */}
                            {!b.reviews ? (
                              <Button asChild size="sm" variant="outline">
                                <Link href="/reservas">Dejar reseña</Link>
                              </Button>
                            ) : (
                              <Badge variant="outline">Reseñada</Badge>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )}

            {/* El Figma pone aquí dos tarjetas; "Invita y gana" es US-1301
                (referidos, S4, bloqueada por C-10) y no existe todavía. */}
            <section className="rounded-2xl bg-card p-6">
              <span className="grid size-10 place-items-center rounded-full bg-brand-muted text-brand">
                <CompassIcon className="size-5" />
              </span>
              <h2 className="mt-4 text-xl font-bold">¿Buscas algo nuevo?</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Explora tutores y resultados por lo que quieres lograr.
              </p>
              <Button asChild className="mt-4 h-10">
                <Link href="/tutors">Explorar tutores</Link>
              </Button>
            </section>
          </div>
        </Section>
      </Container>
    </div>
  );
}
