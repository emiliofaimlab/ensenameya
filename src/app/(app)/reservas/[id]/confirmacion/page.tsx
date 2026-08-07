import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckIcon, MailIcon, MessageSquareIcon, VideoIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, tutorNames } from "@/lib/booking";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Reserva confirmada · Enséñame Ya" };

const STEPS = [
  {
    icon: MailIcon,
    text: "Revisa tu correo: incluye el recibo y los enlaces de cada sesión.",
  },
  {
    icon: VideoIcon,
    text: 'Entra a la sala desde "Mis reservas" hasta 10 min antes de cada sesión.',
  },
  {
    icon: MessageSquareIcon,
    text: "Puedes chatear con tu tutor desde el detalle de la reserva.",
  },
];

/**
 * SCR-AL06 — confirmación de la reserva, como página propia y centrada (antes
 * era un estado dentro del checkout, bajo un h1 "Confirmar pago" que ya no
 * pintaba). Se llega tras `confirm_payment`. La redacción dice la verdad: la
 * reserva queda **pendiente de que el tutor la acepte**, no "confirmada".
 */
export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const tz = await getUserTimezone();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, products(title, tutor_id), sessions(start_at, end_at)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!booking) notFound();

  // Con el checkout alojado se puede llegar aquí ANTES de que el webhook haya
  // confirmado el cobro: Stripe redirige al alumno en cuanto paga, y su evento
  // llega por otro camino y a su ritmo. Decir "reserva registrada" con el pago
  // aún pendiente sería prometer algo que todavía no ha pasado.
  const pagoPendiente = booking.status === "pending_payment";

  const names = await tutorNames(supabase, [booking.products?.tutor_id]);
  const tutor = names.get(booking.products?.tutor_id ?? "");
  const sessions = [...(booking.sessions ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );

  const range = (s: { start_at: string; end_at: string }) =>
    `${formatSessionTime(s.start_at, tz)} – ${new Date(s.end_at).toLocaleTimeString(
      "es",
      { hour: "2-digit", minute: "2-digit", timeZone: tz },
    )}`;

  return (
    <div className="bg-muted py-14">
      <div className="mx-auto flex w-full max-w-[600px] flex-col items-center gap-4 px-4">
        <span className="grid size-[120px] place-items-center rounded-full bg-brand/15">
          <span className="grid size-20 place-items-center rounded-full bg-brand text-white">
            <CheckIcon className="size-9" strokeWidth={3} />
          </span>
        </span>

        <h1 className="text-center text-[26px] font-bold text-[#19191f]">
          {pagoPendiente ? "Estamos confirmando tu pago" : "¡Reserva registrada!"}
        </h1>
        <p className="text-center text-sm text-[#6b6b6b]">
          {pagoPendiente ? (
            <>
              Tu horario está reservado mientras el proveedor de pago nos
              confirma el cobro; suele tardar unos segundos. Puedes cerrar esta
              página: te avisamos por correo en cuanto esté, y desde{" "}
              <span className="font-medium text-[#333333]">Mis reservas</span>{" "}
              verás el estado actualizado.
            </>
          ) : (
            <>
              {tutor
                ? `Tu reserva con ${tutor} quedó agendada. `
                : "Tu reserva quedó agendada. "}
              Le avisamos al tutor: cuando la acepte (hasta 24 h) te confirmamos
              por correo. Si no responde, se reembolsa el 100 %.
            </>
          )}
        </p>

        <section className="mt-2 w-full rounded-[16px] border border-[#e0e0e0] bg-card p-5">
          <h2 className="text-base font-semibold text-[#19191f]">
            Resumen de tu reserva
          </h2>
          <dl className="mt-3.5 flex flex-col gap-2.5 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-[#6b6b6b]">Producto</dt>
              <dd className="text-right font-medium text-[#333333]">
                {booking.products?.title ?? "Clase"}
              </dd>
            </div>
            {tutor ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[#6b6b6b]">Tutor</dt>
                <dd className="font-medium text-[#333333]">{tutor}</dd>
              </div>
            ) : null}
          </dl>

          <p className="mt-3.5 border-t border-[#e0e0e0] pt-3.5 text-xs text-[#6b6b6b]">
            Sesiones agendadas (horario bloqueado)
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.start_at}
                className="flex items-center gap-2 text-[13px] text-[#404040]"
              >
                <CheckIcon className="size-3.5 shrink-0 text-brand" strokeWidth={3} />
                <span className="first-letter:uppercase">{range(s)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3.5 flex items-baseline justify-between border-t border-[#e0e0e0] pt-3.5">
            <span className="text-sm text-[#6b6b6b]">Total pagado</span>
            <span className="text-lg font-bold text-brand">
              {formatMoney(booking.total_amount, booking.currency)}
            </span>
          </div>
        </section>

        <section className="w-full rounded-[16px] border border-[#e0e0e0] bg-card p-5">
          <h2 className="text-base font-semibold text-[#19191f]">
            Próximos pasos
          </h2>
          <ul className="mt-3.5 flex flex-col gap-3">
            {STEPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-brand text-white">
                  <Icon className="size-3.5" />
                </span>
                <span className="text-[13px] text-[#404040]">{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Button asChild className="h-[49px] rounded-[10px] px-6 font-semibold">
            <Link href={`/reservas/${booking.id}`}>Ver detalle de la reserva</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-[49px] rounded-[10px] px-6"
          >
            <Link href="/app">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
