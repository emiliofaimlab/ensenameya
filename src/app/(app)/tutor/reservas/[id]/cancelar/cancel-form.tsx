"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Motivos del lado TUTOR. No son los del alumno: "encontré otro tutor" no
 * significa nada aquí. Es una lista de producto, no un enum de BD — el motivo
 * viaja como texto a `bookings.cancel_reason` (decisión 23) y cambiarla no
 * rompe nada.
 */
const REASONS = [
  "Me surgió un imprevisto",
  "Ya no puedo en ese horario",
  "El alumno me pidió cancelarla",
  "No es el nivel o el tema que enseño",
  "Problemas técnicos por mi parte",
  "Otro",
];

/**
 * P10/M1 · sacar a un alumno de una grupal no es cancelar una clase propia:
 * «ya no puedo en ese horario» tiraría la clase entera, no un cupo.
 */
const REASONS_GRUPAL = [
  "El alumno me pidió salir de la clase",
  "No tiene el nivel que pide la clase",
  "Comportamiento inadecuado con el grupo",
  "Se inscribió por error",
  "Otro",
];

/**
 * N-34 · confirmación de la cancelación del tutor.
 *
 * El reembolso lo decide `cancel_booking` en servidor (RN-37: cancela el tutor
 * → 100 %); lo que pinta la pantalla es informativo. El motivo lo escribe la
 * propia RPC porque el cliente no tiene UPDATE sobre `bookings` (US-1402).
 *
 * El botón destructivo NO es el que queda a mano: "No, volver" va primero en el
 * orden de foco y "Confirmar" pide antes elegir un motivo. Es el sustituto
 * deliberado del `confirm()`, que se despachaba con un Intro.
 */
export function TutorCancelForm({
  bookingId,
  grupal = false,
}: {
  bookingId: string;
  /** M1 · sacar a un alumno de una clase grupal, no cancelar una 1:1. */
  grupal?: boolean;
}) {
  const router = useRouter();
  const reasons = grupal ? REASONS_GRUPAL : REASONS;
  // Sin preselección a propósito: con un motivo ya elegido, confirmar es un
  // solo clic y volvemos a tener el problema que quitamos.
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!reason)
      return toast.error(
        grupal ? "Elige el motivo." : "Elige el motivo de la cancelación.",
      );

    setBusy(true);
    const supabase = createClient();
    // El motivo viaja compuesto: la opción elegida y, si escribió algo, su
    // detalle. Una sola columna, igual que en la pantalla del alumno.
    const detailText = detail.trim();
    const { data, error } = await supabase.rpc("cancel_booking", {
      p_booking_id: bookingId,
      p_reason: detailText ? `${reason} — ${detailText}` : reason,
    });
    if (error) {
      toast.error(
        error.message ||
          (grupal
            ? "No se pudo sacar al alumno de la clase."
            : "No se pudo cancelar la reserva."),
      );
      setBusy(false);
      return;
    }
    const res = data as { refund_pct?: number; tramos?: boolean } | null;
    const pct = res?.refund_pct;
    toast.success(
      grupal
        ? res?.tramos
          ? "Listo: el alumno queda fuera de las fechas que faltan y se le devuelve esa parte."
          : "Listo: el alumno deja la clase y se le devuelve el 100 %."
        : pct != null
          ? `Reserva cancelada. Se reembolsa el ${pct} % al alumno.`
          : "Reserva cancelada.",
    );
    router.push(`/tutor/reservas/${bookingId}`);
    router.refresh();
  }

  return (
    <>
      <section className="rounded-[16px] border border-[#e0e0e0] bg-card p-5">
        <h2 className="text-base font-semibold text-[#19191f]">
          {grupal ? "Por qué lo sacas de la clase" : "Motivo de la cancelación"}
        </h2>
        <p className="mt-1 text-xs text-[#6b6b6b]">
          {grupal
            ? "Tu alumno lo verá en el correo que le avisa, junto con lo que escribas abajo."
            : "Queda registrado en la reserva. Ayuda al equipo a entender qué está fallando y, si el alumno reclama, es lo que se consulta."}
        </p>

        <label
          htmlFor="motivo"
          className="mt-3.5 block text-[11px] font-semibold tracking-wide text-[#808080]"
        >
          MOTIVO
        </label>
        <select
          id="motivo"
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1.5 h-[45px] w-full rounded-[10px] border border-[#e0e0e0] bg-muted px-3.5 text-sm text-[#4d4d4d] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Elige un motivo…</option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label
          htmlFor="detalle"
          className="mt-3.5 block text-[11px] font-semibold tracking-wide text-[#808080]"
        >
          CUÉNTANOS QUÉ PASÓ (OPCIONAL)
        </label>
        <Textarea
          id="detalle"
          value={detail}
          disabled={busy}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
          placeholder="Describe brevemente qué ocurrió…"
          className="mt-1.5 rounded-[10px] border-[#e0e0e0] bg-muted"
        />
      </section>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="h-[49px] rounded-[10px] px-6"
          disabled={busy}
          onClick={() => router.push(`/tutor/reservas/${bookingId}`)}
        >
          No, volver
        </Button>
        <Button
          className="h-[49px] rounded-[10px] bg-[#bf3333] px-6 font-semibold text-white hover:bg-[#a82c2c]"
          disabled={busy || !reason}
          onClick={confirm}
        >
          {busy
            ? grupal
              ? "Sacando…"
              : "Cancelando…"
            : grupal
              ? "Sí, sacarlo de la clase"
              : "Sí, cancelar la reserva"}
        </Button>
      </div>
    </>
  );
}
