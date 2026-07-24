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

/**
 * US-604 (SCR-AL07) — confirmar cancelación. El reembolso lo decide
 * `cancel_booking` en servidor según RN-37 (la estimación de la pantalla es
 * informativa); aquí solo se dispara y se redirige.
 *
 * ⚠️ El motivo NO se persiste: `bookings` no tiene columna para él (hueco de
 * EP-23). Se captura para no perder el paso de UX del Figma, pero hasta que
 * exista la columna no viaja a la BD. Sin inventar dónde guardarlo.
 */
export function CancelForm({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
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
          {REASONS.map((r) => (
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
          {busy ? "Cancelando…" : "Confirmar cancelación"}
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
