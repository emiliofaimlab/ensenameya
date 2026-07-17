"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

// Acciones válidas por estado (M7). La BD las vuelve a validar en manage_payout.
const ACTIONS: Record<PayoutStatus, { action: string; label: string }[]> = {
  pending: [{ action: "hold", label: "Retener" }],
  scheduled: [{ action: "hold", label: "Retener" }],
  failed: [
    { action: "retry", label: "Reintentar" },
    { action: "hold", label: "Retener" },
  ],
  on_hold: [{ action: "release", label: "Liberar" }],
  processing: [],
  paid: [],
};

export function PayoutActions({
  payoutId,
  status,
}: {
  payoutId: string;
  status: PayoutStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const actions = ACTIONS[status];
  if (actions.length === 0) return null;

  async function run(action: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("manage_payout", {
      p_payout_id: payoutId,
      p_action: action,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo actualizar el payout.");
      return;
    }
    toast.success("Payout actualizado.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={a.action}
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run(a.action)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}
