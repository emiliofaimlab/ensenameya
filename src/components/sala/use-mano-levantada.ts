"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CanalSala } from "./canal-sala";

/**
 * EY-221 · Levantar la mano, sincronizado por el canal de la sala.
 *
 * `mia` es la propia; `delOtro`, la del otro participante. Al subir la del otro
 * suena un aviso corto y sale un toast (además del indicador sobre el vídeo y
 * en la ventana flotante, que es lo que se ve en pantalla completa: el toast
 * vive fuera del contenedor y ahí no aparece).
 *
 * Cualquiera de los dos puede bajar la mano del otro (el tutor que ya atendió
 * la pregunta): se le pide con `mano-bajar` y el dueño la baja y lo anuncia,
 * así el estado siempre lo emite quien lo tiene.
 */
export function useManoLevantada({
  canal,
  nombreOtro,
  otroPresente,
}: {
  canal: CanalSala | null;
  /** «El alumno» / «El tutor», para el aviso. */
  nombreOtro: string;
  /** Si el otro se va de la sala, su mano deja de estar levantada. */
  otroPresente: boolean;
}) {
  const [mia, setMia] = useState(false);
  const [delOtro, setDelOtro] = useState(false);
  const miaRef = useRef(false);
  const delOtroRef = useRef(false);

  const fijarMia = useCallback(
    (arriba: boolean) => {
      miaRef.current = arriba;
      setMia(arriba);
      canal?.enviar({ k: "mano", arriba });
    },
    [canal],
  );

  useEffect(() => {
    if (!canal) return;
    const quitar = canal.escuchar((m) => {
      if (m.k === "sync-request") {
        if (miaRef.current) canal.enviar({ k: "mano", arriba: true });
      } else if (m.k === "mano") {
        // El aviso sale FUERA del `setState`: un efecto dentro del updater
        // sonaría dos veces en desarrollo (StrictMode lo ejecuta doble).
        if (m.arriba && !delOtroRef.current) {
          sonarAviso();
          toast(`${nombreOtro} levantó la mano`, { id: "sala-mano", icon: "✋" });
        }
        delOtroRef.current = m.arriba;
        setDelOtro(m.arriba);
      } else if (m.k === "mano-bajar") {
        miaRef.current = false;
        setMia(false);
        canal.enviar({ k: "mano", arriba: false });
      }
    });
    // El `sync-request` NO se manda aquí: lo manda una vez la sala, cuando ya
    // están escuchando todos sus hooks (ver `live-room.tsx`).
    return quitar;
  }, [canal, nombreOtro]);

  // Se fue de la sala con la mano arriba: no la dejamos colgando. Es un
  // ajuste DERIVADO de una prop (no hay evento que escuchar aquí), así que se
  // hace en render, que es lo que recomienda React para esto.
  const [presenteAntes, setPresenteAntes] = useState(otroPresente);
  if (presenteAntes !== otroPresente) {
    setPresenteAntes(otroPresente);
    if (!otroPresente && delOtro) setDelOtro(false);
  }

  // Espejo para el oyente del canal (que no se re-suscribe en cada cambio).
  useEffect(() => {
    delOtroRef.current = delOtro;
  }, [delOtro]);

  const alternar = useCallback(() => fijarMia(!miaRef.current), [fijarMia]);
  const bajarLaDelOtro = useCallback(() => {
    setDelOtro(false);
    canal?.enviar({ k: "mano-bajar" });
  }, [canal]);

  return { mia, delOtro, alternar, bajarLaDelOtro };
}

/**
 * Dos tonos cortos con WebAudio: sin fichero que servir ni que cargar. Si el
 * navegador no deja (sin gesto previo), se calla y queda el aviso visual.
 */
let ctx: AudioContext | null = null;
function sonarAviso() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t = t0 + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.14);
    });
  } catch {
    /* sin audio: queda el indicador */
  }
}
