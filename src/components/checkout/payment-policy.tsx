import { ShieldCheckIcon } from "lucide-react";

import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { cn } from "@/lib/utils";

/**
 * D-4 (§20.14) · LO QUE SE PROMETE ANTES DE PAGAR, EN UN SOLO SITIO.
 *
 * Hay DOS pantallas donde se cobra —el checkout de una reserva nueva y el
 * «Pagar ahora» de una que se quedó a medias (`/reservas/[id]/pagar`)— y las
 * dos hablan de la MISMA reserva y del MISMO dinero. Cuando cada una escribía
 * su propio párrafo, D-4 se aplicó solo a la primera: la segunda se quedó
 * contando la mitad buena de la política (el 100 % con 24 h) y callando la
 * mala (el 50 % con menos). Un sesgo que además va en la dirección que vende,
 * que es la peor de las dos direcciones para equivocarse.
 *
 * Por eso el texto vive aquí y no en las pantallas: un componente compartido no
 * puede aplicarse a medias.
 *
 * ⚠️ Y LOS NÚMEROS SALEN DE `lib/policy.ts`, NUNCA ESCRITOS A MANO. Esa
 * constante es la copia que se enseña de lo que aplica `cancel_booking` en SQL
 * (RN-37), y desde X-01 ese porcentaje se convierte en un `refunds.create`
 * contra el PSP. Un número tecleado aquí que no cuadre con la función no es una
 * errata de copia: es una promesa contractual que el dinero no cumple, y en
 * este proyecto ya pasó una vez.
 *
 * M-06 · sin códigos internos (RN-xx) en el texto: no significan nada para
 * quien está a punto de pagar. Y NUNCA el reparto con el tutor.
 */
export function PaymentPolicy({
  aceptaSola,
  className,
}: {
  /**
   * `products.auto_accept_bookings`. Cambia lo que se PROMETE: con la
   * aceptación automática la reserva pagada salta a `confirmed` sin pasar por
   * `pending_acceptance`, así que no existe la ventana de 24 h ni su reembolso
   * íntegro automático (RN-38). Anunciarlo igual sería prometer algo que el
   * código ya no hace.
   *
   * Cada pantalla lee el dato por su cuenta —una desde `products`, la otra
   * desde la reserva— y lo pasa; este componente no consulta nada.
   */
  aceptaSola: boolean;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "flex flex-col gap-2.5 text-[11px] leading-relaxed text-[#6b6b6b]",
        className,
      )}
    >
      <div className="flex gap-2">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-success" />
        <div>
          <dt className="font-semibold text-[#4b4b4b]">
            Cuándo queda confirmada
          </dt>
          <dd>
            {aceptaSola
              ? "En cuanto se acredite el pago: el horario es tuyo, sin esperar a nadie."
              : `El tutor tiene ${P.cutoffHours} h para aceptarla. Si no responde a tiempo, se cancela sola y se te devuelve el ${P.refundPct.studentEarly} %.`}
          </dd>
        </div>
      </div>
      <div>
        <dt className="font-semibold text-[#4b4b4b]">Si cancelas</dt>
        <dd>
          Con {P.cutoffHours} h o más de antelación te devolvemos el{" "}
          {P.refundPct.studentEarly} %; con menos de {P.cutoffHours} h, el{" "}
          {P.refundPct.studentLate} %. Si cancela el tutor, siempre el{" "}
          {P.refundPct.tutorCancels} %.
        </dd>
      </div>
    </dl>
  );
}
