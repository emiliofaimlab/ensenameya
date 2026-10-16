"use client";

import { useState } from "react";
import { TimerIcon } from "lucide-react";
import { toast } from "sonner";

import { AVISO_MIN_ANTES_DEL_FIN } from "@/components/sala/contador-clase";

/**
 * EY-232 · «Extender 5 min», solo para el tutor y una sola vez. Aparece cuando
 * el contador pasa a aviso (a 5 min del fin) y sigue hasta que se cierra la
 * sala. Gratis para el alumno: no toca la reserva. El nuevo fin les llega a
 * los dos por Realtime (`live-room.tsx`); esto solo lo adelanta para quien
 * pulsa.
 */
export function ExtenderClase({
  sessionId,
  now,
  endAt,
  closesAt,
  onExtendida,
}: {
  sessionId: string;
  now: number;
  endAt: string;
  closesAt: string;
  onExtendida: (endsAt: string, closesAt: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const desde = Date.parse(endAt) - AVISO_MIN_ANTES_DEL_FIN * 60_000;
  if (now < desde || now >= Date.parse(closesAt)) return null;

  async function extender() {
    setBusy(true);
    const res = await fetch(`/api/room/${sessionId}/extender`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      endsAt?: string;
      closesAt?: string;
    };
    setBusy(false);
    if (!res.ok || !body.endsAt || !body.closesAt) {
      toast.error(body.error ?? "No se pudo extender la clase.");
      return;
    }
    toast.success("La clase se extendió 5 minutos. No tiene costo para el alumno.");
    onExtendida(body.endsAt, body.closesAt);
  }

  return (
    <button
      type="button"
      onClick={extender}
      disabled={busy}
      className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-semibold text-[#19191f] shadow disabled:opacity-60"
    >
      <TimerIcon className="size-3.5" aria-hidden />
      {busy ? "Extendiendo…" : "Extender 5 min"}
    </button>
  );
}
