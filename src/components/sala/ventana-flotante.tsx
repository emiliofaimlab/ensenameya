"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { HandIcon, MicIcon, MicOffIcon, UndoIcon, VideoOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { estadoContador, reloj } from "./contador-clase";
import type { EstadoLocal, ParticipanteRemoto } from "./use-participante-remoto";

/**
 * EY-221 · La ventana flotante «tipo Meet», nuestra.
 *
 * El motivo: el tutor comparte pantalla, cambia de pestaña y deja de ver al
 * alumno y su mano levantada. Esto la deja encima de todo.
 *
 * Va con la **Document Picture-in-Picture API**, que hoy solo existe en Chrome
 * y Edge de escritorio — aceptado por el cliente: en los demás navegadores el
 * botón no aparece (`soportada`). Exige un gesto del usuario: se abre desde un
 * botón, nunca sola.
 *
 * El contenido es un portal de React a un `div` de la ventana nueva: sigue
 * siendo el mismo árbol, recibe el mismo `now` de la sala cada segundo y sus
 * botones llaman a los mismos callbacks. Los estilos se COPIAN al abrir (una
 * ventana PiP nace sin hojas de estilo).
 */
type DocumentPiP = {
  requestWindow(o?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
};

function api(): DocumentPiP | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { documentPictureInPicture?: DocumentPiP })
      .documentPictureInPicture ?? null
  );
}

const sinCambios = () => () => {};

function copiarEstilos(destino: Document) {
  for (const hoja of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(hoja.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      const style = destino.createElement("style");
      style.textContent = css;
      destino.head.append(style);
    } catch {
      // Hoja de otro origen (no se pueden leer sus reglas): se enlaza.
      if (hoja.href) {
        const link = destino.createElement("link");
        link.rel = "stylesheet";
        link.href = hoja.href;
        destino.head.append(link);
      }
    }
  }
  // Las variables de fuente (`next/font`) cuelgan de clases del <html>/<body>.
  destino.documentElement.className = document.documentElement.className;
  destino.body.className = document.body.className;
}

export function useVentanaFlotante() {
  const soportada = useSyncExternalStore(
    sinCambios,
    () => api() !== null,
    () => false,
  );
  const [contenedor, setContenedor] = useState<HTMLElement | null>(null);
  const ventana = useRef<Window | null>(null);

  const cerrar = useCallback(() => {
    ventana.current?.close();
    ventana.current = null;
    setContenedor(null);
  }, []);

  const abrir = useCallback(async () => {
    const pip = api();
    if (!pip) return;
    if (ventana.current) {
      ventana.current.focus();
      return;
    }
    try {
      const w = await pip.requestWindow({ width: 340, height: 300 });
      ventana.current = w;
      w.document.title = "Enséñame Ya · Sala";
      copiarEstilos(w.document);
      const raiz = w.document.createElement("div");
      raiz.className = "h-full";
      w.document.body.style.margin = "0";
      w.document.body.style.background = "#14141a";
      w.document.body.append(raiz);
      w.addEventListener("pagehide", () => {
        ventana.current = null;
        setContenedor(null);
      });
      setContenedor(raiz);
    } catch (e) {
      console.warn("[sala] ventana flotante:", e);
    }
  }, []);

  // Al salir de la sala, la ventana se va con ella.
  useEffect(() => () => ventana.current?.close(), []);

  return { soportada, abierta: contenedor !== null, contenedor, abrir, cerrar };
}

function VideoRemoto({ track }: { track: MediaStreamTrack }) {
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
  // Silenciado: el audio ya suena en la sala (dentro del iframe de Daily).
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      className="size-full object-cover"
    />
  );
}

