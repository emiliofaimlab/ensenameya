import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarIcon, GiftIcon, UsersIcon, VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Precio } from "@/components/precio/precio";
import { formatSessionTime } from "@/lib/booking";
import { priceDisplay } from "@/lib/catalog/format";
import type { ProductDetail } from "@/lib/catalog/queries";
import type { FormatoHora } from "@/lib/hora";

/**
 * G2 · el panel de la ficha de una CLASE GRUPAL. Sustituye a `BookingPanel`:
 * aquí no se elige horario —las fechas las publicó el tutor (RG-01)—, así que
 * es una lista y un botón. El botón va al checkout sin `?slots=`: las fechas
 * las pone el propio checkout desde la clase, y `create_booking_line` exige que
 * coincidan con las publicadas.
 *
 * Server component a propósito: no hay nada que elegir, no hace falta JS.
 */
export function GrupalPanel({
  product,
  timeZone,
  formato,
  inscribirHref,
  regaloHref,
  footer,
}: {
  product: ProductDetail;
  timeZone: string;
  formato: FormatoHora;
  /** Resuelto en servidor (regla de oro 13). */
  inscribirHref: string;
  /** `undefined` = no se ofrece (la mentoría es propia). */
  regaloHref?: string;
  footer?: ReactNode;
}) {
  const g = product.grupal;
  const precio = priceDisplay(product);
  const llena = !g || g.cuposLibres <= 0;
  const cerrada = !g?.abierta;
  const puedeRegalar = regaloHref && g?.regalable;
  const motivo = cerrada
    ? "La inscripción a esta clase ya cerró"
    : llena
      ? "Esta clase ya no tiene cupos"
      : null;

  return (
    <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)] lg:sticky lg:top-24">
      <h2 className="text-lg font-bold text-[#19191f]">
        Inscríbete en esta clase
      </h2>
      <Precio
        amountMinor={precio.amountMinor}
        ceroEsGratis
        currency={product.currency}
        nota={precio.note}
        className="mt-2 text-[26px] leading-tight font-bold text-[#19191f]"
        notaClassName="text-xs text-[#666666]"
      />

      <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#19191f]">
        <CalendarIcon className="size-4 text-brand" aria-hidden />
        {g && g.fechas.length > 1 ? `${g.fechas.length} fechas` : "Fecha"}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-[#474747]">
        {(g?.fechas ?? []).map((f) => (
          <li key={f.startAt} className="rounded-[8px] bg-[#f5f5f5] px-3 py-2">
            {formatSessionTime(f.startAt, timeZone, formato)}
          </li>
        ))}
      </ul>
      {g && g.fechas.length > 1 ? (
        <p className="mt-1.5 text-xs text-[#6b6b6b]">
          Pagas el ciclo completo. Si faltas a una fecha, la pierdes.
        </p>
      ) : null}

      <p className="mt-4 flex items-center gap-2 text-sm text-[#474747]">
        <UsersIcon className="size-4 text-brand" aria-hidden />
        {g
          ? llena
            ? `Clase completa · ${g.capacity} cupos`
            : `Quedan ${g.cuposLibres} de ${g.capacity} cupos`
          : "Sin fechas publicadas"}
      </p>

      {/* RG-19 · se avisa ANTES de inscribirse, no en la sala. */}
      <p className="mt-4 flex gap-2 rounded-[10px] bg-brand-muted px-3 py-2.5 text-xs text-[#33475b]">
        <VideoIcon className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        Es una clase en grupo y se graba: los demás inscritos verán tu nombre y
        tu foto en la sala y en el chat de la clase.
      </p>

      {motivo ? (
        <Button disabled className="mt-4 h-12 w-full text-[15px]">
          {motivo}
        </Button>
      ) : (
        <Button asChild className="mt-4 h-12 w-full text-[15px]">
          <Link href={inscribirHref}>Inscribirme</Link>
        </Button>
      )}

      {puedeRegalar ? (
        <Button asChild variant="outline" className="mt-3 h-11 w-full text-[14px]">
          <Link href={regaloHref}>
            <GiftIcon aria-hidden />
            Regalar un cupo
          </Link>
        </Button>
      ) : null}

      <p className="mt-4 text-center text-xs text-[#6b6b6b]">
        Pago protegido · Cancela tu cupo con 24 h y recibe el 100 %
      </p>
      {footer}
    </aside>
  );
}
