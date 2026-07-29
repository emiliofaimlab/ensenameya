import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { BOOKING_STATUS_LABEL, isUpcoming, tutorNames } from "@/lib/booking";
import { BookingRow } from "@/components/booking-row";
import { ReferralCard } from "@/components/referral/referral-card";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
  StatusPill,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Mi panel · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Reservas vivas que el alumno ve arriba (el Figma las mezcla en una lista). */
const OPEN: BookingStatus[] = ["pending_acceptance", "confirmed", "in_progress"];

/** Solo con la reserva aceptada hay sala. `pending_acceptance` NO la tiene. */
const ROOM_READY = new Set<BookingStatus>(["confirmed", "in_progress"]);

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
 * SCR-AL02 — Dashboard del alumno. Destino de `pickHome` tras entrar (Doc 3).
 *
 * La lista se arma desde `bookings`, no desde `sessions`: mirando solo sesiones
 * una reserva sin aceptar salía como "clase próxima" **con botón de sala**, y
 * encima repetida en la sección de pendientes. Ahora cada fila es una reserva.
 */
export default async function AppHome() {
  const { user } = await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const [{ data: profile }, { data: openRows }, { data: pastRows }] =
    await Promise.all([
      // El nombre sale del PERFIL, no de `user_metadata`: el metadata es un
      // espejo que se queda viejo si el perfil cambia después.
      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      supabase
        .from("bookings")
        .select(
          "id, status, created_at, products(title, tutor_id), sessions(id, start_at, end_at, status)",
        )
        .eq("student_id", user.id)
        .in("status", OPEN)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("bookings")
        .select(
          "id, status, products(title, tutor_id), sessions(id, start_at, status), reviews(rating)",
        )
        .eq("student_id", user.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

  const open = openRows ?? [];
  const completed = pastRows ?? [];
  const names = await tutorNames(
    supabase,
    [...open, ...completed].map((b) => b.products?.tutor_id),
  );

  /** Sesión relevante de la reserva: la primera que aún no ha terminado. */
  const nextSession = (b: (typeof open)[number]) =>
    [...(b.sessions ?? [])]
      .filter((s) => s.status === "scheduled" || s.status === "in_progress")
      .sort((x, y) => x.start_at.localeCompare(y.start_at))
      .find((s) => isUpcoming(s.end_at)) ?? null;

  const upcomingCount = open.filter((b) => ROOM_READY.has(b.status)).length;
  const awaitingCount = open.length - upcomingCount;
  const hasActivity = open.length + completed.length > 0;

  return (
    <PanelShell>
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          {profile?.full_name?.split(" ")[0]
            ? `Hola, ${profile.full_name.split(" ")[0]}`
            : "Tu panel"}
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          {summary(upcomingCount, awaitingCount)}
        </p>
      </div>

      {!hasActivity ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            Aún no tienes clases reservadas
          </PanelCardTitle>
          <p className="mt-2 text-[13px] text-[#6b6b6b]">
            Descubre tutores y reserva tu primera clase 1 a 1 en vivo.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild className="h-10">
              <Link href="/tutors">Explorar tutores</Link>
            </Button>
            <Button asChild variant="outline" className="h-10">
              <Link href="/classes">Ver mentorías</Link>
            </Button>
          </div>
        </PanelCard>
      ) : (
        <>
          <PanelCard>
            <PanelCardTitle className="text-[22px]">
              Próximas sesiones
            </PanelCardTitle>
            {open.length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                No tienes clases agendadas.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-[#e0e0e0]">
                {open.map((b) => {
                  const s = nextSession(b);
                  const ready = ROOM_READY.has(b.status);
                  return (
                    <BookingRow
                      key={b.id}
                      href={`/reservas/${b.id}`}
                      tutor={names.get(b.products?.tutor_id ?? "")}
                      title={b.products?.title ?? "Clase"}
                      when={s?.start_at ?? null}
                      timeZone={tz}
                      status={BOOKING_STATUS_LABEL[b.status]}
                      note={
                        ready
                          ? "Disponible 10 min antes"
                          : "Reembolso 100 % si no acepta en 24 h"
                      }
                      action={
                        ready && s ? (
                          <Button
                            asChild
                            className="h-[38px] rounded-[8px] px-4 text-[13px] font-semibold"
                          >
                            <Link href={`/room/${s.id}`}>Entrar a sala</Link>
                          </Button>
                        ) : (
                          <Button
                            asChild
                            variant="outline"
                            className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
                          >
                            <Link href={`/reservas/${b.id}`}>Ver detalle</Link>
                          </Button>
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
          </PanelCard>

          {completed.length > 0 ? (
            <PanelCard>
              <PanelCardTitle className="text-[22px]">
                Sesiones pasadas
              </PanelCardTitle>
              <ul className="mt-4 divide-y divide-[#e0e0e0]">
                {completed.map((b) => {
                  const last = [...(b.sessions ?? [])].sort((x, y) =>
                    y.start_at.localeCompare(x.start_at),
                  )[0];
                  return (
                    <BookingRow
                      key={b.id}
                      href={`/reservas/${b.id}`}
                      tutor={names.get(b.products?.tutor_id ?? "")}
                      title={b.products?.title ?? "Clase"}
                      when={last?.start_at ?? null}
                      timeZone={tz}
                      status={BOOKING_STATUS_LABEL[b.status]}
                      // "Ver grabación · 30 días" del Figma es US-1602 (S4).
                      action={
                        b.reviews ? (
                          <StatusPill>Reseñada</StatusPill>
                        ) : (
                          <Button
                            asChild
                            variant="outline"
                            className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
                          >
                            <Link href={`/reservas/${b.id}/resena`}>
                              Dejar reseña
                            </Link>
                          </Button>
                        )
                      }
                    />
                  );
                })}
              </ul>
            </PanelCard>
          ) : null}
        </>
      )}

      {/* Las dos tarjetas del Figma. "Invita y gana" (US-1301) solo aparece con
          campaña configurada: el programa vive entero en Referral Factory. */}
      <ReferralCard />

      <PanelCard>
        <span className="grid size-10 place-items-center rounded-full bg-brand-muted text-brand">
          <CompassIcon className="size-5" />
        </span>
        <PanelCardTitle className="mt-4 text-xl">
          ¿Buscas algo nuevo?
        </PanelCardTitle>
        <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
          Explora tutores y resultados por lo que quieres lograr.
        </p>
        <Button asChild className="mt-4 h-10">
          <Link href="/tutors">Explorar tutores</Link>
        </Button>
      </PanelCard>
    </PanelShell>
  );
}
