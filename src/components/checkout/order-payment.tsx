"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";
import { HoldCountdown } from "@/components/checkout/hold-countdown";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/catalog/format";
import { rpcDePedidos } from "@/lib/orders/tipos";

/** Igual que en el checkout de una reserva: primero se abre el cobro, luego se pinta. */
type Apertura =
  | { fase: "abriendo" }
  | { fase: "error"; mensaje: string }
  | { fase: "simulado"; retencionHasta: string | null }
  | { fase: "lista"; retencionHasta: string | null; embed: Embed };

/**
 * EY-176 · EL PAGO DE UN PEDIDO — un cobro, N mentorías (P-3).
 *
 * ⚠️ NO CREA NADA. Las N reservas y la cabecera del pedido ya existen: las creó
 * `create_order` desde `/api/pedidos` cuando la persona pulsó «Ir al pago» en
 * el carrito, todas en una transacción (P-1). Esta pantalla solo abre el cobro,
 * igual que `resume-payment.tsx` con una reserva a medias. Llamar aquí a
 * `create_order` sería el duplicado que `find_open_order` existe para evitar.
 *
 * ⚠️ EL RELOJ ES UNO PARA TODO EL PEDIDO, y eso es P-2. Las N reservas nacieron
 * en la misma transacción, así que comparten `created_at` y
 * `expire_stale_bookings` las vence juntas en una sola pasada: un contador, no
 * N. Es exactamente por eso que se descartó que el carrito retuviera el horario
 * al añadir — con 7 minutos por línea, la primera mentoría caducaría mientras
 * se elige la segunda.
 *
 * ⚠️ Y EL IMPORTE NO SALE DE AQUÍ. `total` es solo lo que se pinta, y viene del
 * servidor sumando `payments.gross_amount` de cada línea; lo que se cobra lo
 * compone `/api/pagos/checkout` leyendo esos mismos snapshots (regla de oro 2).
 * Este componente no suma nada.
 */
export function OrderPayment({
  orderId,
  total,
  currency,
}: {
  orderId: string;
  /** Solo para el botón del camino simulado. El cobro real no lo mira. */
  total: number;
  currency: string;
}) {
  const router = useRouter();
  const [apertura, setApertura] = useState<Apertura>({ fase: "abriendo" });
  const [pagando, setPagando] = useState(false);
  // Qué pedido se abrió ya. Con la clave dentro y no un booleano, StrictMode no
  // abre dos veces y una navegación a OTRO pedido sí vuelve a abrir.
  const abiertoPara = useRef<string | null>(null);

  useEffect(() => {
    if (abiertoPara.current === orderId) return;
    abiertoPara.current = orderId;

    async function abrir() {
      setApertura({ fase: "abriendo" });
      const res = await fetch("/api/pagos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ⚠️ `orderId`, no `bookingId`: el Route Handler los trata como
        // excluyentes y de esa distinción depende que el webhook acredite las N
        // líneas y no una.
        body: JSON.stringify({ orderId }),
      });
      const salida = (await res.json().catch(() => ({}))) as Partial<Embed> & {
        simulated?: boolean;
        retencionHasta?: string | null;
        error?: string;
      };

      if (!res.ok) {
        setApertura({
          fase: "error",
          mensaje: salida.error ?? "No se pudo abrir el pago del pedido.",
        });
        return;
      }
      if (salida.clientSecret && salida.publishableKey) {
        setApertura({
          fase: "lista",
          retencionHasta: salida.retencionHasta ?? null,
          embed: {
            clientSecret: salida.clientSecret,
            publishableKey: salida.publishableKey,
          },
        });
        return;
      }
      setApertura({
        fase: "simulado",
        retencionHasta: salida.retencionHasta ?? null,
      });
    }

    void abrir();
  }, [orderId]);

  /**
   * Camino simulado (`payment_routing_rules` todavía en 'simulated', que es el
   * estado de HOY). No hay Session que abrir y lo cierra el propio navegador.
   *
   * ⚠️ `confirm_simulated_order_payment` Y NO N LLAMADAS A
   * `confirm_simulated_payment`. Confirmar línea a línea desde aquí produce
   * exactamente el estado medio pagado que toda esta ficha existe para impedir,
   * solo que sin Stripe delante: si la pestaña se cierra a mitad, quedan dos
   * mentorías compradas y una muriendo. La RPC del pedido las hace todas en una
   * transacción, y exige ser dueño **y** que el pedido esté ruteado al
   * proveedor simulado — el día que se encienda Stripe este botón deja de
   * funcionar solo, que es lo que debe pasar.
   */
  async function confirmarSimulado(exito: boolean) {
    setPagando(true);
    const { error } = await rpcDePedidos(createClient()).rpc(
      "confirm_simulated_order_payment",
      { p_order_id: orderId, p_success: exito },
    );
    if (error) {
      toast.error(error.message ?? "No se pudo procesar el pago.");
      setPagando(false);
      return;
    }
    if (!exito) {
      toast.error("El pago no se completó. Se liberaron los horarios.");
      setPagando(false);
      return;
    }
    router.push(`/pedidos/${orderId}/confirmacion`);
  }

  return (
    <>
      {apertura.fase !== "abriendo" && apertura.fase !== "error" ? (
        <HoldCountdown hasta={apertura.retencionHasta} className="mt-3.5" />
      ) : null}

      {apertura.fase === "abriendo" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]" aria-live="polite">
          Preparando tu pago seguro…
        </p>
      ) : null}

      {apertura.fase === "error" ? (
        <p role="alert" className="mt-3.5 text-[13px] text-destructive">
          {apertura.mensaje}
        </p>
      ) : null}

      {apertura.fase === "lista" ? (
        <div className="mt-3.5">
          {/* La casilla de «guardar esta tarjeta» la pinta Stripe dentro de
              este formulario (D-3), igual que en el checkout de una reserva. */}
          <StripeEmbed {...apertura.embed} />
        </div>
      ) : null}

      {apertura.fase === "simulado" ? (
        <>
          <p className="mt-4 rounded-lg bg-warning-muted px-4 py-3 text-[13px] text-warning">
            Entorno de pruebas: el cobro está simulado, no se mueve dinero real.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              className="h-[49px] rounded-[10px] px-6 font-semibold"
              disabled={pagando}
              onClick={() => confirmarSimulado(true)}
            >
              {pagando ? "Procesando…" : `Confirmar pago · ${formatMoney(total, currency)}`}
            </Button>
            <Button
              variant="outline"
              className="h-[49px] rounded-[10px] px-6"
              disabled={pagando}
              onClick={() => confirmarSimulado(false)}
            >
              Simular fallo
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
