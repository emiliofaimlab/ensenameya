"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * US-606 (SCR-TU07b) — Aceptar naranja 102×43 / Rechazar outline (200:62).
 * `respond_booking` agenda las sesiones al aceptar y reembolsa al rechazar.
 */
export function AcceptRejectButtons({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function respond(accept: boolean) {
    if (
      !accept &&
      !window.confirm("¿Rechazar la reserva? Se reembolsa el 100 % al alumno.")
    ) {
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("respond_booking", {
      p_booking_id: bookingId,
      p_accept: accept,
    });
    setBusy(false);
    if (error)
      return toast.error(error.message || "No se pudo actualizar la reserva.");
    toast.success(accept ? "Reserva confirmada." : "Reserva rechazada y reembolsada.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        disabled={busy}
        onClick={() => respond(true)}
        className="h-[43px] rounded-[8px] px-6 font-semibold"
      >
        Aceptar
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => respond(false)}
        className="h-[43px] rounded-[8px] px-6 text-[#4d4d4d]"
      >
        Rechazar
      </Button>
    </div>
  );
}

/** US-802 (SCR-TU08) — cierre anticipado de la sesión por el tutor (S-26). */
export function CompleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function complete() {
    if (!window.confirm("¿Marcar esta sesión como completada?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_session", {
      p_session_id: sessionId,
    });
    setBusy(false);
    if (error)
      return toast.error(error.message || "No se pudo completar la sesión.");
    toast.success("Sesión marcada como completada.");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={complete}
      className="h-[43px] rounded-[8px] px-4 text-sm text-[#4d4d4d]"
    >
      {busy ? "Guardando…" : "Marcar completada"}
    </Button>
  );
}

/** US-604 — cancelar como tutor (reembolso 100 % al alumno, RN-37). */
export function TutorCancelButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (
      !window.confirm(
        "¿Cancelar la reserva? Al cancelar tú, el alumno recibe el 100 % de reembolso.",
      )
    ) {
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
    });
    setBusy(false);
    if (error)
      return toast.error(error.message || "No se pudo cancelar la reserva.");
    toast.success("Reserva cancelada. El alumno recibe el 100 %.");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={cancel}
      className="h-[43px] rounded-[8px] px-4 text-sm text-[#4d4d4d]"
    >
      Cancelar
    </Button>
  );
}
