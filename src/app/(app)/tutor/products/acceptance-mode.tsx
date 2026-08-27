"use client";

import { AlertTriangleIcon } from "lucide-react";

import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { cn } from "@/lib/utils";

/**
 * M-02 (SCR-TU04) — cómo se confirman las reservas de ESTA mentoría.
 *
 * Escribe `products.auto_accept_bookings`, que es la columna que lee de verdad
 * `confirm_payment` desde `20260817180000`. El interruptor que vivía en
 * `/tutor/reservas` escribía `tutor_profiles.auto_accept_bookings` — una
 * columna que desde esa misma migración ya no decide nada —, así que se retiró
 * junto con este componente: era un control que no cambiaba el comportamiento.
 *
 * ⚠️ POR QUÉ SON DOS OPCIONES Y NO UN SWITCH, que es lo que había antes.
 * El valor por defecto de la columna es `true` (lo pidió el cliente, literal, y
 * la migración lo defiende por escrito), así que la opción marcada al crear una
 * mentoría es «se confirman solas». Un switch solo sabe describir el estado en
 * el que está: un tutor nuevo vería «Aceptar automáticamente ✓» y ni se
 * enteraría de lo que pierde el alumno al otro lado. Con las dos opciones a la
 * vista, la consecuencia se lee ANTES de guardar aunque no se toque nada. El
 * default no se cambia —eso sería revertir una decisión del cliente—, se
 * explica.
 *
 * ⚠️ Y LO QUE SE PIERDE NO ES OBVIO: sin `pending_acceptance` no hay ventana de
 * 24 h, y sin ventana no hay cancelación ni reembolso automáticos (RN-38, los
 * aplica `expire_stale_bookings` mirando EXACTAMENTE ese estado). Por eso el
 * aviso de abajo se enseña siempre que la opción está activa, también en el
 * alta: es justo ahí donde nadie lo eligió a propósito.
 *
 * Los porcentajes salen de `lib/policy.ts`, nunca escritos a mano — misma regla
 * que `components/checkout/payment-policy.tsx`, y por el mismo motivo: son lo
 * que aplica `cancel_booking` en SQL.
 */
export function AcceptanceMode({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const OPCIONES = [
    {
      value: true,
      label: "Se confirman solas",
      detail:
        "En cuanto el alumno paga, la reserva queda confirmada y el horario se bloquea en tu agenda. No tienes que responder nada.",
    },
    {
      value: false,
      label: "Las acepto yo, una a una",
      detail: `La reserva pagada espera tu respuesta y la ves en «Reservas». Tienes ${P.cutoffHours} h para aceptarla o rechazarla; si no contestas a tiempo, se cancela sola y el alumno recupera el ${P.refundPct.studentEarly} %.`,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-col gap-2.5"
        role="radiogroup"
        aria-label="Cómo se confirman las reservas de esta mentoría"
      >
        {OPCIONES.map((opt) => {
          const on = value === opt.value;
          return (
            <label
              key={String(opt.value)}
              className={cn(
                "flex cursor-pointer gap-3 rounded-[12px] border p-3.5 transition-colors",
                on
                  ? "border-brand bg-brand/5"
                  : "border-[#e0e0e0] bg-card hover:border-brand",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="auto_accept_bookings"
                className="sr-only"
                checked={on}
                disabled={disabled}
                onChange={() => onChange(opt.value)}
              />
              {/* Punto de radio dibujado a mano: el nativo no se puede teñir de
                  marca sin `appearance-none`, y con él hay que pintarlo igual. */}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]",
                  on ? "border-brand" : "border-[#c4c4c4]",
                )}
              >
                {on ? <span className="size-2.5 rounded-full bg-brand" /> : null}
              </span>
              <span>
                <span className="block text-sm font-semibold text-[#19191f]">
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[#6b6b6b]">
                  {opt.detail}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {value ? (
        <div className="flex gap-3 rounded-[12px] border border-[#f5d9a8] bg-[#fdf4e3] p-4">
          <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-[#a67314]" />
          <div className="text-[12.5px] leading-relaxed text-[#6b5327]">
            <p className="text-sm font-semibold text-[#19191f]">
              Lo que el alumno pierde a cambio
            </p>
            <p className="mt-1">
              Ese plazo de {P.cutoffHours} h es también su red: si la reserva
              espera tu respuesta y no llega, se le devuelve el{" "}
              {P.refundPct.studentEarly} % sin que tenga que pedirlo. Confirmada
              al instante ya no hay plazo que se pueda vencer, así que esa
              devolución automática deja de existir.
            </p>
            <p className="mt-1.5">
              Si luego no puedes dar la clase, cancélala tú y el alumno recupera
              el {P.refundPct.tutorCancels} %. Lo que ya no ocurre solo es lo
              otro: dejar de responder y que el dinero vuelva.
            </p>
          </div>
        </div>
      ) : null}

      {/* La columna la lee `anon` (ficha pública, RN-24) y el checkout ya la
          usa para decidir qué promete antes de pagar. Se dice, porque un tutor
          que cree estar tocando una preferencia privada no entendería que su
          página cambie de texto. */}
      <p className="text-xs text-[#6b6b6b]">
        El alumno lo ve antes de pagar: la pantalla de pago le dice si la
        mentoría queda confirmada al instante o si te espera a ti.
      </p>
    </div>
  );
}
