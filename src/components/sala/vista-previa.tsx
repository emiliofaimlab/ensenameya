"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Video } from "./tesela";

/**
 * M5 · La antesala de una grupal: te ves antes de entrar y decides con qué
 * entras. El alumno llega con el micro apagado (lo decide `live-room.tsx`);
 * aquí puede cambiarlo, y lo que deje elegido es el `startAudioOff` /
 * `startVideoOff` del `join` de Daily.
 *
 * La cámara de la vista previa es NUESTRA (`getUserMedia`), no de Daily: se
 * suelta al desmontar, que es justo al pulsar «Entrar a la sala» (la sala
 * cambia de rama), antes de que Daily pida la suya.
 *
 * Si el navegador no deja, se dice y se entra igual: dentro de la sala se
 * pueden activar con la barra.
 */
export function VistaPrevia({
  micro,
  camara,
  onCambio,
}: {
  micro: boolean;
  camara: boolean;
  onCambio: (micro: boolean, camara: boolean) => void;
}) {
  // El stream va en un ref (es lo que se toca: `enabled`, `stop`) y en estado
  // solo la pista de video, que es lo que se pinta.
  const streamRef = useRef<MediaStream | null>(null);
  const [video, setVideo] = useState<MediaStreamTrack | null>(null);
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    let pedido: MediaStream | null = null;
    const pedir = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      : Promise.reject(new Error("sin getUserMedia"));
    pedir
      .then((s) => {
        if (!vivo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        pedido = s;
        streamRef.current = s;
        setVideo(s.getVideoTracks()[0] ?? null);
        setListo(true);
      })
      .catch(() => {
        if (vivo) setFallo(true);
      });
    return () => {
      vivo = false;
      pedido?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Encender o apagar es `enabled` de la pista: no se vuelve a pedir permiso.
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = micro));
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = camara));
  }, [listo, micro, camara]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#26262f] text-white">
        {video && camara ? (
          <Video track={video} espejo />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-[#a3a3ad]">
            {fallo ? "Sin cámara" : listo ? "Cámara apagada" : "Encendiendo la cámara…"}
          </div>
        )}
      </div>
      {fallo ? (
        <p role="status" className="text-xs text-muted-foreground">
          No pudimos acceder a la cámara o al micrófono. Podrás activarlos dentro de la sala.
        </p>
      ) : null}
      <div className="flex justify-center gap-2">
        {(
          [
            ["Micrófono", micro, () => onCambio(!micro, camara), MicIcon, MicOffIcon],
            ["Cámara", camara, () => onCambio(micro, !camara), VideoIcon, VideoOffIcon],
          ] as const
        ).map(([rotulo, activo, alternar, Encendido, Apagado]) => (
          <button
            key={rotulo}
            type="button"
            aria-pressed={activo}
            onClick={alternar}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
              activo ? "bg-background hover:bg-muted" : "border-red-600 bg-red-600 text-white hover:bg-red-700",
            )}
          >
            {activo ? (
              <Encendido className="size-4" aria-hidden />
            ) : (
              <Apagado className="size-4" aria-hidden />
            )}
            {rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
