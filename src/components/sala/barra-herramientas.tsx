"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import {
  FileTextIcon,
  HandIcon,
  MaximizeIcon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  MonitorUpIcon,
  PhoneOffIcon,
  SettingsIcon,
  VideoIcon,
  VideoOffIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * La barra de controles de la sala (correcciones 1–4, 7 y 9).
 *
 * Desde que la sala dejó Daily Prebuilt esta barra es NUESTRA: siempre a todo
 * el ancho y siempre abajo, con o sin presentación, y lo compartido se acomoda
 * encima. Es lo que antes se repartía entre la barra de Daily (dentro de su
 * iframe), la cabecera blanca («Mostrar chat») y los botones flotantes sobre el
 * vídeo (mano, presentar, ventana flotante, pantalla completa).
 *
 * ⚠️ Sus menús se pintan DENTRO de la barra y no por portal: la barra vive en
 * el contenedor que va a pantalla completa, y un portal al `body` quedaría
 * detrás (ver `use-pantalla-completa.ts`).
 */
function Boton({
  etiqueta,
  rotulo,
  activo,
  peligro,
  apagado,
  onClick,
  children,
  pulsable = true,
  expandido,
  id,
}: {
  etiqueta: string;
  /** Texto corto bajo el icono (desde `sm`). */
  rotulo: string;
  activo?: boolean;
  /** Micro o cámara apagados: en rojo, como en cualquier sala. */
  apagado?: boolean;
  peligro?: boolean;
  onClick: () => void;
  children: ReactNode;
  pulsable?: boolean;
  expandido?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      aria-pressed={pulsable ? Boolean(activo) : undefined}
      aria-expanded={expandido}
      title={etiqueta}
      className="group relative flex flex-col items-center gap-0.5 rounded-lg px-0.5 text-[10px] text-[color:var(--sala-supportive)] focus-visible:outline-none sm:w-16"
    >
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-full text-white sm:size-10 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-white",
          peligro
            ? "bg-red-600 group-hover:bg-red-700"
            : apagado
              ? "bg-red-600/90 group-hover:bg-red-600"
              : activo
                ? "bg-[#fe6a00] group-hover:bg-[#e55f00]"
                : "bg-[color:var(--sala-surface)] group-hover:bg-[#3a3a45]",
        )}
      >
        {children}
      </span>
      <span className="hidden truncate sm:block">{rotulo}</span>
    </button>
  );
}

/**
 * Un desplegable pegado a su botón: se cierra tocando fuera o con Escape.
 * P16 · también lo usa el menú de cada tesela (`tesela.tsx`).
 */
export function useDesplegable() {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);
  return { abierto, setAbierto, ref };
}

