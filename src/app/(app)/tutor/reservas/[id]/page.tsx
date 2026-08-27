import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { bookingFormatLabel, formatSessionTime, BOOKING_STATUS_LABEL, SESSION_STATUS_LABEL } from "@/lib/booking";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelCard,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { RecordingLink } from "@/components/room/recording-link";
import { SessionRef } from "@/components/room/session-ref";
import { Button } from "@/components/ui/button";
import { CompleteSessionButton } from "../booking-actions";
import { studentName, studentOfTutor } from "../../students";
import { StudentAvatar } from "../../student-avatar";
import type { Database } from "@/lib/database.types";
import { classInProgress, roomOpen } from "@/lib/room-window";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

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
 * Reservas cuya sala puede abrirse. `completed` entra porque el cron cierra la
 * reserva a los 10 min de acabar la clase, y con B-2 la sala vive exactamente
 * hasta ese mismo instante: sin `completed` en la lista, el botón parpadearía
 * en el último minuto según qué pasada del cron llegara antes. Misma lista,
 * palabra por palabra, que la guarda de `join_session` y que la del detalle del
 * alumno: tres definiciones distintas de "hay sala" acabarían discrepando.
 */
const LIVE = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);

const CHAT_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);
const CANCELLABLE = new Set<BookingStatus>(["pending_acceptance", "confirmed"]);

export const metadata = { title: "Detalle de la sesión · Enséñame Ya" };

/**
 * SCR-TU08 — detalle de una reserva/sesión del tutor: datos, acciones
 * (sala, marcar completada, cancelar) y el chat con el alumno en la columna
 * derecha (202:87). RLS filtra por `tutor_id`: la reserva de otro da 404.
 *
 * La tarjeta "Grabación" del Figma (202:72) es US-1802 y ya existe: cada sesión
 * completada lleva su "Ver grabación" (`RecordingLink`).
 *
 * N-13/N-14: el nombre del alumno ya se pinta. No sale del `select` —`profiles`
 * sigue siendo own-only por RLS— sino de la RPC `tutor_students`
 * (`20260817150000`), que devuelve identidad mínima al tutor que comparte
 * reserva. Si la reserva está cancelada la RPC no da acceso y la tarjeta cae a
 * "Alumno": es a propósito, no un fallo de carga.
 */
