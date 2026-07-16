"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** US-1004 (RN-40) — retiro self-service del saldo disponible. */
export function WithdrawButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    if (!window.confirm("¿Retirar tu saldo disponible? Se programará la liquidación.")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("request_withdrawal", {});
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo procesar el retiro.");
      return;
    }
    toast.success("Retiro solicitado. La liquidación quedó programada.");
    router.refresh();
  }

  return (
    <Button
      className="self-start"
      disabled={disabled || busy}
      title={disabled ? "No tienes saldo disponible para retirar" : undefined}
      onClick={withdraw}
    >
      {busy ? "Procesando…" : "Retirar saldo disponible"}
    </Button>
  );
}
