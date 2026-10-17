"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const REASONS = [
  "Ya no puedo asistir a ese horario",
  "Encontré otro tutor",
  "Problemas de pago",
  "El tutor tarda en confirmar",
  "Otro",
];

// P10 · en una grupal no hay «otro tutor» que buscar ni una confirmación que
// esperar: el cupo se compra ya confirmado. Motivos propios, y el del cambio de
// fecha porque RG-11 lo convierte en una baja al 100 %.
const REASONS_GRUPAL = [
  "Ya no puedo asistir en esas fechas",
  "El tutor cambió una fecha y no me sirve",
  "El temario no es lo que esperaba",
  "Me inscribí por error",
  "Problemas de pago",
  "Otro",
];

/**
 * US-604 (SCR-AL07) — confirmar cancelación. El reembolso lo decide
 * `cancel_booking` en servidor según RN-37 (la estimación de la pantalla es
 * informativa); aquí solo se dispara y se redirige.
 *
 * El motivo se persiste en `bookings.cancel_reason` (decisión 23), y lo escribe
 * la propia RPC: el cliente no tiene UPDATE sobre `bookings` (US-1402).
 */
export function CancelForm({
  bookingId,
  grupal = false,
}: {
  bookingId: string;
  grupal?: boolean;
}) {
  const router = useRouter();
  const reasons = grupal ? REASONS_GRUPAL : REASONS;
  const [reason, setReason] = useState(reasons[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const supabase = createClient();
    // El motivo viaja compuesto: la opción elegida y, si escribió algo, su
    // detalle. Una sola columna porque el selector es una lista de producto que
    // va a cambiar, no un enum del que dependa nada.
    const detailText = detail.trim();
    const { data, error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
      p_reason: detailText ? `${reason} — ${detailText}` : reason,
    });
    if (error) {
      toast.error(error.message || "No se pudo cancelar la reserva.");
      setBusy(false);
      return;
    }
    const pct = (data as { refund_pct?: number } | null)?.refund_pct;
    toast.success(
      pct != null
        ? `Reserva cancelada. Reembolso del ${pct} %.`
        : "Reserva cancelada.",
    );
    router.push(`/reservas/${bookingId}`);
    router.refresh();
  }

  return (
    <>
      <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-6">
        <h2 className="text-base font-semibold text-[#19191f]">
          Motivo de cancelación
        </h2>
        <p className="mt-1 text-xs text-[#6b6b6b]">
          Elige un motivo para ayudarnos a mejorar.
        </p>

        <label className="mt-3.5 block text-[11px] font-semibold tracking-wide text-[#808080]">
          MOTIVO
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1.5 h-[45px] w-full rounded-[10px] border border-[#e0e0e0] bg-muted px-3.5 text-sm text-[#4d4d4d] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label className="mt-3.5 block text-[11px] font-semibold tracking-wide text-[#808080]">
          CUÉNTANOS EL MOTIVO
        </label>
        <Textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
          placeholder="Describe brevemente qué ocurrió…"
          className="mt-1.5 rounded-[10px] border-[#e0e0e0] bg-muted"
        />
      </section>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button
          className="h-[49px] rounded-[10px] bg-[#bf3333] px-6 font-semibold text-white hover:bg-[#a82c2c]"
          disabled={busy}
          onClick={confirm}
        >
          {grupal
            ? busy
              ? "Dándote de baja…"
              : "Confirmar mi baja"
            : busy
              ? "Cancelando…"
              : "Confirmar cancelación"}
        </Button>
        <Button
          variant="outline"
          className="h-[49px] rounded-[10px] px-6"
          disabled={busy}
          onClick={() => router.push(`/reservas/${bookingId}`)}
        >
          No, volver
        </Button>
      </div>
    </>
  );
}
