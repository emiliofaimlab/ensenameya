"use client";

import { useState } from "react";
import { toast } from "sonner";
import { VideoIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * US-1801 (RN-42) · consentimiento de grabación, ANTES de entrar a la sala.
 *
 * Sin el sí de los dos no se graba, y la sala se crea sin la opción siquiera
 * (`enable_recording`). Por eso el estado del otro se enseña: si aceptas y el
 * otro no, no pasa nada — y conviene que se vea, para no quedarte esperando una
 * grabación que nunca va a existir.
 *
 * La fila es el consentimiento: marcar inserta, desmarcar borra. Sin booleano
 * intermedio que confunda "dijo que no" con "aún no ha contestado".
 */
export function RecordingConsent({
  sessionId,
  userId,
  isTutor,
  mine,
  other,
}: {
  sessionId: string;
  userId: string;
  isTutor: boolean;
  mine: boolean;
  other: boolean;
}) {
  const [granted, setGranted] = useState(mine);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    const supabase = createClient();
    const { error } = next
      ? await supabase
          .from("session_recording_consents")
          .insert({ session_id: sessionId, user_id: userId })
      : await supabase
          .from("session_recording_consents")
          .delete()
          .eq("session_id", sessionId)
          .eq("user_id", userId);
    setBusy(false);

    if (error) {
      toast.error("No se pudo guardar tu respuesta.");
      return;
    }
    setGranted(next);
  }

  const otherLabel = isTutor ? "el alumno" : "el tutor";

  return (
    <div className="rounded-lg border p-4 text-left">
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={granted}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 rounded-[5px] border-input accent-primary"
        />
        <span>
          <span className="flex items-center gap-1.5 font-medium">
            <VideoIcon className="size-4 text-muted-foreground" />
            Acepto que esta mentoría se grabe
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {granted && other
              ? "Los dos aceptaron: la mentoría se puede grabar y estará disponible 30 días."
              : granted
                ? `Falta que ${otherLabel} acepte. Hasta entonces no se graba.`
                : other
                  ? `${otherLabel === "el alumno" ? "El alumno" : "El tutor"} ya aceptó. Sin tu permiso no se graba.`
                  : "Nadie ha aceptado todavía, así que la mentoría no se graba."}
          </span>
        </span>
      </label>
    </div>
  );
}
