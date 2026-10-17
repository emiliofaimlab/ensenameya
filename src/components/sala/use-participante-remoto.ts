"use client";

import { useEffect, useState } from "react";
import type { DailyCall, DailyParticipant, DailyTrackState } from "@daily-co/daily-js";

/**
 * Quién está en la llamada y con qué pistas, para pintar NUESTRAS teselas.
 *
 * Desde las correcciones de Emilio (16-oct) la sala ya no es Daily Prebuilt
 * (`createFrame`) sino `createCallObject`: Daily solo lleva el transporte y la
 * interfaz entera es nuestra. Por eso aquí salen las pistas de cámara, micro y
 * pantalla de cada uno — antes vivían dentro del iframe y no se podían
 * colocar.
 */
export type Participante = {
  id: string;
  local: boolean;
  nombre: string;
  owner: boolean;
  /** Pistas `playable` o `null`. `persistentTrack`, como pide Daily: evita
   *  los fotogramas negros al recolocar el `<video>`. */
  video: MediaStreamTrack | null;
  audio: MediaStreamTrack | null;
  pantalla: MediaStreamTrack | null;
  pantallaAudio: MediaStreamTrack | null;
  camara: boolean;
  micro: boolean;
  /** M5 · puede compartir pantalla. En una grupal el alumno entra sin ese
   *  permiso (`canSend` del token) y el tutor se lo concede o se lo quita. */
  puedePantalla: boolean;
};

/** Lo que necesitan la mano levantada (1:1) y la ventana flotante. */
export type ParticipanteRemoto = {
  presente: boolean;
  /** Estuvo y se fue (para decir «Se fue de la sala» y no «aún no se unió»). */
  seFue: boolean;
  nombre: string | null;
};

function pista(t: DailyTrackState | undefined): MediaStreamTrack | null {
  return t?.state === "playable" && t.persistentTrack instanceof MediaStreamTrack
    ? t.persistentTrack
    : null;
}

function aParticipante(p: DailyParticipant): Participante {
  const enciende = (t: DailyTrackState | undefined) =>
    !["off", "blocked"].includes(t?.state ?? "off");
  const canSend = p.permissions?.canSend;
  return {
    id: p.session_id,
    local: p.local,
    nombre: p.user_name || (p.local ? "Tú" : "Participante"),
    owner: p.owner,
    video: pista(p.tracks?.video),
    audio: pista(p.tracks?.audio),
    pantalla: pista(p.tracks?.screenVideo),
    pantallaAudio: pista(p.tracks?.screenAudio),
    camara: enciende(p.tracks?.video),
    micro: enciende(p.tracks?.audio),
    puedePantalla: canSend === true || (canSend instanceof Set && canSend.has("screenVideo")),
  };
}

function leer(call: DailyCall): Participante[] {
  let ps: Record<string, DailyParticipant> = {};
  try {
    ps = call.participants() ?? {};
  } catch {
    /* llamada destruida */
  }
  // Yo primero; el resto en el orden en que entraron.
  return Object.values(ps)
    .map(aParticipante)
    .sort((a, b) => Number(b.local) - Number(a.local));
}

export function useParticipantes(call: DailyCall | null) {
  const [lista, setLista] = useState<Participante[]>([]);
  const [estuvo, setEstuvo] = useState(false);
  const [grabando, setGrabando] = useState(false);

  useEffect(() => {
    if (!call) return;
    const actualizar = () => {
      const l = leer(call);
      setLista(l);
      if (l.some((p) => !p.local)) setEstuvo(true);
    };
    const eventos = [
      "joined-meeting",
      "participant-joined",
      "participant-updated",
      "participant-left",
      "track-started",
      "track-stopped",
    ] as const;
    const enGrabacion = () => setGrabando(true);
    const finGrabacion = () => setGrabando(false);
    eventos.forEach((ev) => call.on(ev, actualizar));
    call.on("recording-started", enGrabacion);
    call.on("recording-stopped", finGrabacion);
    return () => {
      try {
        eventos.forEach((ev) => call.off(ev, actualizar));
        call.off("recording-started", enGrabacion);
        call.off("recording-stopped", finGrabacion);
      } catch {
        /* llamada ya destruida */
      }
    };
  }, [call]);

  const otro = lista.find((p) => !p.local);
  const remoto: ParticipanteRemoto = {
    presente: Boolean(otro),
    seFue: !otro && estuvo,
    nombre: otro?.nombre ?? null,
  };
  return { lista, yo: lista.find((p) => p.local) ?? null, remoto, grabando };
}
