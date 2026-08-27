"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * N-34 · confirmación en un diálogo de la app, no en `window.confirm()`.
 *
 * El nativo tiene una trampa que no se ve venir: tras varios seguidos en la
 * misma pestaña, el navegador ofrece «impedir que esta página cree más
 * diálogos» y desde ese momento `confirm()` devuelve false SIN preguntar. La
 * acción se abandona en silencio y el tutor jura que la confirmó. En una
 * reserva `pending_acceptance` eso no se queda en nada: vence el plazo de 24 h
 * (RN-38) y el job la cancela y reembolsa. Visto desde fuera, «se canceló
 * sola».
 *
 * Las cancelaciones de reserva no usan esto sino pantalla propia
 * (`/tutor/reservas/[id]/cancelar`), como el alumno: ahí hay importe, política
 * y motivo que enseñar, y no caben en un modal.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel,
  destructive,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  destructive?: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            No, volver
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            className={
              destructive
                ? "bg-[#bf3333] font-semibold text-white hover:bg-[#a82c2c]"
                : undefined
            }
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * US-606 (SCR-TU07b) — Aceptar naranja 102×43 / Rechazar outline (200:62).
 * `respond_booking` agenda las sesiones al aceptar y reembolsa al rechazar.
 *
 * Aceptar no pregunta (es la acción esperada y se puede cancelar después);
 * rechazar sí, porque devuelve el 100 % y no tiene vuelta atrás.
 */
export function AcceptRejectButtons({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function respond(accept: boolean) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("respond_booking", {
      p_booking_id: bookingId,
      p_accept: accept,
    });
    setBusy(false);
    if (error)
      return toast.error(error.message || "No se pudo actualizar la reserva.");
    setConfirming(false);
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
        onClick={() => setConfirming(true)}
        className="h-[43px] rounded-[8px] px-6 text-[#4d4d4d]"
      >
        Rechazar
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Rechazar esta reserva?"
        description="El alumno recibe el 100 % de lo que pagó y las sesiones agendadas se liberan. No podrás volver a aceptarla: tendría que reservarla otra vez."
        confirmLabel="Sí, rechazar"
        busyLabel="Rechazando…"
        destructive
        busy={busy}
        onConfirm={() => respond(false)}
      />
    </div>
  );
}

/** US-802 (SCR-TU08) — cierre anticipado de la sesión por el tutor (S-26). */
export function CompleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function complete() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_session", {
      p_session_id: sessionId,
    });
    setBusy(false);
    if (error)
      return toast.error(error.message || "No se pudo completar la sesión.");
    setConfirming(false);
    toast.success("Sesión marcada como completada.");
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => setConfirming(true)}
        className="h-[43px] rounded-[8px] px-4 text-sm text-[#4d4d4d]"
      >
        {busy ? "Guardando…" : "Marcar completada"}
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Marcar la sesión como completada?"
        description="La mentoría queda como dictada y se cierra su sala. Cuando a la reserva no le queden sesiones abiertas pasará a completada: es eso lo que arranca la retención de tu pago y la invitación al alumno para que te reseñe. No se puede reabrir."
        confirmLabel="Sí, completar"
        busyLabel="Guardando…"
        busy={busy}
        onConfirm={complete}
      />
    </>
  );
}
