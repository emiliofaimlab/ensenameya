"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/catalog/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * US-704 (SCR-AD08) — reembolso manual del admin, total o parcial. Solo se
 * ofrece si el pago está cobrado y queda algo por reembolsar. La BD revalida
 * en `refund_payment`.
 */
export function RefundForm({
  paymentId,
  currency,
  remaining,
}: {
  paymentId: string;
  currency: string;
  remaining: number; // unidades menores por reembolsar
}) {
  const router = useRouter();
  // Importe en la moneda del usuario (p. ej. "18.00") → unidades menores al enviar.
  const [value, setValue] = useState((remaining / 100).toFixed(2));
  const [busy, setBusy] = useState(false);

  if (remaining <= 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Este pago ya está reembolsado por completo.
      </p>
    );
  }

  async function refund() {
    const minor = Math.round(Number(value) * 100);
    if (!Number.isFinite(minor) || minor <= 0 || minor > remaining) {
      toast.error(`Importe entre 0,01 y ${formatMoney(remaining, currency)}.`);
      return;
    }
    if (
      !window.confirm(
        `¿Reembolsar ${formatMoney(minor, currency)} al alumno? Es una acción financiera.`,
      )
    )
      return;

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("refund_payment", {
      p_payment_id: paymentId,
      p_amount: minor,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo reembolsar.");
      return;
    }
    const res = data as { status: string; clawback_needed: boolean };
    toast.success(
      res.clawback_needed
        ? "Reembolsado. ⚠️ El payout ya estaba pagado: requiere clawback manual al tutor."
        : "Reembolso procesado.",
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Reembolsar</h2>
      <p className="text-sm text-muted-foreground">
        Queda por reembolsar {formatMoney(remaining, currency)}. Un reembolso
        total marca la reserva como reembolsada y revierte el payout si aún no se
        liquidó.
      </p>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refund-amount">Importe ({currency})</Label>
          <Input
            id="refund-amount"
            type="number"
            min="0.01"
            step="0.01"
            className="w-40"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button variant="destructive" disabled={busy} onClick={refund}>
          {busy ? "Procesando…" : "Reembolsar"}
        </Button>
      </div>
    </div>
  );
}
