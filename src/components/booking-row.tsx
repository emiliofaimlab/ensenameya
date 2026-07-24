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
  title,
  when,
  status,
  note,
  action,
}: {
  href: string;
  tutor?: string;
  title: string;
  when: string | null;
  status: string;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e0eeff] text-brand">
          <CalendarDaysIcon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          {tutor ? <p className="text-xs text-[#6b6b6b]">con {tutor}</p> : null}
          <Link
            href={href}
            className="text-[13.5px] font-medium text-[#333333] hover:underline"
          >
            {title}
          </Link>
          <p className="text-xs text-[#6b6b6b] first-letter:uppercase">
            {when
              ? `${formatSessionTime(when)} · tu hora local`
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
