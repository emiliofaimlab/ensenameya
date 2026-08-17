import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/catalog/format";
import {
  formatSessionTime,
  isUpcoming,
  BOOKING_STATUS_LABEL,
} from "@/lib/booking";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { Button } from "@/components/ui/button";
import { studentName, studentOfTutor } from "../../students";
import { StudentAvatar } from "../../student-avatar";

/**
 * Título FIJO, sin el nombre del alumno. `generateMetadata` podría meterlo,
 * pero el título acaba en el historial del navegador y en la pestaña
 * compartida en pantalla: el nombre no tiene por qué salir de la página.
 */
export const metadata = { title: "Perfil del alumno · Enséñame Ya" };

const BOOKING_PILL: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  pending_acceptance: "blue",
  completed: "neutral",
  cancelled: "red",
  refunded: "red",
  pending_payment: "neutral",
};

/**
 * La hora que es AHORA para el alumno. `timezone` es texto libre en `profiles`
 * (el select del onboarding manda, pero el CHECK no existe), así que una zona
 * inválida reventaría el render entero con un RangeError: se traga y se
 * devuelve null.
 */
function horaLocalDelAlumno(timeZone: string | null): string | null {
  if (!timeZone) return null;
  try {
    return new Date().toLocaleTimeString("es", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
  } catch {
    return null;
  }
}

/**
 * N-14 — ficha del alumno para su tutor: "no existe perfil del alumno que el
 * tutor pueda mirar para saber a quién le va a explicar".
 *
 * ⚠️ Es la ÚNICA superficie donde un tutor ve datos personales de un alumno, y
 * lo que enseña está acotado en la RPC `tutor_students` (`20260817150000`), no
 * aquí: nombre, foto y zona horaria. Teléfono, objetivo principal e intereses
 * NO se leen —los intereses son privados por decisión de producto— y esta
 * página no puede saltárselo aunque quisiera: la RPC no los devuelve.
 *
 * El resto de la ficha (reservas compartidas, sesiones dictadas) sale de
 * `bookings`/`sessions`, que el tutor YA podía leer por RLS: es su propia
 * actividad, no un dato del alumno.
 */
export default async function AlumnoDelTutorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await requireTutorProfile();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  // 404 si no hay reserva que dé acceso (reserva cancelada, alumno de otro
  // tutor, uuid inventado): la RPC decide, no la URL.
  const student = await studentOfTutor(supabase, id);
  if (!student) notFound();

  const { data } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, created_at, products(title), sessions(id, start_at, status)",
    )
    .eq("tutor_id", userId)
    .eq("student_id", id)
    .order("created_at", { ascending: false });

  const bookings = data ?? [];
  const sessions = bookings.flatMap((b) => b.sessions ?? []);
  const dictadas = sessions.filter((s) => s.status === "completed").length;
  const proxima =
    sessions
      .filter((s) => s.status === "scheduled" && isUpcoming(s.start_at))
      .map((s) => s.start_at)
      .sort()[0] ?? null;

  const nombre = studentName(student);
  const horaAlumno = horaLocalDelAlumno(student.timezone);

  return (
    <TutorShell
      back={{ href: "/tutor/reservas", label: "Volver a reservas" }}
      eyebrow="Reservas / Alumno"
      title={nombre}
      description="Lo que necesitas saber para preparar la clase."
    >
      <PanelCard className="flex flex-wrap items-center gap-5">
        <StudentAvatar student={student} size={72} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-[#19191f]">{nombre}</p>
          {student.timezone ? (
            <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
              {student.timezone}
              {horaAlumno ? ` · allí son ahora las ${horaAlumno}` : ""}
            </p>
          ) : null}
        </div>
      </PanelCard>

      <div className="grid gap-4 sm:grid-cols-3">
        <Cifra label="Reservas contigo" value={String(bookings.length)} />
        <Cifra label="Sesiones dictadas" value={String(dictadas)} />
        <Cifra
          label="Próxima sesión"
          value={proxima ? formatSessionTime(proxima, tz) : "—"}
          /* Tu hora local, no la suya: la agenda del tutor manda (RN-01/02). */
          hint={proxima ? "tu hora local" : undefined}
          // Una fecha no es una cifra: a 24 px se corta en cualquier pantalla.
          valueClassName={proxima ? "text-[15px] font-semibold" : undefined}
        />
      </div>

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Reservas compartidas
        </h2>
        {bookings.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#6b6b6b]">
            Todavía no hay reservas con este alumno.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {bookings.map((b) => {
              const primera = [...(b.sessions ?? [])]
                .map((s) => s.start_at)
                .sort()[0];
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                      {b.products?.title ?? "Mentoría"}
                    </p>
                    <p className="text-xs text-[#6b6b6b] first-letter:uppercase">
                      {primera ? formatSessionTime(primera, tz) : "Por agendar"}
                      {" · "}
                      {formatMoney(b.total_amount, b.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill
                      tone={BOOKING_PILL[b.status] ?? "neutral"}
                      className="h-7"
                    >
                      {BOOKING_STATUS_LABEL[b.status]}
                    </StatusPill>
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/tutor/reservas/${b.id}`}>Ver</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PanelCard>

      {/* Que quede dicho en pantalla y no solo en el código: el tutor no ve más
          porque no debe, no porque falte por cargar. */}
      <p className="text-[12.5px] text-[#6b6b6b]">
        Solo se muestran los datos necesarios para dar la clase. El teléfono, el
        correo y los intereses del alumno no se comparten con los tutores. Para
        hablar con él, usa el chat de la reserva.
      </p>
    </TutorShell>
  );
}

/** Misma tarjeta de cifra del panel (195:50), en versión con pie opcional. */
function Cifra({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums first-letter:uppercase",
          valueClassName,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11.5px] text-[#6b6b6b]">{hint}</p> : null}
    </PanelCard>
  );
}
