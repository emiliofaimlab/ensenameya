import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import {
  BOOKING_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  formatSessionTime,
  tutorCards,
  bookingFormatLabel,
} from "@/lib/booking";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { parseRequirements } from "@/lib/product-requirements";
import {
  PanelCard,
  PanelCardTitle,
  PanelRow,
  PanelShell,
  StatusPill,
} from "@/components/layout/panel-shell";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { TutorSummary } from "@/components/tutor-summary";
import { RecordingLink } from "@/components/room/recording-link";
import { SessionRef } from "@/components/room/session-ref";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { roomOpen } from "@/lib/room-window";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/**
 * MN-05 · Reservas cuya sala puede abrirse. `completed` entra porque el cron
 * cierra la reserva a los 10 min de acabar la clase y la sala sigue viva 7 días:
 * sin ella, el botón desaparecería justo cuando MN-05 dice que tiene que estar.
 * Misma lista, palabra por palabra, que la guarda de `join_session`.
 */
const ROOM_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);
const CHAT_BOOKING = new Set<BookingStatus>([
  "confirmed",
  "in_progress",
  "completed",
]);

const CANCELLABLE = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
]);

export const metadata = { title: "Detalle de reserva · Enséñame Ya" };

/**
 * SCR-AL03 — detalle de una reserva del alumno: sus sesiones, el pago, la
 * política y el chat con el tutor (columna derecha, como el Figma). RLS hace de
 * guardia: `bookings_select_own` filtra por `student_id`, así que la reserva de
 * otro devuelve 404, no 403.
 */
