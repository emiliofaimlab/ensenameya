"use client";

import { useState } from "react";
import { TimerIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  MINUTOS_EXTENSION,
  estadoContador,
  puedeExtender,
  reloj,
  type FaseContador,
} from "./tiempo";

/** El color del bloque por fase (laboratorio de Emilio). */
const COLOR: Record<FaseContador, string> = {
  antes: "bg-black/60 text-white",
  normal: "bg-black/60 text-white",
  aviso: "bg-amber-400 text-black",
  extendida: "bg-[#0080ff] text-white",
  extra: "bg-[#fe6a00] text-white",
  cerrada: "bg-red-600 text-white",
};

/**
 * Corrección 6 · El reloj de la sala, flotando arriba a la izquierda del
 * escenario, y el ÚNICO sitio donde salen los avisos y las opciones de tiempo
 * (antes eran toasts sueltos y un botón aparte). Es un bloque que crece:
 *  1. En clase: lo que lleva sobre lo que dura («12:34 / 60:00»).
 *  2. A 5 min del fin, ámbar: «La clase termina en…».
 *  3. Cumplida la hora, naranja: la cuenta atrás de los 10 min extra (hasta
 *     `access_closes_at`, cuando Daily cierra la sala).
 *  4. Extendida, azul: «Clase extendida · quedan…».
 *  5. El tutor extiende 5, 10 o 20 min desde aquí: una vez, gratis para el
 *     alumno, nunca en grupales (`extend_session`), desde el aviso hasta el
 *     cierre.
 *
 * ⚠️ El laboratorio de Emilio propone extender SOLO tras agotar el extra y
 * cuantas veces se quiera. No se adopta todavía (16-oct): choca con el cierre
 * de la sala y del cron a los 10 min, del que cuelga el payout. Pendiente de
 * hablarlo con él.
 *
 * Se pinta DENTRO del contenedor de pantalla completa (nada de portales: ver
 * `use-pantalla-completa.ts`).
 */
export function ContadorClase({
  now,
  startAt,
  endAt,
  closesAt,
  extendida,
  extender,
  className,
  sustantivo = "mentoría",
}: {
  /** P43 · «clase» en grupal, «mentoría» en 1:1. */
  sustantivo?: "clase" | "mentoría";
  now: number;
  startAt: string;
  endAt: string;
  closesAt: string;
  extendida: boolean;
  /** Solo el tutor de una 1:1 que aún no extendió. */
  extender?: {
    sessionId: string;
    onExtendida: (endsAt: string, closesAt: string) => void;
  };
  className?: string;
}) {
  const { inicio, total, transcurrido, restante, hastaCierre, fase } =
    estadoContador(now, startAt, endAt, closesAt, extendida);
  const [busy, setBusy] = useState(false);

  async function extenderMin(minutos: number) {
    if (!extender) return;
    setBusy(true);
    const res = await fetch(`/api/room/${extender.sessionId}/extender`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutos }),
    });
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
    toast.success(`La clase se extendió ${minutos} minutos. No tiene costo para el alumno.`);
    extender.onExtendida(body.endsAt, body.closesAt);
  }

  const aviso =
    fase === "aviso"
      ? `La clase termina en ${reloj(restante)}`
      : fase === "extra"
        ? `Tiempo extra · la sala cierra en ${reloj(hastaCierre)}`
        : fase === "extendida"
          ? `Clase extendida · quedan ${reloj(restante)}`
          : fase === "cerrada"
            ? "Se acabó el tiempo extra"
            : null;
  const ofrecer = extender && puedeExtender(fase);

  return (
    <div
      role="timer"
      aria-label={
        fase === "antes"
          ? `La ${sustantivo} empieza en ${reloj(inicio - now)}`
          : `La clase lleva ${reloj(transcurrido)}${aviso ? `. ${aviso}` : ""}`
      }
      className={cn(
        "pointer-events-auto flex w-max max-w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-1.5 rounded-2xl px-3 py-1.5 shadow-md backdrop-blur-sm transition-colors",
        COLOR[fase],
        className,
      )}
    >
      <div className="flex items-center gap-2 font-mono text-sm whitespace-nowrap tabular-nums">
        <TimerIcon className="size-3.5 shrink-0 opacity-80" aria-hidden />
        {fase === "antes" ? (
          <span>Empieza en {reloj(inicio - now)}</span>
        ) : (
          <>
            <span className="font-semibold" title="Tiempo de clase">
              {reloj(transcurrido)}
            </span>
            {fase === "normal" ? <span className="opacity-60">/ {reloj(total)}</span> : null}
          </>
        )}
      </div>
      {aviso ? (
        <p aria-live="polite" className="text-xs font-medium">
          {aviso}
        </p>
      ) : null}
      {ofrecer ? (
        <div className="flex items-center gap-1.5 pb-0.5 whitespace-nowrap">
          <span className="text-xs opacity-90">Extender:</span>
          {MINUTOS_EXTENSION.map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => void extenderMin(m)}
              className="rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/40 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-60"
            >
              +{m} min
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