export function VentanaFlotante({
  contenedor,
  rolOtro,
  remoto,
  yo,
  now,
  startAt,
  endAt,
  manoDelOtro,
  miMano,
  onBajarManoDelOtro,
  onAlternarMiMano,
  onAlternarMicro,
  onVolver,
}: {
  contenedor: HTMLElement;
  rolOtro: "alumno" | "tutor";
  remoto: ParticipanteRemoto;
  yo: EstadoLocal;
  now: number;
  startAt: string;
  endAt: string;
  manoDelOtro: boolean;
  miMano: boolean;
  onBajarManoDelOtro: () => void;
  onAlternarMiMano: () => void;
  /** `null` en la sala simulada: no hay micro que silenciar. */
  onAlternarMicro: (() => void) | null;
  onVolver: () => void;
}) {
  const { transcurrido, restante, fase } = estadoContador(now, startAt, endAt);
  const elOtro = rolOtro === "alumno" ? "El alumno" : "El tutor";

  return createPortal(
    <div className="flex h-svh flex-col bg-[#14141a] text-white">
      <div className="relative min-h-0 flex-1 bg-[#0f0f14]">
        {remoto.presente && remoto.video && remoto.camara ? (
          <VideoRemoto track={remoto.video} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center">
            {remoto.presente ? (
              <>
                <p className="text-base font-semibold">
                  {remoto.nombre ?? elOtro}
                </p>
                <p className="flex items-center gap-1 text-xs text-[#a3a3ad]">
                  {!remoto.camara ? (
                    <>
                      <VideoOffIcon className="size-3.5" aria-hidden /> Cámara
                      apagada
                    </>
                  ) : (
                    "En la sala"
                  )}
                  {!remoto.micro ? " · micrófono silenciado" : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-[#a3a3ad]">
                {remoto.seFue
                  ? `${elOtro} se fue de la sala`
                  : `${elOtro} aún no se ha unido`}
              </p>
            )}
          </div>
        )}

        <p
          className={cn(
            "absolute top-2 left-2 rounded-full px-2 py-0.5 font-mono text-xs tabular-nums",
            fase === "aviso"
              ? "bg-amber-500 text-black"
              : fase === "fin"
                ? "bg-red-600"
                : "bg-black/60",
          )}
        >
          {fase === "antes"
            ? "Aún no empieza"
            : `${reloj(transcurrido)} · ${fase === "fin" ? "tiempo cumplido" : `quedan ${reloj(restante)}`}`}
        </p>

        {manoDelOtro ? (
          <div
            role="status"
            className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-md bg-[#fe6a00] px-2 py-1.5 text-sm font-semibold text-white"
          >
            <span className="flex items-center gap-1.5">
              <HandIcon className="size-4" aria-hidden />
              {elOtro} levantó la mano
            </span>
            <button
              type="button"
              onClick={onBajarManoDelOtro}
              className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
            >
              Bajar
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-[#3a3a45] p-2">
        {onAlternarMicro ? (
          <button
            type="button"
            onClick={onAlternarMicro}
            aria-label={yo.micro ? "Silenciar mi micrófono" : "Activar mi micrófono"}
            title={yo.micro ? "Silenciar" : "Activar micrófono"}
            className={cn(
              "rounded-full p-2",
              yo.micro ? "bg-[#26262f] hover:bg-[#3a3a45]" : "bg-red-600 hover:bg-red-700",
            )}
          >
            {yo.micro ? (
              <MicIcon className="size-4" aria-hidden />
            ) : (
              <MicOffIcon className="size-4" aria-hidden />
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAlternarMiMano}
          aria-pressed={miMano}
          aria-label={miMano ? "Bajar la mano" : "Levantar la mano"}
          title={miMano ? "Bajar la mano" : "Levantar la mano"}
          className={cn(
            "rounded-full p-2",
            miMano ? "bg-[#fe6a00]" : "bg-[#26262f] hover:bg-[#3a3a45]",
          )}
        >
          <HandIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onVolver}
          className="inline-flex items-center gap-1 rounded-full bg-[#26262f] px-3 py-2 text-xs hover:bg-[#3a3a45]"
        >
          <UndoIcon className="size-3.5" aria-hidden />
          Volver a la sala
        </button>
      </div>
    </div>,
    contenedor,
  );
}
