"use client";

import { useEffect, useRef, useState } from "react";
import { MicOffIcon, MoreVerticalIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Participante } from "./use-participante-remoto";

/** Un `<video>` sobre una pista. Siempre mudo: el audio va aparte. */
export function Video({
  track,
  espejo,
  ajuste = "cover",
  className,
}: {
  track: MediaStreamTrack;
  espejo?: boolean;
  ajuste?: "cover" | "contain";
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = new MediaStream([track]);
    void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [track]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      className={cn(
        "size-full",
        ajuste === "cover" ? "object-cover" : "object-contain",
        espejo && "-scale-x-100",
        className,
      )}
    />
  );
}

function Audio({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.srcObject = new MediaStream([track]);
    void a.play().catch(() => {});
    return () => {
      a.srcObject = null;
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

/**
 * El sonido de los demás (micro y audio de pantalla). Va APARTE de las
 * teselas a propósito: una tesela se mueve del escenario a la franja —y a la
 * ventana flotante— y con ella se remontaría el `<audio>`, que es un corte.
 */
export function AudiosRemotos({ lista }: { lista: Participante[] }) {
  return (
    <div hidden>
      {lista
        .filter((p) => !p.local)
        .flatMap((p) => [
          p.audio ? <Audio key={`${p.id}:a`} track={p.audio} /> : null,
          p.pantallaAudio ? <Audio key={`${p.id}:s`} track={p.pantallaAudio} /> : null,
        ])}
    </div>
  );
}

function Iniciales({ nombre }: { nombre: string }) {
  const ini = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return (
    <div className="flex size-full items-center justify-center">
      <span className="flex aspect-square w-1/4 max-w-20 min-w-9 items-center justify-center rounded-full bg-[color:var(--sala-surface)] text-sm font-semibold sm:text-lg">
        {ini || "?"}
      </span>
    </div>
  );
}

/**
 * La cámara de una persona. `acciones` solo llega para el tutor en una
 * grupal (RG-12: silenciar o sacar a alguien), que es lo que antes hacía la
 * lista de participantes de Prebuilt.
 */
export function Tesela({
  p,
  className,
  acciones,
}: {
  p: Participante;
  className?: string;
  acciones?: { silenciar: () => void; sacar: () => void };
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-[color:var(--sala-surface)]",
        className,
      )}
    >
      {p.video ? <Video track={p.video} espejo={p.local} /> : <Iniciales nombre={p.nombre} />}
      <p className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
        {!p.micro ? <MicOffIcon className="size-3 shrink-0 text-red-400" aria-label="Micrófono apagado" /> : null}
        <span className="truncate">{p.local ? `${p.nombre} (tú)` : p.nombre}</span>
      </p>
      {acciones ? (
        <div className="absolute top-1.5 right-1.5">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            aria-label={`Opciones de ${p.nombre}`}
            className="rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <MoreVerticalIcon className="size-4" aria-hidden />
          </button>
          {menu ? (
            <div className="absolute top-full right-0 z-10 mt-1 flex w-40 flex-col overflow-hidden rounded-md border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] text-sm shadow-lg">
              <button
                type="button"
                disabled={!p.micro}
                onClick={() => {
                  acciones.silenciar();
                  setMenu(false);
                }}
                className="px-3 py-2 text-left hover:bg-white/10 disabled:opacity-40"
              >
                Silenciar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Sacar a ${p.nombre} de la sala?`)) acciones.sacar();
                  setMenu(false);
                }}
                className="px-3 py-2 text-left text-red-400 hover:bg-white/10"
              >
                Sacar de la sala
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
