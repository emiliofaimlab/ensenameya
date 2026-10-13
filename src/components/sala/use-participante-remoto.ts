"use client";

import { useEffect, useState } from "react";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";

/**
 * EY-221 · Quién es «el otro» en la llamada (las clases son 1:1) y en qué
 * estado está, para la mano levantada y la ventana flotante.
 *
 * ⚠️ `video` puede venir `null` CON LA CÁMARA ENCENDIDA. Con Daily Prebuilt
 * (`createFrame`) la llamada vive dentro del iframe de daily.co y las pistas
 * son de ESE documento: según la versión, `participants()` las expone o no al
 * nuestro. La ventana flotante usa la pista si llega y, si no, enseña el
 * nombre y el estado de cámara/micro. Ver `ventana-flotante.tsx`.
 */
export type ParticipanteRemoto = {
  /** ¿está ahora en la llamada? */
  presente: boolean;
  /** Estuvo y se fue (para decir «Se fue de la sala» y no «aún no se unió»). */
  seFue: boolean;
  nombre: string | null;
  video: MediaStreamTrack | null;
  camara: boolean;
  micro: boolean;
};

export type EstadoLocal = { micro: boolean };

const VACIO: ParticipanteRemoto = {
  presente: false,
  seFue: false,
  nombre: null,
  video: null,
  camara: false,
  micro: false,
};

function leer(call: DailyCall, estuvo: boolean) {
  let ps: Record<string, DailyParticipant> = {};
  try {
    ps = call.participants() ?? {};
  } catch {
    /* llamada destruida */
  }
  const otro = Object.values(ps).find((p) => !p.local);
  const local = ps.local;
  const remoto: ParticipanteRemoto = otro
    ? {
        presente: true,
        seFue: false,
        nombre: otro.user_name || null,
        video:
          otro.tracks?.video?.persistentTrack instanceof MediaStreamTrack
            ? otro.tracks.video.persistentTrack
            : null,
        camara: otro.tracks?.video?.state === "playable",
        micro: otro.tracks?.audio?.state === "playable",
      }
    : { ...VACIO, seFue: estuvo };
  const yo: EstadoLocal = {
    micro: local
      ? !["off", "blocked"].includes(local.tracks?.audio?.state ?? "off")
      : true,
  };
  return { remoto, yo };
}

export function useParticipanteRemoto(call: DailyCall | null) {
  const [estado, setEstado] = useState<{
    remoto: ParticipanteRemoto;
    yo: EstadoLocal;
  }>({ remoto: VACIO, yo: { micro: true } });

  useEffect(() => {
    if (!call) return;
    let estuvo = false;
    const actualizar = () => {
      const r = leer(call, estuvo);
      if (r.remoto.presente) estuvo = true;
      setEstado(r);
    };
    const eventos = [
      "joined-meeting",
      "participant-joined",
      "participant-updated",
      "participant-left",
      "track-started",
      "track-stopped",
    ] as const;
    eventos.forEach((ev) => call.on(ev, actualizar));
    return () => {
      try {
        eventos.forEach((ev) => call.off(ev, actualizar));
      } catch {
        /* llamada ya destruida */
      }
    };
  }, [call]);

  return estado;
}
