"use client";

import { useEffect, useRef, useState } from "react";

import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";
import { HoldCountdown } from "@/components/checkout/hold-countdown";
import {
  interpretar,
  irAPagar,
  type RespuestaDeCobro,
} from "@/components/checkout/respuesta-de-cobro";

/** Igual que en el checkout: primero se abre el cobro, luego se pinta. */
type Apertura =
  | { fase: "abriendo" }
  | { fase: "error"; mensaje: string }
  | { fase: "simulado"; retencionHasta: string | null }
  | { fase: "lista"; retencionHasta: string | null; embed: Embed };

/**
 * "Pagar ahora" de una reserva que se quedó a medias.
 *
 * Antes solo se podía pagar en el mismo viaje en que se creaba la reserva: si
 * alguien cerraba la pestaña o volvía atrás en el checkout, la reserva quedaba
 * en `pending_payment` reteniendo el horario y la única acción ofrecida era
 * cancelarla. Detectado usando la app el 12-ago.
 *
 * N-37 · desde el 17-ago NO se monta dentro del detalle de la reserva: vive en
 * `/reservas/<id>/pagar`, dentro del grupo `(checkout)`, sin cabecera ni menú
 * ni chat, igual que el checkout de una reserva nueva. Dos pantallas de cobro
 * con dos aspectos distintos era peor que no aislar ninguna.
 *
 * D-2/D-3 (§20.14) · y desde hoy tampoco hay puerta: ni casilla de «guardar
 * tarjeta» —la pinta Stripe dentro de su formulario— ni botón «Pagar ahora»
 * que la abra. El formulario se monta al llegar, como en el checkout. Aquí el
 * cambio es barato y por eso va junto: **la reserva YA existe**, así que montar
 * al llegar no retiene ningún horario que no estuviera retenido. Lo caro de D-2
 * —crear la reserva por visita— es problema de la otra pantalla, no de esta.
 * Van las dos o el producto se queda con dos formularios de pago distintos.
 *
 * NO crea nada: reutiliza la reserva que ya existe. `create_booking` no se
 * llama aquí —eso es lo que la duplicaría—; el Route Handler acepta el
 * `bookingId` y él mismo rechaza con 409 si ya no está en `pending_payment`
 * (pagada por otra pestaña, cancelada o expirada), así que dos pestañas
 * abiertas no pueden cobrar dos veces.
 */
export function ResumePayment({ bookingId }: { bookingId: string }) {
  const [apertura, setApertura] = useState<Apertura>({ fase: "abriendo" });
  // Qué reserva se abrió ya. Con la clave dentro y no un booleano, StrictMode
  // no abre dos veces y una navegación a OTRA reserva sí vuelve a abrir.
  const abiertoPara = useRef<string | null>(null);

  useEffect(() => {
    if (abiertoPara.current === bookingId) return;
    abiertoPara.current = bookingId;

    async function abrir() {
      setApertura({ fase: "abriendo" });
      const res = await fetch("/api/pagos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const salida = (await res.json().catch(() => ({}))) as RespuestaDeCobro;

      if (!res.ok) {
        setApertura({
          fase: "error",
          mensaje: salida.error ?? "No se pudo abrir el pago.",
        });
        return;
      }

      // A2 · qué hacer con la respuesta lo decide `interpretar`, una vez y para
      // las tres pantallas. Antes esto era un `if (clientSecret) … else
      // simulado`, y ese `else` convertía un cobro por redirección en la
      // pantalla de pruebas.
      const accion = interpretar(salida);
      const retencionHasta = salida.retencionHasta ?? null;

      if (accion.tipo === "redireccion") {
        // No se toca el estado: la pestaña se va. Dejarlo en "abriendo" es lo
        // honesto mientras el navegador navega.
        irAPagar(accion.url);
        return;
      }
      if (accion.tipo === "embebido") {
        setApertura({ fase: "lista", retencionHasta, embed: accion.embed });
        return;
      }
      if (accion.tipo === "simulado") {
        setApertura({ fase: "simulado", retencionHasta });
        return;
      }
      setApertura({ fase: "error", mensaje: accion.mensaje });
    }

    void abrir();
  }, [bookingId]);

  return (
    <>
      {apertura.fase !== "abriendo" && apertura.fase !== "error" ? (
        <HoldCountdown hasta={apertura.retencionHasta} className="mt-3.5" />
      ) : null}

      {apertura.fase === "abriendo" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]" aria-live="polite">
          Abriendo tu pago seguro…
        </p>
      ) : null}

      {apertura.fase === "error" ? (
        <p role="alert" className="mt-3.5 text-[13px] text-destructive">
          {apertura.mensaje}
        </p>
      ) : null}

      {/* Ruteo simulado (`payment_routing_rules` en 'simulated'): no hay Session
          que abrir. Aquí NO se llama a `confirm_simulated_payment` a propósito —
          sería un segundo camino de dinero escrito para un proveedor de mentira—,
          así que se dice lo que va a pasar de verdad: la reserva caduca sola y se
          vuelve a reservar. Va como texto y ya no como `toast`: el aviso salía
          al pulsar un botón que ya no existe, y un toast que aparece solo al
          cargar la pantalla se lo pierde quien mire un segundo tarde. */}
      {apertura.fase === "simulado" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]">
          Este cobro está ruteado al proveedor simulado y no se puede retomar. La
          reserva se libera sola y podrás volver a reservar el horario.
        </p>
      ) : null}

      {apertura.fase === "lista" ? (
        <div className="mt-3.5">
          <StripeEmbed {...apertura.embed} />
        </div>
      ) : null}
    </>
  );
}
