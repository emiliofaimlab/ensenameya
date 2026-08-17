"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";

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
 * NO crea nada: reutiliza la reserva que ya existe. `create_booking` no se
 * llama aquí —eso es lo que la duplicaría—; el Route Handler acepta el
 * `bookingId` y él mismo rechaza con 409 si ya no está en `pending_payment`
 * (pagada por otra pestaña, cancelada o expirada), así que dos pestañas
 * abiertas no pueden cobrar dos veces.
 */
export function ResumePayment({ bookingId }: { bookingId: string }) {
  const [busy, setBusy] = useState(false);
  const [embed, setEmbed] = useState<Embed | null>(null);
  // Misma casilla que en el checkout (PAC-02) y también DESMARCADA: el permiso
  // para guardar la tarjeta se pide en cada cobro, no se hereda del intento
  // anterior.
  const [guardarTarjeta, setGuardarTarjeta] = useState(false);

  async function pagar() {
    setBusy(true);
    const res = await fetch("/api/pagos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, guardarTarjeta }),
    });
    const salida = (await res.json().catch(() => ({}))) as Partial<Embed> & {
      simulated?: boolean;
      error?: string;
    };
    setBusy(false);

    if (!res.ok) {
      toast.error(salida.error ?? "No se pudo abrir el pago.");
      return;
    }
    if (salida.clientSecret && salida.publishableKey) {
      setEmbed({
        clientSecret: salida.clientSecret,
        publishableKey: salida.publishableKey,
      });
      return;
    }
    // Ruteo simulado (`payment_routing_rules` en 'simulated'): no hay Session
    // que abrir. Aquí NO se llama a `confirm_simulated_payment` a propósito —
    // sería un segundo camino de dinero escrito para un proveedor de mentira—,
    // así que se dice lo que va a pasar de verdad: la reserva caduca sola y se
    // vuelve a reservar. Antes este aviso mandaba "al checkout", que con el
    // flujo nuevo crearía una reserva DISTINTA en vez de terminar esta.
    toast.info(
      "Este cobro está ruteado al proveedor simulado y no se puede retomar. La reserva se libera sola y podrás volver a reservar el horario.",
    );
  }

  if (embed) return <StripeEmbed {...embed} />;

  return (
    <>
      <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 text-[13px] text-[#4b4b4b]">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand)]"
          checked={guardarTarjeta}
          onChange={(e) => setGuardarTarjeta(e.target.checked)}
        />
        <span>
          Guardar esta tarjeta para mis próximas reservas. Puedes quitarlas
          cuando quieras desde <strong>Métodos de pago</strong>.
        </span>
      </label>
      <Button
        disabled={busy}
        onClick={pagar}
        className="mt-3.5 h-10 rounded-[8px] px-4 text-[13.5px] font-semibold"
      >
        {busy ? "Abriendo…" : "Pagar ahora"}
      </Button>
    </>
  );
}
