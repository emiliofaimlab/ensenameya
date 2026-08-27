import Link from "next/link";
import { CalendarDaysIcon } from "lucide-react";

import { formatSessionTime } from "@/lib/booking";
import { StatusPill } from "@/components/layout/panel-shell";

/**
 * Fila de reserva del Figma (157:5, AL02 y "Mis reservas"): icono redondo,
 * "con {tutor}", título enlazado al detalle, fecha en hora local y estado.
 */
export function BookingRow({
  href,
  tutor,
  tutorHref,
  title,
  when,
  status,
  note,
  action,
  timeZone,
}: {
  href: string;
  tutor?: string;
  /**
   * V-6 · La ficha pública del tutor, si se puede llegar a ella. Aquí no cabe
   * la tarjeta entera de `TutorSummary` —esto es una fila de lista—, así que la
   * vuelta al tutor es el propio «con Fulanito», que hasta hoy era texto muerto.
   *
   * ⚠️ Opcional, y no por comodidad: a un tutor se le puede retirar la
   * aprobación, y entonces su ficha deja de ser legible para el alumno.
   * Sin enlace se pinta el texto de siempre, que es lo correcto — enlazarlo
   * daría un 404 desde el panel del propio alumno. Ver `tutorCards`.
   */
  tutorHref?: string;
  title: string;
  when: string | null;
  status: string;
  note?: string;
  action?: React.ReactNode;
  /** tz IANA del usuario: es server component, sin ella saldría la hora del servidor (R24-12). */
  timeZone: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e0eeff] text-brand">
          <CalendarDaysIcon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          {tutor ? (
            <p className="text-xs text-[#6b6b6b]">
              con{" "}
              {tutorHref ? (
                <Link
                  href={tutorHref}
                  className="font-medium text-brand hover:underline"
                >
                  {tutor}
                </Link>
              ) : (
                tutor
              )}
            </p>
          ) : null}
          <Link
            href={href}
            className="text-[13.5px] font-medium text-[#333333] hover:underline"
          >
            {title}
          </Link>
          <p className="text-xs text-[#6b6b6b] first-letter:uppercase">
            {when
              ? `${formatSessionTime(when, timeZone)} · tu hora local`
              : "Sin horario aún"}
          </p>
          <StatusPill className="mt-1.5">{status}</StatusPill>
        </div>
      </div>
      {action || note ? (
        <div className="flex flex-col items-end gap-1.5">
          {action}
          {note ? <p className="text-xs text-[#6b6b6b]">{note}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
