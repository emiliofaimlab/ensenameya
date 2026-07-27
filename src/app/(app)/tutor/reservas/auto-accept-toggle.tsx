"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PanelCard } from "@/components/layout/panel-shell";

/**
 * R24-19 — preferencia de auto-aceptar. Con el switch activo, una reserva
 * pagada se confirma sola (lo aplica `confirm_payment`), sin esperar a que el
 * tutor la acepte a mano. Escribe `tutor_profiles.auto_accept_bookings` (RLS +
 * column-grant: el tutor solo toca su propia fila).
 */
export function AutoAcceptToggle({
  userId,
  initial,
}: {
  userId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    setOn(next); // optimista: el switch responde al instante
    const supabase = createClient();
    const { error } = await supabase
      .from("tutor_profiles")
      .update({ auto_accept_bookings: next })
      .eq("profile_id", userId);
    setBusy(false);
    if (error) {
      setOn(!next); // revierte si falló
      toast.error("No se pudo cambiar la preferencia.");
      return;
    }
    toast.success(next ? "Auto-aceptar activado." : "Auto-aceptar desactivado.");
    router.refresh();
  }

  return (
    <PanelCard className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-[#19191f]">
          Aceptar reservas automáticamente
        </p>
        <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
          Las reservas pagadas se confirman solas, sin esperar tu aceptación.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Aceptar reservas automáticamente"
        disabled={busy}
        onClick={toggle}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          on ? "bg-brand" : "bg-[#d1d1d1]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
            on && "translate-x-5",
          )}
        />
      </button>
    </PanelCard>
  );
}
