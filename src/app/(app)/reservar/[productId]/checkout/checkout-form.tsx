"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LockIcon, ShieldCheckIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/catalog/format";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";

const slotLabel = (iso: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

type State = "idle" | "processing";

/**
 * US-602 (SCR-AL05) — checkout con PSP **simulado** (C-01). "Confirmar pago"
 * crea la reserva (create_booking) y dispara el pago simulado
 * (confirm_simulated_payment) → `pending_acceptance`, y redirige a la
 * confirmación (AL06). Todo el dinero lo mueven las RPC server-side.
 *
 * El nombre de la RPC no es cosmético: `confirm_payment` está revocada para el
 * cliente y solo la alcanza el webhook (`20260806120000`). Esta variante exige
 * que el cobro esté ruteado al proveedor simulado, así que el día que entre un
 * PSP real este botón deja de funcionar solo — que es lo que debe pasar.
 *
 * ⚠️ SIN campos de tarjeta, a propósito. El Figma dibuja aquí número de
 * tarjeta, titular, vencimiento y CVC en campos propios; capturar el PAN en
 * nuestro formulario metería el proyecto en PCI-DSS SAQ D (alcance completo)
 * en vez del SAQ A que da un checkout alojado. Además contradice el plan ya
 * aprobado: PAC-01 (EY-93) es "checkout ALOJADO real" y PAC-02 (EY-94)
 * tokenización en el PSP. Cuando EP-20 se desbloquee, en el hueco de abajo va
 * el redirect al checkout del proveedor o su iframe/Elements — nunca inputs
 * nuestros. La tarjeta ilustrada de la izquierda es decorativa (no captura nada).
 */
export function CheckoutForm({
  productId,
  slots,
  total,
  currency,
  productTitle,
  tutorName,
  packageLabel,
  simulado,
}: {
  productId: string;
  slots: string[];
  total: number;
  currency: string;
  productTitle: string;
  tutorName: string;
  packageLabel: string;
  /** Lo decide `payment_routing_rules`, no el código: con un proveedor real no
   *  hay aviso de pruebas ni botón de simular fallo. */
  simulado: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  // DESMARCADA a propósito: guardar un medio de pago se pide, no se presupone.
  const [guardarTarjeta, setGuardarTarjeta] = useState(false);

  async function pay(success: boolean) {
    setState("processing");
    const supabase = createClient();

    const { data: bookingId, error } = await supabase.rpc("create_booking", {
      p_product_id: productId,
      p_slots: slots,
    });
    if (error || !bookingId) {
      toast.error(error?.message ?? "No se pudo crear la reserva.");
      setState("idle");
      return;
    }

    // Quién cobra lo decide el servidor leyendo `payments.provider`, que es el
    // snapshot que `create_booking` acaba de congelar desde
    // `payment_routing_rules`. El navegador no elige proveedor: pregunta.
    const res = await fetch("/api/pagos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, guardarTarjeta }),
    });
    const salida = (await res.json().catch(() => ({}))) as {
      url?: string;
      simulated?: boolean;
      error?: string;
    };

    if (!res.ok) {
      toast.error(salida.error ?? "No se pudo abrir el pago.");
      setState("idle");
      return;
    }

    if (salida.url) {
      // Checkout alojado: dominio de Stripe, no es navegación interna. Con
      // `router.push` el App Router intentaría resolverlo como ruta propia.
      // A partir de aquí el cobro lo confirma el webhook, no esta pantalla.
      window.location.assign(salida.url);
      return;
    }

    // Camino simulado (`payment_routing_rules` aún en 'simulated'): sigue
    // funcionando igual que siempre, incluido el botón de simular fallo.
    const { error: payErr } = await supabase.rpc("confirm_simulated_payment", {
      p_booking_id: bookingId,
      p_success: success,
    });
    if (payErr) {
      toast.error(payErr.message ?? "No se pudo procesar el pago.");
      setState("idle");
      return;
    }

    if (!success) {
      toast.error("El pago no se completó. Se liberó el horario.");
      setState("idle");
      return;
    }
    // AL06 — confirmación como página propia.
    router.push(`/reservas/${bookingId}/confirmacion`);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* Columna izquierda del Figma: tarjeta ilustrada + resumen. */}
      <div className="flex flex-col gap-5">
        <div className="rounded-[20px] bg-linear-to-br from-[#191925] to-[#054a94] p-6 text-white">
          <div className="flex items-center justify-between">
            <span className="h-7 w-9 rounded-[6px] bg-[#facc66]" />
            <span className="text-xs font-semibold tracking-wide">
              ENSÉÑAME YA
            </span>
          </div>
          <p className="mt-9 text-xl font-medium tracking-[0.15em]">
            •••• •••• •••• 4821
          </p>
          <div className="mt-5 flex justify-between text-[13px]">
            <span>
              <span className="block text-[9px] tracking-wide opacity-70">
                TITULAR
              </span>
              <span className="font-semibold">NOMBRE APELLIDO</span>
            </span>
            <span>
              <span className="block text-[9px] tracking-wide opacity-70">
                VENCE
              </span>
              <span className="font-semibold">MM/AA</span>
            </span>
          </div>
        </div>

        <PanelCard>
          <PanelCardTitle className="text-[15px]">
            Resumen del pedido
          </PanelCardTitle>
          <div className="mt-3.5">
            <p className="text-sm font-medium text-[#19191f]">{productTitle}</p>
            <p className="text-xs text-[#6b6b6b]">
              con {tutorName} · {packageLabel}
            </p>
          </div>
          <ul className="mt-3.5 flex flex-col gap-1 border-t border-[#e0e0e0] pt-3.5 text-xs text-[#6b6b6b]">
            {slots.map((iso) => (
              <li key={iso} className="first-letter:uppercase">
                {slotLabel(iso)}
              </li>
            ))}
          </ul>
          <div className="mt-3.5 flex items-center justify-between border-t border-[#e0e0e0] pt-3.5 text-[13px]">
            <span className="text-[#6b6b6b]">Subtotal</span>
            <span className="text-[#333333]">{formatMoney(total, currency)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-semibold text-[#19191f]">Total</span>
            <span className="text-lg font-bold text-brand">
              {formatMoney(total, currency)}
            </span>
          </div>
          <p className="mt-3.5 flex gap-2 text-[11px] text-[#6b6b6b]">
            <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-success" />
            <span>
              Reembolso del {P.refundPct.studentEarly} % si el tutor no acepta en{" "}
              {P.cutoffHours} h (RN-27/37).
            </span>
          </p>
        </PanelCard>
      </div>

      {/* Columna derecha: pasarela alojada (sin PAN nuestro). */}
      <PanelCard>
        <PanelCardTitle className="text-[15px]">Método de pago</PanelCardTitle>

        <div className="mt-3.5 flex gap-3 rounded-xl border border-dashed border-[#e0e0e0] p-5">
          <LockIcon className="mt-0.5 size-5 shrink-0 text-[#6b6b6b]" />
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              El pago se completa en la pasarela del proveedor
            </p>
            <p className="mt-1 text-[13px] text-[#6b6b6b]">
              Nunca escribes los datos de tu tarjeta en Enséñame Ya: al confirmar
              te llevamos al checkout seguro del proveedor de pagos.
            </p>
          </div>
        </div>

        {/* El aviso solo cuando el cobro ES simulado. Dejarlo fijo fue un bug
            real: al encender Stripe, la pantalla seguía diciendo que no se movía
            dinero mientras el botón llevaba a una pasarela de verdad. */}
        {simulado ? (
          <p className="mt-4 rounded-lg bg-warning-muted px-4 py-3 text-[13px] text-warning">
            Entorno de pruebas: el cobro está simulado, no se mueve dinero real.
          </p>
        ) : null}

        {/* Consentimiento explícito para el card-on-file (PAC-02). Va aquí y no
            en la pasarela para que se lea en nuestro idioma y ANTES de salir del
            sitio. Se traduce en `setup_future_usage` solo si está marcada. */}
        {simulado ? null : (
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] text-[#4b4b4b]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand)]"
              checked={guardarTarjeta}
              onChange={(e) => setGuardarTarjeta(e.target.checked)}
            />
            <span>
              Guardar esta tarjeta para mis próximas reservas. Puedes quitarla
              cuando quieras desde <strong>Métodos de pago</strong>.
            </span>
          </label>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            className="h-[49px] rounded-[10px] px-6 font-semibold"
            disabled={state === "processing"}
            onClick={() => pay(true)}
          >
            {state === "processing"
              ? "Procesando…"
              : simulado
                ? `Confirmar pago · ${formatMoney(total, currency)}`
                : `Ir a pagar · ${formatMoney(total, currency)}`}
          </Button>
          {/* Simular fallo solo tiene sentido con el proveedor simulado: con
              Stripe el rechazo lo decide la pasarela, y este botón acabaría
              llevando al mismo checkout real. */}
          {simulado ? (
            <Button
              variant="outline"
              className="h-[49px] rounded-[10px] px-6"
              disabled={state === "processing"}
              onClick={() => pay(false)}
            >
              Simular fallo
            </Button>
          ) : null}
        </div>
      </PanelCard>
    </div>
  );
}