export default async function TutorBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      // N-27 · `session_ref` es el "N.º de sesión" que el cliente pidió para
      // seguir transacciones. Se LEE de la fila (lo pone un trigger); no se
      // deriva aquí, que es como US-1802 se rompió en silencio con el nombre
      // de la sala de Daily.
      // MN-05 · la ventana de acceso viaja con la sesión (`20260820190000`): es
      // lo que decide si el botón de sala sirve, y no se recalcula aquí.
      "id, status, tutor_id, student_id, total_amount, currency, num_sessions, session_duration_min, products(title), sessions(id, start_at, end_at, status, session_ref, access_opens_at, access_closes_at)",
    )
    .eq("id", id)
    .eq("tutor_id", user.id)
    .maybeSingle();

  if (!booking) notFound();

  // N-13: identidad del alumno. Va después del `booking` a propósito —hace
  // falta su `student_id`— y no se mezcla con el `select`: `profiles` es
  // own-only por RLS y el join no devolvería nada.
  const student = await studentOfTutor(supabase, booking.student_id);

  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const chatOpen = CHAT_BOOKING.has(booking.status);

  const { data: msgs } = chatOpen
    ? await supabase
        .from("messages")
        .select(
          "id, sender_id, body, created_at, attachment_path, attachment_name, attachment_size",
        )
        .eq("booking_id", id)
        .order("created_at")
    : { data: null };

  const initial: ChatMessage[] = (msgs ?? []).map((m) => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at,
    attachment: m.attachment_path
      ? {
          path: m.attachment_path,
          name: m.attachment_name ?? "documento",
          size: m.attachment_size ?? 0,
        }
      : null,
  }));

  return (
    <PanelShell
      items={TUTOR_ITEMS}
      back={{ href: "/tutor/reservas", label: "Volver a reservas" }}
      eyebrow="Reservas / Detalle"
      title="Detalle de la sesión"
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_364px]">
        <div className="flex flex-col gap-5">
          <PanelCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              {/* N-12 · `min-w-0` para que el título pueda encoger y `break-words`
                  para que parta: en un detalle truncar el nombre de la mentoría
                  sería esconder justo el dato que se vino a mirar. */}
              <p className="min-w-0 flex-1 text-base font-bold break-words text-[#19191f]">
                {booking.products?.title ?? "Mentoría"}
              </p>
              <StatusPill
                tone={BOOKING_PILL[booking.status] ?? "neutral"}
              >
                {BOOKING_STATUS_LABEL[booking.status]}
              </StatusPill>
            </div>

            <hr className="my-4 border-[#e0e0e0]" />

            <div className="flex flex-wrap gap-10">
              <div>
                <p className="text-xs text-[#6b6b6b]">Formato</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  {bookingFormatLabel(booking.num_sessions)}
                </p>
              </div>
              {booking.session_duration_min ? (
                <div>
                  <p className="text-xs text-[#6b6b6b]">Duración</p>
                  <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                    {booking.session_duration_min} min
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs text-[#6b6b6b]">Total</p>
                <p className="mt-0.5 text-[13px] font-medium text-[#404040]">
                  {formatMoney(booking.total_amount, booking.currency)}
                </p>
              </div>
            </div>

            {sessions.length > 0 ? (
              <>
                <hr className="my-4 border-[#e0e0e0]" />
                <ul className="flex flex-col gap-3">
                  {sessions.map((s, i) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[#404040]">
                          Sesión {i + 1} ·{" "}
                          <span className="first-letter:uppercase">
                            {formatSessionTime(s.start_at, tz)}
                          </span>
                        </p>
                        {/* N-27 · el número que hay que dar por teléfono o por
                            correo. "Sesión 2" no distingue nada: todas las
                            reservas tienen una. */}
                        <SessionRef nro={s.session_ref} className="mt-0.5" />
                      </div>
                      <div className="flex items-center gap-2.5">
                        <StatusPill>
                          {SESSION_STATUS_LABEL[s.status] ?? s.status}
                        </StatusPill>
                        {LIVE.has(booking.status) && roomOpen(s) ? (
                          <Button
                            asChild
                            className="h-[43px] rounded-[8px] px-5 text-sm font-semibold"
                          >
                            <Link href={`/room/${s.id}`}>Entrar a la sala</Link>
                          </Button>
                        ) : null}
                        {/* ⚠️ B-2 · «MARCAR COMPLETADA» SALE DEL GATE DE ACCESO,
                            y no es cosmético.

                            Estaba anidado dentro de `roomOpen(s)`, o sea atado
                            a la ventana de la SALA — un número que el cliente
                            ha movido dos veces en una semana (10 min → 7 días
                            → 10 min). Con los 7 días de MN-05 este botón salía
                            una semana antes de la clase; al volver a 10 min se
                            encogía de golpe. Y lo que fija es
                            `bookings.completed_at`, el reloj del pago al tutor:
                            no puede depender de una decisión de UI.

                            Ahora lo gobierna la ventana de la CLASE
                            (`classInProgress`, el `session_live_window` del
                            lado del cliente), que sale de `start_at`/`end_at` y
                            sobrevive al próximo cambio de la sala.

                            🔴 Y el gate NO es decorativo: `complete_session`
                            **no tiene guarda temporal** — acepta cualquier
                            sesión propia en `scheduled`/`in_progress`, incluida
                            la del mes que viene. Hasta que esa guarda exista en
                            el servidor, esta condición es lo único que impide
                            adelantar el reloj del cobro. No la quites. */}
                        {LIVE.has(booking.status) &&
                        classInProgress(s) &&
                        (s.status === "scheduled" ||
                          s.status === "in_progress") ? (
                          <CompleteSessionButton sessionId={s.id} />
                        ) : null}
                        {/* US-1802 · disponible 30 días desde la clase. Con el
                            N.º de sesión pegado (N-27): una grabación se
                            reclama por correo, y el uuid de la URL no sirve. */}
                        {s.status === "completed" ? (
                          <RecordingLink
                            sessionId={s.id}
                            nroSesion={s.session_ref}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {/* N-34 · cancelar es una pantalla, no un `window.confirm()`: hay
                importe, política y motivo que enseñar antes de tirar la clase.
                El alumno ya la tenía (SCR-AL07); esta es la del tutor. */}
            {CANCELLABLE.has(booking.status) ? (
              <>
                <hr className="my-4 border-[#e0e0e0]" />
                <Button
                  asChild
                  variant="outline"
                  className="h-[43px] rounded-[8px] px-4 text-sm text-[#4d4d4d]"
                >
                  <Link href={`/tutor/reservas/${booking.id}/cancelar`}>
                    Cancelar reserva
                  </Link>
                </Button>
              </>
            ) : null}
          </PanelCard>

          {/* N-13/N-14 — con quién es la clase, y por dónde se llega a su
              ficha. La zona horaria va aquí porque es lo que evita el "te
              agendé a las 10" que para el alumno son las 3 de la mañana
              (RN-01/02). */}
          <PanelCard className="flex flex-wrap items-center gap-4">
            <StudentAvatar student={student} size={52} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[#6b6b6b]">Alumno</p>
              <p className="truncate text-[15px] font-semibold text-[#19191f]">
                {studentName(student)}
              </p>
              {student?.timezone ? (
                <p className="text-[12.5px] text-[#6b6b6b]">
                  Zona horaria: {student.timezone}
                </p>
              ) : null}
            </div>
            {student ? (
              <Button
                asChild
                variant="outline"
                className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
              >
                <Link href={`/tutor/alumnos/${student.id}`}>Ver perfil</Link>
              </Button>
            ) : null}
          </PanelCard>
        </div>

        <PanelCard className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#19191f]">
              {/* Con nombre cuando lo hay: "Chat con Alumno" sonaría a error. */}
              {student?.fullName
                ? `Chat con ${student.fullName}`
                : "Chat con el alumno"}
            </h2>
            {/* M-06 · aquí ponía "RN-41" pelado. Ese es un código de NUESTRA
                documentación interna: al tutor no le dice nada y parece un
                error de la aplicación. Lo que necesita saber es la regla. */}
            <span className="text-[11px] text-[#6b6b6b]">
              Se abre 2 días antes de la clase
            </span>
          </div>
          {chatOpen ? (
            <ChatThread
              bookingId={booking.id}
              currentUserId={user.id}
              firstSessionAt={sessions[0]?.start_at ?? null}
              initialMessages={initial}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-[13px] text-[#6b6b6b]">
              El chat se habilita cuando la reserva esté confirmada.
            </p>
          )}
        </PanelCard>
      </div>
    </PanelShell>
  );
}
