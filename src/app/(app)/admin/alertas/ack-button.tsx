"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * AD14 · "Marcar atendida" (decisión 29). Escribe el acuse en `alert_acks`.
 *
 * Sin RPC: no se mueve dinero ni roles, así que basta la RLS de admin (mismo
 * criterio que las categorías de US-1102). Deshacer borra la fila — un acuse no
 * se edita.
 */
export function AckButton({
  kind,
  entityId,
  acked,
}: {
  kind: "pago" | "payout" | "cancelacion";
  entityId: string;
  acked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const supabase = createClient();
    const { error } = acked
      ? await supabase
          .from("alert_acks")
          .delete()
          .eq("kind", kind)
          .eq("entity_id", entityId)
      : await supabase.from("alert_acks").insert({
          kind,
          entity_id: entityId,
          acked_by: (await supabase.auth.getUser()).data.user?.id ?? "",
        });

    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo actualizar la alerta.");
      return;
    }
    toast.success(acked ? "Alerta reabierta." : "Alerta marcada como atendida.");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
      disabled={busy}
      onClick={toggle}
    >
      {acked ? "Reabrir" : "Marcar atendida"}
    </Button>
  );
}
