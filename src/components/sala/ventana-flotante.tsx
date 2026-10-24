"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HandIcon, MicIcon, MicOffIcon, UndoIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { estadoContador, reloj } from "./tiempo";

/**
 * EY-221 · La ventana flotante «tipo Meet», nuestra.
 *
 * Corrección 5 (Emilio, 16-oct): SIN botón. Se abre sola cuando la persona se
 * va de la pestaña de la llamada sin colgar (a mirar otra ventana) y se cierra
 * al volver. Enseña las cámaras, el tiempo y lo que se esté compartiendo: es
 * el mismo `EscenarioSala` de la sala, en compacto.
 *
 * ⚠️ «Sola» tiene letra pequeña. La Document Picture-in-Picture API exige un
 * gesto del usuario, y la única excepción es la PiP AUTOMÁTICA de Chrome para
 * videollamadas: la acción `enterpictureinpicture` de Media Session, que el
 * navegador dispara al cambiar de PESTAÑA con cámara o micro en uso. Así que:
 *  · solo Chrome/Edge de escritorio (el resto, sin ventana: aceptado por el
 *    cliente desde EY-221);
 *  · al cambiar de pestaña, no al pasar a otra aplicación;
 *  · y el usuario puede negarlo en el permiso del sitio («Picture-in-picture
 *    automático»).
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

export function useVentanaFlotante(enLlamada: boolean) {
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
    if (ventana.current) return;
    try {
      const w = await pip.requestWindow({ width: 420, height: 380 });
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

  // Se abre sola al irse de la pestaña (ver la nota de arriba) y se cierra al
  // volver, que es cuando deja de hacer falta.
  useEffect(() => {
    if (!soportada || !enLlamada) return;
    const accion = "enterpictureinpicture" as MediaSessionAction;
    try {
      navigator.mediaSession?.setActionHandler(accion, () => void abrir());
    } catch {
      /* navegador sin PiP automática: no hay ventana sola */
    }
    const alVolver = () => {
      if (document.visibilityState === "visible") cerrar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      try {
        navigator.mediaSession?.setActionHandler(accion, null);
      } catch {
        /* ídem */
      }
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [soportada, enLlamada, abrir, cerrar]);

  // Al salir de la sala, la ventana se va con ella.
  useEffect(() => () => ventana.current?.close(), []);

  return { contenedor, cerrar };
}

export function VentanaFlotante({
  contenedor,
  escenario,
  now,
  startAt,
  endAt,
  closesAt,
  extendida,
  manoDelOtro,
  quienMano,
  pendientes,
  miMano,
  onBajarManoDelOtro,
  onAlternarMiMano,
  micro,
  onVolver,
}: {
  contenedor: HTMLElement;
  /** Cámaras + lo compartido: `EscenarioSala` en compacto. */
  escenario: ReactNode;
  now: number;
  startAt: string;
  endAt: string;
  closesAt: string;
  extendida: boolean;
  manoDelOtro: boolean;
  quienMano: string;
  /** B8 · grupal: cuántas manos más esperan en la cola de la tutora. */
  pendientes?: number;
  miMano: boolean;
  onBajarManoDelOtro: () => void;
  /** B8 · sin él no hay botón de mano propia (la tutora de una grupal). */
  onAlternarMiMano?: () => void;
  /** `null` en la sala simulada: no hay micro que silenciar. */
  micro: { activo: boolean; alternar: () => void } | null;
  onVolver: () => void;
}) {
  const { transcurrido, hastaCierre, restante, fase } = estadoContador(now, startAt, endAt, closesAt, extendida);

  return createPortal(
    <div className="flex h-svh flex-col bg-[#14141a] text-white">
      <div className="relative min-h-0 flex-1 bg-[#0f0f14]">
        {escenario}

        <p
          className={cn(
            "absolute top-2 left-2 rounded-full px-2 py-0.5 font-mono text-xs tabular-nums",
            fase === "aviso"
              ? "bg-amber-500 text-black"
              : fase === "extendida"
                ? "bg-[#0080ff]"
                : fase === "extra"
                  ? "bg-[#fe6a00]"
                  : fase === "cerrada"
                    ? "bg-red-600"
                    : "bg-black/60",
          )}
        >
          {fase === "antes"
            ? "Aún no empieza"
            : fase === "extra"
              ? `Tiempo extra · cierra en ${reloj(hastaCierre)}`
              : fase === "aviso" || fase === "extendida"
                ? `${reloj(transcurrido)} · quedan ${reloj(restante)}`
                : reloj(transcurrido)}
        </p>

        {manoDelOtro ? (
          <div
            role="status"
            className="absolute inset-x-2 top-9 flex items-center justify-between gap-2 rounded-md bg-[#fe6a00] px-2 py-1.5 text-sm font-semibold text-white"
          >
            <span className="flex items-center gap-1.5">
              <HandIcon className="size-4" aria-hidden />
              {quienMano} levantó la mano
              {pendientes ? ` · ${pendientes} más esperando` : ""}
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
        {micro ? (
          <button
            type="button"
            onClick={micro.alternar}
            aria-label={micro.activo ? "Silenciar mi micrófono" : "Activar mi micrófono"}
            title={micro.activo ? "Silenciar" : "Activar micrófono"}
            className={cn(
              "rounded-full p-2",
              micro.activo ? "bg-[#26262f] hover:bg-[#3a3a45]" : "bg-red-600 hover:bg-red-700",
            )}
          >
            {micro.activo ? (
              <MicIcon className="size-4" aria-hidden />
            ) : (
              <MicOffIcon className="size-4" aria-hidden />
            )}
          </button>
        ) : null}
        {onAlternarMiMano ? (
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
        ) : null}
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