export default async function BookingDetailPage({
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
      // N-27 · `session_ref` es el "N.º de sesión" visible (`7K3M9Q-2`). Se pide
      // aquí y no se deriva: se calcula en la BD al insertar la sesión
      // (`20260817140000`) y componerlo otra vez en el cliente es la forma de
      // que un día deje de coincidir con el que el alumno tiene apuntado.
      // MN-05 · `access_opens_at`/`access_closes_at` vienen de la fila, no de
      // una fórmula repetida aquí: son la ventana de acceso a la sala (7 días
      // a cada lado desde `20260820190000`) y quien decide si el botón sirve.
      "id, status, total_amount, currency, num_sessions, session_duration_min, created_at, products(title, tutor_id, requirements), sessions(id, start_at, end_at, status, session_ref, access_opens_at, access_closes_at), payments(status, gross_amount, currency, paid_at, refunded_amount)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const done = sessions.filter((s) => s.status === "completed").length;
  const payment = booking.payments;
  const chatOpen = CHAT_BOOKING.has(booking.status);
  // Lo que el alumno tiene que traer. Se lee de la mentoría y no de una copia
  // congelada en la reserva a propósito: si el tutor añade «un ventilador» la
  // semana antes de la clase, quien ya reservó tiene que enterarse — es un
  // aviso operativo, no una condición económica de las que se congelan
  // (regla de oro 2, que habla del importe, no de esto).
  const requisitos = parseRequirements(booking.products?.requirements);

  // V-6 · aquí se pinta la ficha del tutor, no solo su nombre: esta es LA
  // pantalla de la queja («tras reservar no hay forma de llegar al tutor»).
  // `fichas` puede venir vacío si le retiraron la aprobación — `TutorSummary`
  // sabe qué hacer con eso y no enlaza a un 404.
  const fichas = await tutorCards(supabase, [booking.products?.tutor_id]);
  const ficha = fichas.get(booking.products?.tutor_id ?? "");
  const tutor = ficha?.displayName ?? undefined;

  // El hilo solo se carga si el chat aplica: para una reserva cancelada sería
  // una consulta a cambio de nada.
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
    <PanelShell back={{ href: "/app", label: "Volver al panel" }}>
      <div className="flex flex-col gap-1.5">
        {tutor ? <p className="text-[13px] text-[#6b6b6b]">con {tutor}</p> : null}
        {/* B1.4 · El título, a dos líneas como mucho.
            A 26 px y 375 px de ancho, uno de 38 caracteres ya ocupa dos líneas
            y el más largo del catálogo —«Química Orgánica e Intermedia:
            Descifra la Ciencia Detrás del Mundo Real»— ocupa cuatro. Cuatro
            líneas de titular empujan las sesiones y el pago fuera de la
            pantalla en la única vista donde el alumno viene a mirarlos.

            `line-clamp-2` y no un tope de caracteres, aunque la ficha lo pida
            así: un número fijo recorta igual a 375 px que a 2560, o sea que o
            deja texto colgando o corta cuando sobraba sitio. El clamp corta
            solo cuando de verdad no cabe.

            ⚠️ Y ESTO ROZA UNA DECISIÓN ANTERIOR, así que va dicho: N-12 dejó
            escrito en el detalle del TUTOR que «truncar el nombre de la
            mentoría sería esconder justo el dato que se vino a mirar». Sigue
            siendo verdad, y por eso el texto completo no desaparece: está en el
            `title`, en el `<title>` de la pestaña y en la miga. Lo que se
            recorta es cuánto ESPACIO ocupa, no el dato.

            El del tutor NO se toca: allí es `text-base` (16 px) dentro de una
            tarjeta y con `break-words`, así que no llega a hacer de muro. */}
        <h1
          className="line-clamp-2 text-[26px] font-bold tracking-tight text-[#19191f]"
          title={booking.products?.title ?? undefined}
        >
          {booking.products?.title ?? "Mentoría"}
        </h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusPill>{BOOKING_STATUS_LABEL[booking.status]}</StatusPill>
          <p className="text-[13px] text-[#6b6b6b]">
            {bookingFormatLabel(booking.num_sessions)}
            {booking.session_duration_min
              ? ` · ${booking.session_duration_min} min`
              : ""}
            {done > 0 ? ` · ${done} completada${done === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <PanelCard>
            <PanelCardTitle>Sesiones</PanelCardTitle>
            {sessions.length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6b6b6b]">
                Las sesiones se agendan cuando el tutor acepta la reserva.
              </p>
            ) : (
              <ul className="mt-3.5 divide-y divide-[#e0e0e0]">
                {sessions.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#19191f]">
                        Sesión {i + 1}
                      </p>
                      <p className="text-[13px] text-[#6b6b6b] first-letter:uppercase">
                        {formatSessionTime(s.start_at, tz)} · tu hora local
                      </p>
                      {/* N-27 · el número que se dicta por teléfono. NO es un
                          código interno de los que barre M-06: los `RN-xx` y
                          `US-xx` no significan nada para un alumno, este lo pidió
                          el cliente para poder seguir una clase y su cobro. El
                          "Sesión 1 · 2 · 3" de arriba se queda porque es el
                          ordinal dentro del paquete y sigue valiendo para las
                          reservas anteriores a la migración, que no tienen
                          número (`SessionRef` devuelve null y no pinta nada). */}
                      <SessionRef nro={s.session_ref} className="mt-1" />
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <StatusPill>
                        {SESSION_STATUS_LABEL[s.status] ?? s.status}
                      </StatusPill>
                      {/* El gate real de la ventana (RN-18) lo pone el server;
                          la sala muestra la cuenta regresiva. Aquí solo se
                          decide si enseñar el botón. */}
                      {ROOM_BOOKING.has(booking.status) && roomOpen(s) ? (
                        <Button
                          asChild
                          className="h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
                        >
                          <Link href={`/room/${s.id}`}>Entrar a sala</Link>
                        </Button>
                      ) : null}
                      {/* US-1802 · la grabación vive 30 días desde la clase. El
                          nº de sesión viaja con el botón: una grabación se
                          reclama por correo ("la de la 7K3M9Q-2") y el uuid de
                          la URL no sirve para eso. */}
                      {s.status === "completed" ? (
                        <RecordingLink sessionId={s.id} nroSesion={s.session_ref} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          {/* Requerimientos de sesión — lo que el alumno tiene que traer.

              Va DEBAJO de las sesiones y por encima del pago: quien abre esta
              pantalla el día antes de la clase viene a mirar la hora y el botón
              de la sala, y lo siguiente que necesita saber es si le falta algo.
              El pago ya está hecho y puede esperar un scroll más.

              Sin requisitos no se pinta la tarjeta: una sección "no necesitas
              nada" no es información, es ruido en una pantalla que ya tiene
              sesiones, pago, política y chat. */}
          {requisitos.length > 0 ? (
            <PanelCard>
              <PanelCardTitle>Qué necesitas para la sesión</PanelCardTitle>
              <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
                Lo pide tu tutor para esta mentoría. Tenlo listo antes de entrar
                a la sala.
              </p>
              <ul className="mt-3.5 flex flex-col gap-2.5">
                {requisitos.map((r, i) => (
                  <li key={`${i}-${r}`} className="flex items-start gap-2.5">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
                    <span className="text-[13.5px] text-[#404040]">{r}</span>
                  </li>
                ))}
              </ul>
            </PanelCard>
          ) : null}

          <PanelCard>
            <PanelCardTitle>Pago</PanelCardTitle>
            <dl className="mt-3.5 flex flex-col gap-3">
              <PanelRow
                label="Total"
                value={formatMoney(booking.total_amount, booking.currency)}
              />
              {payment?.paid_at ? (
                <PanelRow
                  label="Pagado el"
                  value={new Date(payment.paid_at).toLocaleDateString("es", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: tz,
                  })}
                />
              ) : null}
              {payment && payment.refunded_amount > 0 ? (
                <PanelRow
                  label="Reembolsado"
                  value={formatMoney(payment.refunded_amount, payment.currency)}
                />
              ) : null}
            </dl>
            {/* El Figma muestra "Visa ···· 4242" y "Ver recibo": la tarjeta
                usada no se guarda en `payments` (card-on-file es opcional,
                US-607) y no hay recibo que enlazar hasta que EP-20 conecte un
                PSP real. */}
          </PanelCard>

          {/* La reserva existe pero nunca se cobró: sin esto el horario se
              quedaba retenido y lo único ofrecido era cancelarla (12-ago).

              N-37 · el formulario de Stripe ya NO se monta aquí dentro. Cobrar
              en mitad de la ficha —con cabecera, menú lateral, pie y chat
              alrededor— era la segunda experiencia de pago del producto, y el
              cliente pidió justo lo contrario: «el checkout tiene que estar lo
              más aislado posible». El botón lleva a `/reservas/<id>/pagar`, que
              comparte layout con el checkout de una reserva nueva. */}
          {booking.status === "pending_payment" ? (
            <PanelCard>
              <PanelCardTitle>Termina tu pago</PanelCardTitle>
              <p className="mt-3.5 text-sm text-[#6b6b6b]">
                Tu horario está reservado, pero el pago quedó a medias. La
                reserva se libera sola si no se completa.
              </p>
              <Button
                asChild
                className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
              >
                <Link href={`/reservas/${booking.id}/pagar`}>Pagar ahora</Link>
              </Button>
            </PanelCard>
          ) : null}

          {booking.status === "completed" ? (
            <PanelCard>
              <PanelCardTitle>Tu reseña</PanelCardTitle>
              <p className="mt-3.5 text-sm text-[#6b6b6b]">
                Cuenta cómo te fue: ayuda a otros alumnos a elegir.
              </p>
              <Button
                asChild
                className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
              >
                <Link href={`/reservas/${booking.id}/resena`}>Dejar reseña</Link>
              </Button>
            </PanelCard>
          ) : null}
        </div>

        {/* V-6 · Encima del chat y no debajo: quien abre esta pantalla para
            escribirle primero quiere saber a quién. Sin `chatHref` — el hilo
            está justo aquí abajo, y un botón «Escribirle» que baja tres
            centímetros es ruido. */}
        <TutorSummary tutor={ficha} />

        <PanelCard className="flex flex-col gap-3">
          <PanelCardTitle className="text-base">
            {tutor ? `Chat con ${tutor}` : "Chat con el tutor"}
          </PanelCardTitle>
          <p className="text-xs text-[#6b6b6b]">
            Disponible desde 2 días antes de tu 1ª sesión.
          </p>
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
          {/* "Descargar conversación" del Figma depende de US-1703 (`EY-76`),
              reabierta el 17-jul: la retención del chat sigue sin decidirse. */}
        </PanelCard>
      </div>

      {/* ⚠️ LA POLÍTICA DE CANCELACIÓN, AL FINAL Y FUERA DE LA REJILLA.

          Estaba en la columna izquierda, entre el pago y la reseña. Ahí es un
          bloque de texto fijo —los plazos de RN-37, que no cambian por reserva—
          empujando hacia abajo la única parte viva de la pantalla: el chat con
          el tutor. Al sacarla de la rejilla, la fila que comparten las dos
          columnas la marcan las sesiones y el pago, y el hilo gana todo el alto
          que ocupaba este párrafo.

          Solo se ha movido: mismo texto, mismo `CANCELLABLE`, mismo botón. Los
          plazos siguen leyéndose de `lib/policy.ts` (RN-37) y no escritos aquí,
          que es lo que mantiene esta tarjeta y las páginas legales diciendo lo
          mismo. */}
      <PanelCard>
        <PanelCardTitle>Política de cancelación</PanelCardTitle>
        <p className="mt-3.5 text-sm text-[#6b6b6b]">
          Cancela con {P.cutoffHours} h o más de anticipación y recibe{" "}
          {P.refundPct.studentEarly} % de reembolso. Con menos de{" "}
          {P.cutoffHours} h, el reembolso es del {P.refundPct.studentLate} %. Si
          cancela el tutor, {P.refundPct.tutorCancels} %.
        </p>
        {CANCELLABLE.has(booking.status) ? (
          <Button
            asChild
            variant="outline"
            className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] text-[#262626]"
          >
            <Link href={`/reservas/${booking.id}/cancelar`}>
              Cancelar reserva
            </Link>
          </Button>
        ) : null}
      </PanelCard>
    </PanelShell>
  );
}
