"use client";

import { useState } from "react";
import { toast } from "sonner";
import { VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SessionRef } from "./session-ref";

type Result =
  | { status: "ready"; url: string; durationSecs: number; expiresAt: string }
  | { status: "none" | "unavailable" | "expired" };

/**
 * US-1802 · "Ver grabación" de una sesión completada.
 *
 * El enlace se pide al hacer clic, no al pintar la página: lo firma Daily y
 * caduca, así que guardarlo en el HTML sería repartir un enlace muerto (o vivo
 * de más). Mismo criterio que los adjuntos del chat.
 *
 * N-27 · lleva pegado el "N.º de sesión" cuando quien lo pinta se lo pasa. Es
 * el sitio donde más falta hace: una grabación se reclama por teléfono o por
 * correo ("la de la sesión 7K3M9Q-2"), y el uuid de la URL no sirve para eso.
 */
export function RecordingLink({
  sessionId,
  nroSesion,
}: {
  sessionId: string;
  /** `sessions.session_ref`. Opcional: sin él solo se pinta el botón. */
  nroSesion?: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    // La pestaña se abre YA, con el gesto del usuario: para cuando llega la
    // respuesta firmada el clic ya no cuenta y el navegador la bloquearía.
    const w = window.open("", "_blank");
    if (w) w.opener = null;

    setBusy(true);
    const res = await fetch(`/api/recordings/${sessionId}`);
    const data = (await res.json()) as Result;
    setBusy(false);

    if (data.status === "ready") {
      if (w) w.location.replace(data.url);
      else window.location.href = data.url;
      return;
    }

    w?.close();
    toast.info(
      data.status === "expired"
        ? "La grabación ya caducó: se guarda 30 días desde la mentoría."
        : data.status === "none"
          ? "Esta mentoría no se grabó."
          : "La grabación no está disponible todavía.",
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="outline"
        className="h-9 rounded-[8px] px-3.5 text-[13px]"
        disabled={busy}
        onClick={open}
      >
        <VideoIcon className="size-4" />
        {busy ? "Buscando…" : "Ver grabación"}
      </Button>
      <SessionRef nro={nroSesion} />
    </span>
  );
}
