"use client";

import { useEffect, type RefObject } from "react";
import type { DailyCall } from "@daily-co/daily-js";

/** Nombre de la pista personalizada en Daily (`tracks.documento`). */
const PISTA = "documento";
/** Fotogramas por segundo: un documento con anotaciones no pide más. */
const FPS = 10;
/** Ancho máximo del lienzo compuesto, para no mandar un 4K por la red. */
const ANCHO_MAX = 1280;

/**
 * M30 · el documento que presenta el tutor, como PISTA DE VIDEO.
 *
 * El documento y sus anotaciones viajan por `app-message` y cada uno los pinta
 * en su pantalla, así que la grabación de Daily —que solo ve pistas— no los
 * incluía. Mientras `activo`, se componen los dos lienzos del visor (página +
 * trazos) en uno fuera de pantalla a ~10 fps, se saca su `captureStream` y se
 * publica con `startCustomTrack`. Al dejar de presentar, o al desmontar, se
 * retira (`stopCustomTrack`) y se para la pista.
 *
 * Las teselas no la pintan (`aParticipante` solo lee cámara y pantalla): no
 * sale una tesela de más; solo va a la grabación.
 *
 * ⚠️ Sin verificar en vivo: que la grabación de Daily (layout por defecto o
 * VCS) INCLUYA una pista personalizada se comprueba en el re-sondeo. Si no
 * entra, la alternativa es publicar el mismo `MediaStream` como pantalla
 * compartida (`startScreenShare({ mediaStream })`), que sí graba seguro pero
 * ocupa el escenario como una pantalla más.
 *
 * Cualquier fallo va a `console.warn`: la presentación sigue igual sin pista.
 */
export function usePistaDocumento(
  call: DailyCall | null,
  activo: boolean,
  pagina: RefObject<HTMLCanvasElement | null>,
  trazos: RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    if (!call || !activo) return;
    const lienzo = document.createElement("canvas");
    lienzo.width = ANCHO_MAX;
    lienzo.height = 720;
    const ctx = lienzo.getContext("2d");
    if (!ctx || typeof lienzo.captureStream !== "function") {
      console.warn("[sala] este navegador no puede publicar el documento como pista.");
      return;
    }

    const componer = () => {
      const p = pagina.current;
      if (!p || p.width === 0 || p.height === 0) return;
      const escala = Math.min(1, ANCHO_MAX / p.width);
      const w = Math.max(2, Math.round(p.width * escala));
      const h = Math.max(2, Math.round(p.height * escala));
      if (lienzo.width !== w) lienzo.width = w;
      if (lienzo.height !== h) lienzo.height = h;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(p, 0, 0, w, h);
      // Los trazos tienen otra resolución (CSS × dpr) pero cubren la misma
      // caja que la página: se estiran al mismo rectángulo.
      const t = trazos.current;
      if (t && t.width > 0 && t.height > 0) ctx.drawImage(t, 0, 0, w, h);
    };

    componer();
    const pista = lienzo.captureStream(FPS).getVideoTracks()[0];
    if (!pista) return;
    // Intervalo y no `requestAnimationFrame`: rAF se para del todo con la
    // pestaña oculta (el tutor en otra ventana con la flotante abierta).
    const id = setInterval(componer, 1000 / FPS);
    let publicada = false;
    let vivo = true;
    // Puede tocar retirarla con la llamada ya destruida (salir de la sala):
    // ahí Daily lanza en vez de rechazar, y no debe romper el desmontaje.
    const retirar = () => {
      try {
        call
          .stopCustomTrack(PISTA)
          .catch((e: unknown) => console.warn("[sala] no se pudo retirar el documento:", e));
      } catch (e) {
        console.warn("[sala] no se pudo retirar el documento:", e);
      }
    };
    try {
      call
        .startCustomTrack({ track: pista, trackName: PISTA })
        .then(() => {
          publicada = true;
          // Desmontado mientras se publicaba: se retira ya.
          if (!vivo) retirar();
        })
        .catch((e: unknown) => console.warn("[sala] no se pudo publicar el documento:", e));
    } catch (e) {
      console.warn("[sala] no se pudo publicar el documento:", e);
    }

    return () => {
      vivo = false;
      clearInterval(id);
      if (publicada) retirar();
      pista.stop();
    };
  }, [call, activo, pagina, trazos]);
}
