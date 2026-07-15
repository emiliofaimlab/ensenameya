"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/catalog/format";
import { CANCELLATION_POLICY } from "@/lib/policy";
import { Button } from "@/components/ui/button";

const slotLabel = (iso: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

type State = "idle" | "processing" | "paid" | "failed";

/**
 * US-602 (SCR-AL05) — checkout con PSP **simulado** (C-01). "Pagar" crea la
 * reserva (create_booking) y dispara el pago simulado (confirm_payment) →
 * `pending_acceptance`. Todo el dinero lo mueven las RPC server-side.
 */
export function CheckoutForm({
  productId,
  slots,
  total,
  currency,
}: {
  productId: string;
  slots: string[];
  total: number;
  currency: string;
}) {
  const [state, setState] = useState<State>("idle");

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

    const { error: payErr } = await supabase.rpc("confirm_payment", {
      p_booking_id: bookingId,
      p_success: success,
    });
    if (payErr) {
      toast.error(payErr.message ?? "No se pudo procesar el pago.");
      setState("idle");
      return;
    }
    setState(success ? "paid" : "failed");
  }

  if (state === "paid") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          ¡Pago recibido!
        </p>
        <p className="text-sm text-muted-foreground">
          Tu reserva quedó pendiente de que el tutor la acepte (hasta 24 h). Te
          avisaremos; si no responde, se reembolsa el 100 %.
        </p>
        <Button asChild className="w-fit">
          <Link href="/reservas">Ver mis reservas</Link>
        </Button>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <p className="font-medium text-destructive">El pago no se completó</p>
        <p className="text-sm text-muted-foreground">
          Se liberó el horario. Puedes intentarlo de nuevo.
        </p>
        <Button variant="outline" className="w-fit" onClick={() => setState("idle")}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-sm font-medium">
          {slots.length > 1 ? `${slots.length} sesiones` : "Tu sesión"}
        </h2>
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {slots.map((iso) => (
            <li key={iso} className="first-letter:uppercase">
              {slotLabel(iso)}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="font-medium">Total</span>
          <span className="font-semibold">{formatMoney(total, currency)}</span>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Pago simulado (aún sin proveedor real). Cancelación: ≥
        {CANCELLATION_POLICY.cutoffHours} h ={" "}
        {CANCELLATION_POLICY.refundPct.studentEarly} %, &lt;
        {CANCELLATION_POLICY.cutoffHours} h ={" "}
        {CANCELLATION_POLICY.refundPct.studentLate} %.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={state === "processing"} onClick={() => pay(true)}>
          {state === "processing" ? "Procesando…" : `Pagar ${formatMoney(total, currency)}`}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={state === "processing"}
          onClick={() => pay(false)}
        >
          Simular fallo
        </Button>
      </div>
    </div>
  );
}
