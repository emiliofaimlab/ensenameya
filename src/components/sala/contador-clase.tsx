"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/** A cuántos minutos del final se avisa y el contador cambia de color. */
export const AVISO_MIN_ANTES_DEL_FIN = 5;

/** ms → "12:34" (o "1:02:03" si pasa de una hora). */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${ss}`
    : `${String(m).padStart(2, "0")}:${ss}`;
}

export type FaseContador = "antes" | "normal" | "aviso" | "fin";

/**
 * Lo que dice el contador en un instante dado. Puro: lo comparten el contador
 * de la sala y el de la ventana flotante, así los dos no pueden discrepar.
 *
 * Es el cálculo que antes vivía en la cabecera de la sala (`total`/`elapsed`
 * de `live-room.tsx`), con el mismo tope: el transcurrido no pasa del total.
 */
export function estadoContador(now: number, startAt: string, endAt: string) {
  const inicio = Date.parse(startAt);
  const fin = Date.parse(endAt);
  const total = fin - inicio;
  const transcurrido = Math.min(Math.max(0, now - inicio), total);
  const restante = fin - now;
  const fase: FaseContador =
    now < inicio
      ? "antes"
      : restante <= 0
        ? "fin"
        : restante <= AVISO_MIN_ANTES_DEL_FIN * 60_000
          ? "aviso"
          : "normal";
  return { inicio, total, transcurrido, restante, fase };
}

/**
 * EY-221 · El contador superpuesto sobre la videollamada: transcurrido Y
 * restante, para los dos participantes. A falta de 5 minutos cambia a ámbar y
 * avisa una vez con un toast; al llegar a cero, rojo.
 *
 * `now` lo pone el reloj de 1 s que ya tiene la sala: aquí no hay otro
 * intervalo.
 */
export function ContadorClase({
  now,
  startAt,
  endAt,
  className,
}: {
  now: number;
  startAt: string;
  endAt: string;
  className?: string;
}) {
  const { inicio, transcurrido, restante, fase } = estadoContador(
    now,
    startAt,
    endAt,
  );

  // Un aviso por fase y por montaje: el toast de «quedan 5 minutos» no se
  // repite cada segundo, y quien entra con 3 minutos por delante lo recibe
  // igual (porque es justo quien más lo necesita).
  const avisado = useRef<FaseContador | null>(null);
  useEffect(() => {
    if (fase === avisado.current) return;
    if (fase === "aviso") {
      toast.warning(
        `Quedan ${AVISO_MIN_ANTES_DEL_FIN} minutos o menos de mentoría`,
        { id: "sala-aviso-fin" },
      );
    } else if (fase === "fin" && avisado.current !== null) {
      toast("Se cumplió la hora de la mentoría", { id: "sala-aviso-fin" });
    }
    avisado.current = fase;
  }, [fase]);

  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={
        fase === "antes"
          ? `La mentoría empieza en ${reloj(inicio - now)}`
          : `Transcurrido ${reloj(transcurrido)}, quedan ${reloj(restante)}`
      }
      className={cn(
        "pointer-events-none flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs tabular-nums shadow-md backdrop-blur-sm sm:text-sm",
        fase === "aviso"
          ? "bg-amber-500/90 text-black"
          : fase === "fin"
            ? "bg-red-600/90 text-white"
            : "bg-black/60 text-white",
        className,
      )}
    >
      {fase === "antes" ? (
        <span>Empieza en {reloj(inicio - now)}</span>
      ) : (
        <>
          <span title="Transcurrido">{reloj(transcurrido)}</span>
          <span aria-hidden className="opacity-60">
            ·
          </span>
          <span title="Restante">
            {fase === "fin" ? "Tiempo cumplido" : `quedan ${reloj(restante)}`}
          </span>
        </>
      )}
    </div>
  );
}