function Menu({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="menu"
      className={cn(
        "absolute bottom-full left-1/2 z-30 mb-2 flex w-64 -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] py-1 text-sm text-[color:var(--sala-text)] shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Opcion({
  icono,
  children,
  onClick,
}: {
  icono: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/10"
    >
      {icono}
      {children}
    </button>
  );
}

/**
 * Corrección 4 · «Compartir» despliega: 1. Pantalla · 2. Documentos de la
 * mentoría (o de la clase, P43). Y dentro está también el «dejar de…» de cada uno (corrección 9:
 * «Dejar de presentar» se fue de la barra del PDF).
 */
export type Compartir = {
  /** `undefined` si el navegador no comparte pantalla (móvil). */
  pantalla?: { activa: boolean; alternar: () => void };
  /** Solo el tutor presenta documentos. */
  documentos?: { presentando: boolean; elegir: () => void; dejar: () => void };
};

function BotonCompartir({
  compartir,
  sustantivo,
}: {
  compartir: Compartir;
  sustantivo: string;
}) {
  const { abierto, setAbierto, ref } = useDesplegable();
  const { pantalla, documentos } = compartir;
  if (!pantalla && !documentos) return null;
  const activo = Boolean(pantalla?.activa || documentos?.presentando);
  const cerrarY = (fn: () => void) => () => {
    setAbierto(false);
    fn();
  };
  return (
    <div ref={ref} className="relative">
      <Boton
        etiqueta="Compartir"
        rotulo="Compartir"
        activo={activo}
        pulsable={false}
        expandido={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <MonitorUpIcon className="size-5" aria-hidden />
      </Boton>
      {abierto ? (
        <Menu>
          {pantalla ? (
            <Opcion
              icono={pantalla.activa ? <XIcon className="size-4" aria-hidden /> : <MonitorUpIcon className="size-4" aria-hidden />}
              onClick={cerrarY(pantalla.alternar)}
            >
              {pantalla.activa ? "Dejar de compartir pantalla" : "Pantalla"}
            </Opcion>
          ) : null}
          {documentos ? (
            <>
              <Opcion
                icono={<FileTextIcon className="size-4" aria-hidden />}
                onClick={cerrarY(documentos.elegir)}
              >
                {documentos.presentando ? "Cambiar de documento" : `Documentos de la ${sustantivo}`}
              </Opcion>
              {documentos.presentando ? (
                <Opcion icono={<XIcon className="size-4" aria-hidden />} onClick={cerrarY(documentos.dejar)}>
                  Dejar de presentar
                </Opcion>
              ) : null}
            </>
          ) : null}
        </Menu>
      ) : null}
    </div>
  );
}

/** Micro y cámara: lo que antes daba el selector de dispositivos de Prebuilt. */
function BotonAjustes({ call }: { call: DailyCall }) {
  const { abierto, setAbierto, ref } = useDesplegable();
  const [disp, setDisp] = useState<{
    mics: MediaDeviceInfo[];
    cams: MediaDeviceInfo[];
    mic: string;
    cam: string;
  } | null>(null);

  async function abrir() {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (!nuevo) return;
    try {
      const [{ devices }, actuales] = await Promise.all([
        call.enumerateDevices(),
        call.getInputDevices(),
      ]);
      const id = (x: unknown) =>
        x && typeof x === "object" && "deviceId" in x ? String((x as { deviceId: string }).deviceId) : "";
      setDisp({
        mics: devices.filter((x) => x.kind === "audioinput"),
        cams: devices.filter((x) => x.kind === "videoinput"),
        mic: id(actuales.mic),
        cam: id(actuales.camera),
      });
    } catch (e) {
      console.warn("[sala] dispositivos:", e);
    }
  }

  const selector = (
    rotulo: string,
    lista: MediaDeviceInfo[],
    valor: string,
    cambiar: (id: string) => void,
  ) => (
    <label className="flex flex-col gap-1 px-3 py-2 text-xs text-[color:var(--sala-supportive)]">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        className="rounded-md border border-[color:var(--sala-border)] bg-[color:var(--sala-surface)] px-2 py-1.5 text-sm text-white"
      >
        {lista.map((x, i) => (
          <option key={x.deviceId || i} value={x.deviceId}>
            {x.label || `${rotulo} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div ref={ref} className="relative">
      <Boton
        etiqueta="Micrófono y cámara"
        rotulo="Ajustes"
        pulsable={false}
        expandido={abierto}
        onClick={() => void abrir()}
      >
        <SettingsIcon className="size-5" aria-hidden />
      </Boton>
      {abierto ? (
        <Menu className="w-72">
          {!disp ? (
            <p className="px-3 py-2 text-[color:var(--sala-supportive)]">Cargando…</p>
          ) : (
            <>
              {selector("Micrófono", disp.mics, disp.mic, (id) => {
                setDisp({ ...disp, mic: id });
                void call.setInputDevicesAsync({ audioDeviceId: id });
              })}
              {selector("Cámara", disp.cams, disp.cam, (id) => {
                setDisp({ ...disp, cam: id });
                void call.setInputDevicesAsync({ videoDeviceId: id });
              })}
            </>
          )}
        </Menu>
      ) : null}
    </div>
  );
}

export function BarraControles({
  grabando,
  micro,
  camara,
  compartir,
  mano,
  chat,
  pantalla,
  call,
  onSalir,
  silenciarTodos,
  sustantivo = "mentoría",
}: {
  grabando: boolean;
  micro: { activo: boolean; alternar: () => void };
  camara: { activo: boolean; alternar: () => void };
  compartir: Compartir;
  /** B8 · sin ella no hay botón: la tutora de una grupal no levanta la mano. */
  mano?: { arriba: boolean; alternar: () => void };
  chat: { abierto: boolean; sinLeer: number; alternar: () => void };
  pantalla: { soportada: boolean; activa: boolean; alternar: () => void };
  /** `null` en la sala simulada: no hay dispositivos que cambiar. */
  call: DailyCall | null;
  onSalir: () => void;
  /** M5 · solo el tutor de una grupal: silencia a todos menos a él. */
  silenciarTodos?: () => void;
  /** P43 · «clase» en una grupal, «mentoría» en 1:1. */
  sustantivo?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Controles de la sala"
      className="relative flex shrink-0 items-center justify-center gap-1 border-t border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] px-2 py-2 sm:px-3"
    >
      {/* El reloj ya no va aquí: flota sobre el escenario (`ContadorClase`).
          En móvil no caben ocho botones y un rótulo: el aviso de grabación
          queda en un punto en la esquina, con su texto para el lector. */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-2 sm:static sm:flex-1">
        {grabando ? (
          // RN-42: la clase se graba siempre y se avisa. Prebuilt lo pintaba
          // solo; ahora es nuestro.
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-[color:var(--sala-supportive)]">
            <span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            <span className="sr-only sm:not-sr-only">Grabando</span>
          </span>
        ) : null}
      </div>

      <div className="flex items-start gap-1 sm:gap-1.5">
        <Boton
          etiqueta={micro.activo ? "Silenciar el micrófono" : "Activar el micrófono"}
          rotulo={micro.activo ? "Silenciar" : "Activar"}
          apagado={!micro.activo}
          pulsable={false}
          onClick={micro.alternar}
        >
          {micro.activo ? <MicIcon className="size-5" aria-hidden /> : <MicOffIcon className="size-5" aria-hidden />}
        </Boton>
        <Boton
          etiqueta={camara.activo ? "Apagar la cámara" : "Encender la cámara"}
          rotulo="Cámara"
          apagado={!camara.activo}
          pulsable={false}
          onClick={camara.alternar}
        >
          {camara.activo ? <VideoIcon className="size-5" aria-hidden /> : <VideoOffIcon className="size-5" aria-hidden />}
        </Boton>
        <BotonCompartir compartir={compartir} sustantivo={sustantivo} />
        {silenciarTodos ? (
          <Boton
            etiqueta="Silenciar a todos"
            rotulo="Silenciar"
            pulsable={false}
            onClick={silenciarTodos}
          >
            <MicOffIcon className="size-5" aria-hidden />
          </Boton>
        ) : null}
        {mano ? (
          <Boton
            etiqueta={mano.arriba ? "Bajar la mano" : "Levantar la mano"}
            rotulo="Mano"
            activo={mano.arriba}
            onClick={mano.alternar}
          >
            <HandIcon className="size-5" aria-hidden />
          </Boton>
        ) : null}
        <Boton
          id="boton-chat-sala"
          etiqueta={
            chat.sinLeer > 0
              ? `Chat, ${chat.sinLeer === 1 ? "1 mensaje" : `${chat.sinLeer} mensajes`} sin leer`
              : chat.abierto
                ? "Ocultar el chat"
                : "Mostrar el chat"
          }
          rotulo="Chat"
          activo={chat.abierto}
          onClick={chat.alternar}
        >
          <MessageSquareIcon className="size-5" aria-hidden />
          {chat.sinLeer > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-[#fe6a00] px-1 text-[10px] leading-4 font-bold text-white"
            >
              {chat.sinLeer > 9 ? "9+" : chat.sinLeer}
            </span>
          ) : null}
        </Boton>
        {call ? <BotonAjustes call={call} /> : null}
        {/* Corrección 3 · a la izquierda de «Salir». */}
        {pantalla.soportada ? (
          <Boton
            etiqueta={pantalla.activa ? "Salir de pantalla completa" : "Pantalla completa"}
            rotulo="Pantalla"
            activo={pantalla.activa}
            onClick={pantalla.alternar}
          >
            {pantalla.activa ? <MinimizeIcon className="size-5" aria-hidden /> : <MaximizeIcon className="size-5" aria-hidden />}
          </Boton>
        ) : null}
        <Boton etiqueta="Salir de la sala" rotulo="Salir" peligro pulsable={false} onClick={onSalir}>
          <PhoneOffIcon className="size-5" aria-hidden />
        </Boton>
      </div>

      {/* Contrapeso del reloj: deja los botones centrados en escritorio. */}
      <div className="hidden sm:block sm:flex-1" aria-hidden />
    </div>
  );
}

/** El indicador de «levantó la mano», sobre el escenario. */
export function AvisoMano({
  quien,
  pendientes,
  onBajar,
  className,
}: {
  quien: string;
  /** B8 · grupal: cuántas manos más esperan detrás de esta en la cola. */
  pendientes?: number;
  onBajar: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 rounded-full bg-[#fe6a00] py-1.5 pr-1.5 pl-3 text-sm font-semibold whitespace-nowrap text-white shadow-lg",
        className,
      )}
    >
      <HandIcon className="size-4 animate-bounce" aria-hidden />
      <span>
        {quien} levantó la mano{pendientes ? ` · ${pendientes} más esperando` : ""}
      </span>
      <button
        type="button"
        onClick={onBajar}
        className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs hover:bg-white/30 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        Bajar
      </button>
    </div>
  );
}
