import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarIcon, GiftIcon, UsersIcon, VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Precio } from "@/components/precio/precio";
import { formatSessionTime } from "@/lib/booking";
import { priceDisplay } from "@/lib/catalog/format";
import type { ProductDetail } from "@/lib/catalog/queries";
import { opcionesDeHora, type FormatoHora } from "@/lib/hora";
import { AVISO_PRIVACIDAD_GRUPAL, CANCELLATION_POLICY as P } from "@/lib/policy";

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
  miInscripcionHref,
  miClaseHref,
  otrasHref,
  footer,
}: {
  product: ProductDetail;
  timeZone: string;
  formato: FormatoHora;
  /** Resuelto en servidor (regla de oro 13). */
  inscribirHref: string;
  /** `undefined` = no se ofrece (la mentoría es propia). */
  regaloHref?: string;
  /** El detalle de SU reserva si quien mira ya tiene cupo en esta clase. */
  miInscripcionHref?: string;
  /** M11 · la ficha del tutor, si quien mira ES el tutor de la clase. */
  miClaseHref?: string;
  /** P37 · alternativa cuando la clase está llena o cerrada (ruta pública). */
  otrasHref?: { href: string; label: string };
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
  // A12 · el mínimo solo se enseña mientras falta gente para llegar a él.
  const inscritos = g ? g.capacity - g.cuposLibres : 0;
  const faltanMin = g?.minSeats ? g.minSeats - inscritos : 0;
  // P8 · la promesa del pie depende del caso: un ciclo solo admite la baja
  // antes de la 1.ª fecha, y a menos de 24 h ya no es el 100 %.
  const pie = cerrada
    ? null
    : (product.packageNumSessions ?? 1) > 1
      ? "Pago protegido · Puedes darte de baja hasta que empiece la 1.ª fecha"
      : g?.menosDe24h
        ? `Pago protegido · Falta menos de ${P.cutoffHours} h: si cancelas, recibes el ${P.refundPct.studentLate} %`
        : `Pago protegido · Cancela tu cupo con ${P.cutoffHours} h y recibe el ${P.refundPct.studentEarly} %`;

  return (
    <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)] lg:sticky lg:top-24">
      <h2 className="text-lg font-bold text-[#19191f]">
        {miClaseHref
          ? "Tu clase grupal"
          : miInscripcionHref
            ? "Ya tienes tu cupo"
            : "Inscríbete en esta clase"}
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
            {/* P25 · rango de inicio a fin, en la zona de quien mira. */}
            {formatSessionTime(f.startAt, timeZone, formato)} –{" "}
            {new Date(f.endAt).toLocaleTimeString("es", {
              hour: "2-digit",
              minute: "2-digit",
              ...opcionesDeHora(formato),
              timeZone,
            })}
          </li>
        ))}
      </ul>
      {g && g.fechas.length > 0 ? (
        <p className="mt-1.5 text-xs text-[#6b6b6b]">
          En tu hora local ({timeZone.split("/").pop()?.replace(/_/g, " ")})
        </p>
      ) : null}
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
            : g.cuposLibres === 1
              ? `Queda 1 cupo de ${g.capacity}`
              : `Quedan ${g.cuposLibres} de ${g.capacity} cupos`
          : "Sin fechas publicadas"}
      </p>
      {/* B7 · el cron mira el mínimo una vez, al entrar en las 24 h: después
          ya no hay «faltan». */}
      {g?.minSeats != null && faltanMin > 0 && !g.menosDe24h ? (
        <p className="mt-1.5 text-xs text-[#6b6b6b]">
          Se da con un mínimo de {g.minSeats} · faltan {faltanMin}
        </p>
      ) : null}

      {/* RG-19 · se avisa ANTES de inscribirse, no en la sala. */}
      <p className="mt-4 flex gap-2 rounded-[10px] bg-brand-muted px-3 py-2.5 text-xs text-[#33475b]">
        <VideoIcon className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        {AVISO_PRIVACIDAD_GRUPAL}
      </p>

      {miClaseHref ? (
        // M11 · el tutor no se inscribe en su propia clase (`create_booking_line`
        // ya lo rechaza). `<a>` por la regla de oro 13: `/tutor/…` cuelga de
        // `(app)` y su guarda puede redirigir.
        <Button asChild className="mt-4 h-12 w-full text-[15px]">
          <a href={miClaseHref}>Es tu clase · Ver inscritos</a>
        </Button>
      ) : miInscripcionHref ? (
        // ponytail: `<a>` y no `<Link>`: `/reservas/…` cuelga de `(app)` y su
        // guarda puede redirigir (onboarding a medias tras un checkout de
        // invitado); una navegación completa esquiva la pantalla en blanco de
        // la regla de oro 13 sin resolver aquí el destino.
        <Button asChild className="mt-4 h-12 w-full text-[15px]">
          <a href={miInscripcionHref}>Ya estás inscrito · Ver mi inscripción</a>
        </Button>
      ) : motivo ? (
        <>
          <Button disabled className="mt-4 h-12 w-full text-[15px]">
            {motivo}
          </Button>
          {/* P37 · llena o cerrada no es un callejón sin salida. */}
          {otrasHref ? (
            <Button asChild variant="outline" className="mt-3 h-11 w-full text-[14px]">
              <Link href={otrasHref.href}>{otrasHref.label}</Link>
            </Button>
          ) : null}
        </>
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

      {pie ? (
        <p className="mt-4 text-center text-xs text-[#6b6b6b]">{pie}</p>
      ) : null}
      {footer}
    </aside>
  );
}
