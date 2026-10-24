import type { ReactNode } from "react";
import { CalendarIcon, UsersIcon, VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Precio } from "@/components/precio/precio";
import { priceDisplay } from "@/lib/catalog/format";
import type { ProductDetail } from "@/lib/catalog/queries";
import { AVISO_PRIVACIDAD_GRUPAL } from "@/lib/policy";

/**
 * RG-01 (24-oct) · el panel de la ficha de una CLASE GRUPAL. Sustituye al
 * panel de fechas fijas (`grupal-panel.tsx`, borrado): la hora ya no la publica
 * el tutor, la fija el primer alumno, igual que en una 1:1. El botón lleva al
 * MISMO selector de horario de las 1:1 (`/reservar/<id>`), que pinta primero,
 * destacadas, las clases que ya nacieron y admiten gente, y debajo los
 * horarios libres para abrir una nueva.
 *
 * Server component: no hay nada que elegir aquí.
 */
export function GrupalReservaPanel({
  product,
  reservarHref,
  esMia,
  footer,
}: {
  product: ProductDetail;
  /** Resuelto en servidor (`hrefReservar`, regla de oro 13). */
  reservarHref: string;
  /** M11 · el tutor no se inscribe en su propia clase. */
  esMia: boolean;
  footer?: ReactNode;
}) {
  const precio = priceDisplay(product);
  const n = product.packageNumSessions ?? 1;
  return (
    <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)] lg:sticky lg:top-24">
      <h2 className="text-lg font-bold text-[#19191f]">
        {esMia ? "Tu clase grupal" : "Reserva tu cupo"}
      </h2>
      <Precio
        amountMinor={precio.amountMinor}
        ceroEsGratis
        currency={product.currency}
        nota={precio.note}
        className="mt-2 text-[26px] leading-tight font-bold text-[#19191f]"
        notaClassName="text-xs text-[#666666]"
      />

      <p className="mt-4 flex items-center gap-2 text-sm text-[#474747]">
        <CalendarIcon className="size-4 text-brand" aria-hidden />
        {n > 1
          ? `Ciclo de ${n} fechas${product.sessionDurationMin ? ` de ${product.sessionDurationMin} min` : ""}`
          : `Una fecha${product.sessionDurationMin ? ` de ${product.sessionDurationMin} min` : ""}`}
      </p>
      <p className="mt-1.5 flex items-center gap-2 text-sm text-[#474747]">
        <UsersIcon className="size-4 text-brand" aria-hidden />
        {product.capacity ? `Hasta ${product.capacity} alumnos` : "Clase grupal"}
        {product.minSeats ? ` · se da con un mínimo de ${product.minSeats}` : ""}
      </p>
      <p className="mt-2 text-xs text-[#6b6b6b]">
        Súmate a una clase ya programada o elige tú el horario: quien venga
        después se suma a tu clase.
        {n > 1 ? " Pagas el ciclo completo; si faltas a una fecha, la pierdes." : ""}
      </p>

      {/* RG-19 · se avisa ANTES de inscribirse, no en la sala. */}
      <p className="mt-4 flex gap-2 rounded-[10px] bg-brand-muted px-3 py-2.5 text-xs text-[#33475b]">
        <VideoIcon className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        {AVISO_PRIVACIDAD_GRUPAL}
      </p>

      {esMia ? (
        <Button disabled className="mt-4 h-12 w-full text-[15px]">
          Es tu clase
        </Button>
      ) : (
        // `<a>`: `/reservar/<id>` cuelga de `(app)` y su guarda puede
        // redirigir (regla de oro 13). El destino ya viene resuelto.
        <Button asChild className="mt-4 h-12 w-full text-[15px]">
          <a href={reservarHref}>Elegir horario</a>
        </Button>
      )}
      {footer}
    </aside>
  );
}
