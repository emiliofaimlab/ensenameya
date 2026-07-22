"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * US-604 — cancelar la reserva. El reembolso lo decide `cancel_booking` en
 * servidor según RN-37; aquí solo se dispara y se refresca.
 */
export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function cancel() {
    if (!confirm("¿Seguro que quieres cancelar esta reserva?")) return;
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
    });

    if (error) {
      toast.error("No se pudo cancelar la reserva.");
      setLoading(false);
      return;
    }

    toast.success("Reserva cancelada.");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      className="w-full text-destructive hover:bg-destructive/5 hover:text-destructive"
      onClick={cancel}
      disabled={loading}
    >
      {loading ? "Cancelando…" : "Cancelar reserva"}
    </Button>
  );
}
