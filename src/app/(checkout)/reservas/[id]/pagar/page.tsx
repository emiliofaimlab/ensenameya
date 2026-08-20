import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, tutorNames } from "@/lib/booking";
import { ResumePayment } from "@/components/checkout/resume-payment";
import { PaymentPolicy } from "@/components/checkout/payment-policy";
import { SessionRef } from "@/components/room/session-ref";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";

export const metadata = { title: "Confirmar pago · Enséñame Ya" };

/**
 * "Pagar ahora" de una reserva que se quedó a medias, como PANTALLA propia.
 *
 * N-37 · el cliente pidió aislar el checkout, y este es el segundo sitio donde
 * se cobra: hasta hoy el formulario de Stripe se montaba dentro del detalle de
 * la reserva (`/reservas/<id>`), o sea con cabecera, menú lateral, pie, chat y
 * el resto de la ficha alrededor. Aislar solo uno de los dos dejaba dos
 * experiencias de pago distintas para el mismo dinero, que es peor que no
 * aislar ninguno. Comparte layout con el checkout de una reserva nueva.
 *
 * NO crea nada ni cobra nada por sí sola: reutiliza la reserva que ya existe
 * (ver `components/checkout/resume-payment.tsx`), que desde D-2 (§20.14) abre
 * su formulario al llegar en vez de esperar a un botón.
 */
export default async function PagarReservaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  // RLS hace de guardia: `bookings_select_own` filtra por `student_id`, así que
  // la reserva de otro devuelve 404 y no 403.
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, num_sessions, session_duration_min, products(title, tutor_id, auto_accept_bookings), sessions(id, start_at, session_ref)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  // Esta pantalla SOLO tiene sentido con el cobro pendiente. Si ya se pagó (o se
  // canceló, o expiró y el cron la liberó) el Route Handler devolvería un 409 y
  // el alumno se quedaría mirando un botón que no puede funcionar: mejor
  // mandarlo al detalle, que sí sabe contarle en qué estado está.
  if (booking.status !== "pending_payment") redirect(`/reservas/${id}`);

  const names = await tutorNames(supabase, [booking.products?.tutor_id]);
  const tutor = names.get(booking.products?.tutor_id ?? "");
  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">
      <div>
        {/* Única salida, y hacia la propia reserva: sin ella, alguien que llega
            aquí por error no tiene a dónde ir salvo el botón de atrás. */}
        <Link
          href={`/reservas/${id}`}
          className="mb-4 flex w-fit items-center gap-1.5 text-sm text-[#6b6b6b] transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Volver a la reserva
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Confirmar pago
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Tu horario sigue reservado, pero el pago quedó a medias. La reserva se
          libera sola si no se completa.
        </p>
      </div>

      <PanelCard>
        <PanelCardTitle className="text-[15px]">
          Resumen del pedido
        </PanelCardTitle>
        <div className="mt-3.5">
          <p className="text-sm font-medium text-[#19191f]">
            {booking.products?.title ?? "Mentoría"}
          </p>
          <p className="text-xs text-[#6b6b6b]">
            {tutor ? `con ${tutor} · ` : ""}
            {booking.num_sessions === 1
              ? "Sesión suelta"
              : `Paquete ${booking.num_sessions} sesiones`}
            {booking.session_duration_min
              ? ` · ${booking.session_duration_min} min`
              : ""}
          </p>
        </div>

        <ul className="mt-3.5 flex flex-col gap-2 border-t border-[#e0e0e0] pt-3.5">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-xs text-[#6b6b6b] first-letter:uppercase">
                {formatSessionTime(s.start_at, tz)}
              </span>
              {/* N-27 · el número que el cliente pidió para «hacerle seguimiento
                  a las transacciones». Aquí es donde más sentido tiene: es el
                  cobro que está a medias y por el que va a llamar. */}
              <SessionRef nro={s.session_ref} />
            </li>
          ))}
        </ul>

        <div className="mt-3.5 flex items-baseline justify-between border-t border-[#e0e0e0] pt-3.5">
          <span className="font-semibold text-[#19191f]">Total</span>
          <span className="text-lg font-bold text-brand">
            {formatMoney(booking.total_amount, booking.currency)}
          </span>
        </div>

        {/* M-02 · lo que pasa DESPUÉS de pagar depende de la mentoría, no del
            tutor: si acepta sola, el cobro confirma la reserva y la ventana de
            24 h de RN-38 —con su reembolso íntegro automático— no llega a
            existir. Se cuenta lo que va a pasar de verdad.

            ⚠️ D-4 (§20.14) SE HABÍA APLICADO A UNA SOLA DE LAS DOS PANTALLAS DE
            PAGO. Aquí ponía un párrafo propio que contaba la mitad buena de la
            política —«cancela con 24 h y recibe el 100 %»— y callaba el 50 % de
            quien cancela tarde, mientras el checkout de una reserva nueva ya la
            contaba entera. Misma reserva, mismo dinero, dos promesas distintas,
            y el sesgo iba en la dirección que vende. El texto es ahora el mismo
            componente en las dos, con los números saliendo de `lib/policy.ts`
            —o sea de lo que aplica `cancel_booking`— y no escritos a mano. */}
        <PaymentPolicy
          aceptaSola={Boolean(booking.products?.auto_accept_bookings)}
          className="mt-3.5 border-t border-[#e0e0e0] pt-3.5"
        />
      </PanelCard>

      <PanelCard>
        <PanelCardTitle className="text-[15px]">Método de pago</PanelCardTitle>
        {/* D-2 (§20.14) · el formulario ya no espera a que nadie pulse: se
            monta al llegar. Así que esto deja de anunciarlo en futuro y se
            queda con lo único que hay que decir aquí. */}
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]">
          Los datos de tu tarjeta viajan directamente a nuestro proveedor de
          pagos: nunca pasan por Enséñame Ya.
        </p>
        <ResumePayment bookingId={booking.id} />
      </PanelCard>
    </div>
  );
}
