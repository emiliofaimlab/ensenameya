import { notFound, redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime } from "@/lib/booking";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { PanelCard, PanelShell } from "@/components/layout/panel-shell";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { SessionRef } from "@/components/room/session-ref";
import { TutorCancelForm } from "./cancel-form";
import { studentName, studentOfTutor } from "../../../students";
import type { Database } from "@/lib/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Los mismos estados que ofrecen "Cancelar" en el detalle (SCR-TU08). */
const CANCELLABLE = new Set<BookingStatus>(["pending_acceptance", "confirmed"]);

export const metadata = { title: "Cancelar reserva · Enséñame Ya" };

/**
 * N-34 · SCR-TU08b — cancelar una reserva siendo el TUTOR.
 *
 * Antes esto era un `window.confirm()`. Se reportó una clase «cancelada sola al
 * rato» que nadie había confirmado cancelar, y el diálogo nativo lo explica:
 * tras varios seguidos en la misma pestaña el navegador ofrece «impedir que
 * esta página cree más diálogos» y a partir de ahí `confirm()` devuelve false
 * SIN preguntar. Falla cerrado, sí — pero cerrado significa que la reserva se
 * queda sin responder, vence el plazo de 24 h de RN-38 y la cancela el job.
 * Desde fuera es idéntico a «se canceló sola».
 *
 * El lado alumno ya tenía pantalla propia (SCR-AL07) con importe y política:
 * esta es su equivalente, con lo que cambia para el tutor —cancela él, así que
 * RN-37 devuelve el 100 % pase lo que pase, y él no cobra nada.
 *
 * Las cifras son informativas: el porcentaje y el importe los recalcula
 * `cancel_booking` en servidor sobre `payments.gross_amount` (regla de oro 2).
 * Aquí se usa `bookings.total_amount` porque es lo que el tutor puede leer.
 */
export default async function TutorCancelBookingPage({
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
      "id, status, total_amount, currency, num_sessions, student_id, products(title), sessions(id, start_at, status, session_ref)",
    )
    .eq("id", id)
    .eq("tutor_id", user.id)
    .maybeSingle();

  if (!booking) notFound();
  // Ya no cancelable (o nunca lo fue): al detalle, que es donde está el estado.
  if (!CANCELLABLE.has(booking.status)) redirect(`/tutor/reservas/${id}`);

  const student = await studentOfTutor(supabase, booking.student_id);

  // Solo se cancelan las sesiones que siguen agendadas: las ya dictadas no se
  // deshacen, y contarlas aquí inflaría lo que el tutor cree estar tirando.
  const scheduled = [...(booking.sessions ?? [])]
    .filter((s) => s.status === "scheduled")
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  // RN-37: cancela el tutor → 100 %, sin ventana de 24 h que valga.
  const pct = P.refundPct.tutorCancels;
  const refund = Math.round((booking.total_amount * pct) / 100);

  return (
    <PanelShell
      items={TUTOR_ITEMS}
      back={{ href: `/tutor/reservas/${id}`, label: "Volver al detalle" }}
      eyebrow="Reservas / Cancelar"
      title="Cancelar esta reserva"
      description={`${booking.products?.title ?? "Mentoría"} · con ${studentName(student)}. Revisa qué implica antes de confirmar.`}
    >
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Qué se cancela
        </h2>
        {scheduled.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6b6b6b]">
            No queda ninguna sesión agendada; se cancela la reserva y se
            reembolsa lo pagado.
          </p>
        ) : (
          <ul className="mt-3.5 flex flex-col gap-2.5">
            {scheduled.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <span className="font-medium text-[#333333] first-letter:uppercase">
                  {formatSessionTime(s.start_at, tz)}
                </span>
                {/* N-27 · el nº que el alumno usará si llama a preguntar. */}
                <SessionRef nro={s.session_ref} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3.5 border-t border-[#e0e0e0] pt-3.5 text-xs text-[#6b6b6b]">
          {scheduled.length} de {booking.num_sessions}{" "}
          {booking.num_sessions === 1 ? "sesión" : "sesiones"}
          {scheduled.length === booking.num_sessions && booking.num_sessions > 1
            ? " (el paquete entero)"
            : ""}
          . Las horas están en tu zona horaria
          {student?.timezone ? `; la de tu alumno es ${student.timezone}` : ""}.
        </p>
      </PanelCard>

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Cuánto se devuelve
        </h2>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          La política es única de plataforma y distingue quién cancela:
          si cancela el alumno depende de la antelación ({P.refundPct.studentEarly}{" "}
          % con {P.cutoffHours} h o más, {P.refundPct.studentLate} % con menos).
          Cuando cancelas tú se devuelve el {pct} %, canceles cuando canceles.
        </p>
        <div className="mt-3.5 flex items-baseline justify-between border-t border-[#e0e0e0] pt-3.5">
          <span className="text-sm text-[#6b6b6b]">
            Se reembolsa a {studentName(student)}
          </span>
          <span className="text-lg font-bold text-brand">
            {formatMoney(refund, booking.currency)}
          </span>
        </div>
        <p className="mt-2 text-xs text-[#6b6b6b]">
          Estimación sobre el total de la reserva; el importe exacto lo calcula
          el sistema al cancelar. El reembolso sale hacia el medio de pago con
          el que pagó, y puede tardar unos días en reflejarse en su cuenta.
        </p>
        <div className="mt-3.5 rounded-[12px] bg-muted p-3.5">
          <p className="text-[13px] font-medium text-[#333333]">
            Tú no cobras nada por esta reserva
          </p>
          <p className="mt-0.5 text-xs text-[#6b6b6b]">
            Al devolverse el {pct} %, esta reserva deja de contar para tu saldo.
            Si ya estaba en retención, sale de ahí.
          </p>
        </div>
      </PanelCard>

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">A quién se avisa</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-[#4d4d4d]">
          <li>
            A <span className="font-medium">{studentName(student)}</span>, por
            correo, con el aviso de cancelación y el del reembolso (NTF-09 y
            NTF-10).
          </li>
          <li>A ti, con la misma copia de cancelación, para que te quede constancia.</li>
          <li>
            El chat de la reserva se cierra: dejaréis de poder escribiros por
            aquí.
          </li>
        </ul>
      </PanelCard>

      <TutorCancelForm bookingId={booking.id} />

      <p className="flex items-center gap-2 text-xs text-[#bf3333]">
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        Esta acción no se puede deshacer: para volver a dar la clase, el alumno
        tendría que reservarla de nuevo.
      </p>
    </PanelShell>
  );
}
