"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { DailyBrowserInfo, DailyCall } from "@daily-co/daily-js";
import {
  CheckIcon,
  ChevronUpIcon,
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
  UsersIcon,
  VideoIcon,
  VideoOffIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { elegirEspejo, elegirSalida, eligeSalida, usePrefsSala } from "./preferencias-sala";

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
 * detrás (ver `use-pantalla-completa.ts`). Por lo mismo «Configuración» es un
 * `<dialog>` NATIVO y no el `Dialog` de `components/ui`: ese es de Radix y va
 * por portal; el nativo con `showModal()` sube a la capa superior del
 * navegador, que se pinta por encima de la pantalla completa.
 *
 * Rediseño de Emilio (24-oct), estilo Meet:
 * · UN solo botón de silenciar. Para el tutor de una grupal despliega «Yo» o
 *   «Sala»; antes eran dos botones con el mismo icono y confundían.
 * · El selector de micro y cámara sale de «Ajustes» y se pega a sus botones,
 *   como una flechita (`FlechaDispositivos`).
 * · «Configuración» abre un modal con eso y con lo de Daily (supresión de
 *   ruido, desenfoque, altavoz) y el espejo.
 * · «Salir», del todo a la derecha.
 * · Pantalla completa sale de la barra cuando hay algo compartido: va sobre el
 *   escenario, abajo a la derecha (`escenario-sala.tsx`).
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
  menu,
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
  /** Qué abre: un menú o un diálogo (`aria-haspopup`). */
  menu?: "menu" | "dialog";
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
      aria-haspopup={menu}
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
    const tecla = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);
  return { abierto, setAbierto, ref };
}

const OPCIONES = '[role^="menuitem"]:not(:disabled)';

/**
 * El menú de un botón de la barra. Con teclado: al abrir, el foco entra (a la
 * opción marcada, si la hay); flechas, Inicio y Fin se mueven por él; Escape
 * lo cierra (`useDesplegable`) y el foco VUELVE al botón que lo abrió.
 *
 * ⚠️ El contenedor de cada botón con menú es `sm:relative`, no `relative`: en
 * móvil el menú se ancla a la BARRA (que sí es `relative`) y sale centrado en
 * la pantalla. Anclado al botón, el del micro —el primero— salía cortado por
 * la izquierda: 16 rem no caben a la izquierda de un botón de 40 px.
 */
function Menu({
  children,
  className,
  etiqueta,
  listo = true,
}: {
  children: ReactNode;
  className?: string;
  etiqueta: string;
  /** `false` mientras carga (dispositivos): el foco entra cuando haya opciones. */
  listo?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = ref.current?.ownerDocument ?? document;
    const previo = doc.activeElement as HTMLElement | null;
    return () => {
      // Cerrado con Escape o eligiendo: el foco se quedó en el aire (`body`).
      // Si se cerró tocando otro botón, ese ya lo tiene y no se le quita.
      if (!doc.activeElement || doc.activeElement === doc.body) previo?.focus();
    };
  }, []);
  useEffect(() => {
    const m = ref.current;
    if (!listo || !m || m.contains(m.ownerDocument.activeElement)) return;
    (m.querySelector<HTMLElement>('[aria-checked="true"]') ?? m.querySelector<HTMLElement>(OPCIONES))?.focus();
  }, [listo]);
  const mover = (e: KeyboardEvent<HTMLDivElement>) => {
    const lista = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(OPCIONES));
    if (lista.length === 0) return;
    const i = lista.indexOf(e.target as HTMLElement);
    const destino =
      e.key === "ArrowDown"
        ? lista[(i + 1) % lista.length]
        : e.key === "ArrowUp"
          ? lista[(i - 1 + lista.length) % lista.length]
          : e.key === "Home"
            ? lista[0]
            : e.key === "End"
              ? lista[lista.length - 1]
              : null;
    if (!destino) return;
    e.preventDefault();
    destino.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={etiqueta}
      onKeyDown={mover}
      className={cn(
        "absolute bottom-full left-1/2 z-30 mb-2 flex max-h-[min(24rem,60svh)] w-64 max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col overflow-y-auto rounded-lg border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] py-1 text-sm text-[color:var(--sala-text)] shadow-xl",
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
  marcado,
}: {
  icono?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  /** Lista de dispositivos: una opción de varias (`menuitemradio`). */
  marcado?: boolean;
}) {
  const radio = marcado !== undefined;
  return (
    <button
      type="button"
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? marcado : undefined}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
    >
      {radio ? (
        <CheckIcon className={cn("size-4 shrink-0", !marcado && "invisible")} aria-hidden />
      ) : (
        icono
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

function Encabezado({ children }: { children: ReactNode }) {
  return (
    <p role="presentation" className="px-3 pt-2 pb-1 text-xs font-semibold text-[color:var(--sala-supportive)]">
      {children}
    </p>
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
    <div ref={ref} className="sm:relative">
      <Boton
        etiqueta="Compartir"
        rotulo="Compartir"
        activo={activo}
        pulsable={false}
        expandido={abierto}
        menu="menu"
        onClick={() => setAbierto((v) => !v)}
      >
        <MonitorUpIcon className="size-5" aria-hidden />
      </Boton>
      {abierto ? (
        <Menu etiqueta="Compartir">
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

// ── Dispositivos ────────────────────────────────────────────────────────────

type Dispositivos = {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  /** Vacía donde el navegador no elige salida (Safari): ahí no se ofrece. */
  salidas: MediaDeviceInfo[];
  mic: string;
  cam: string;
};

/**
 * Lo que antes daba el selector de dispositivos de Prebuilt. Se lee al ABRIR
 * (flechita o Configuración) y no al montar: así recoge el auricular que se
 * enchufó a mitad de clase sin escuchar `available-devices-updated`.
 */
function useDispositivos(call: DailyCall | null) {
  const [disp, setDisp] = useState<Dispositivos | null>(null);

  async function cargar() {
    if (!call) return;
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
        salidas: eligeSalida() ? devices.filter((x) => x.kind === "audiooutput") : [],
        mic: id(actuales.mic),
        cam: id(actuales.camera),
      });
    } catch (e) {
      console.warn("[sala] dispositivos:", e);
    }
  }

  function usarMic(id: string) {
    setDisp((d) => (d ? { ...d, mic: id } : d));
    void call?.setInputDevicesAsync({ audioDeviceId: id }).catch((e: unknown) => console.warn("[sala] micrófono:", e));
  }
  function usarCam(id: string) {
    setDisp((d) => (d ? { ...d, cam: id } : d));
    void call?.setInputDevicesAsync({ videoDeviceId: id }).catch((e: unknown) => console.warn("[sala] cámara:", e));
  }
  /** Daily se entera (`setOutputDeviceAsync`), pero quien suena son nuestros
   *  `<audio>`: el cambio real es `setSinkId` (`preferencias-sala.ts`). */
  function usarSalida(id: string) {
    elegirSalida(id);
    void call?.setOutputDeviceAsync({ outputDeviceId: id }).catch((e: unknown) => console.warn("[sala] salida:", e));
  }

  return { disp, cargar, usarMic, usarCam, usarSalida };
}

/** El texto de un dispositivo: sin permiso el navegador no da nombres. */
const nombreDe = (x: MediaDeviceInfo, rotulo: string, i: number) => x.label || `${rotulo} ${i + 1}`;

/** «default» es la salida del sistema en Chrome; `""` significa la misma. */
const salidaMarcada = (x: MediaDeviceInfo, salida: string) => x.deviceId === (salida || "default");

/**
 * La flechita de Meet: pegada a la esquina del botón de micro o de cámara,
 * abre la lista de dispositivos de ese tipo (en el micro, también el altavoz,
 * como hace Meet). No va dentro del `Boton` —un botón no puede contener otro—
 * sino al lado, montada sobre su esquina con margen negativo.
 */
function FlechaDispositivos({ call, tipo }: { call: DailyCall; tipo: "audio" | "video" }) {
  const { abierto, setAbierto, ref } = useDesplegable();
  const { disp, cargar, usarMic, usarCam, usarSalida } = useDispositivos(call);
  const { salida } = usePrefsSala();
  const nombre = tipo === "audio" ? "Elegir micrófono y altavoz" : "Elegir cámara";
  const elegirY = (fn: (id: string) => void, id: string) => () => {
    setAbierto(false);
    fn(id);
  };
  return (
    <div ref={ref} className="-ml-4 mt-5 sm:-ml-7 sm:mt-[22px]">
      <button
        type="button"
        aria-label={nombre}
        title={nombre}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => {
          setAbierto(!abierto);
          if (!abierto) void cargar();
        }}
        className="relative z-10 flex size-5 items-center justify-center rounded-full bg-[#3a3a45] text-white ring-2 ring-[color:var(--sala-bg)] hover:bg-[#4a4a57] focus-visible:ring-white focus-visible:outline-none"
      >
        <ChevronUpIcon className="size-3.5" aria-hidden />
      </button>
      {abierto ? (
        <Menu etiqueta={nombre} listo={disp !== null} className="w-72">
          {!disp ? (
            <p className="px-3 py-2 text-[color:var(--sala-supportive)]">Cargando…</p>
          ) : tipo === "audio" ? (
            <>
              <Encabezado>Micrófono</Encabezado>
              {disp.mics.map((x, i) => (
                <Opcion key={x.deviceId || i} marcado={x.deviceId === disp.mic} onClick={elegirY(usarMic, x.deviceId)}>
                  {nombreDe(x, "Micrófono", i)}
                </Opcion>
              ))}
              {disp.salidas.length > 0 ? (
                <>
                  <Encabezado>Altavoz</Encabezado>
                  {disp.salidas.map((x, i) => (
                    <Opcion
                      key={x.deviceId || i}
                      marcado={salidaMarcada(x, salida)}
                      onClick={elegirY(usarSalida, x.deviceId)}
                    >
                      {nombreDe(x, "Altavoz", i)}
                    </Opcion>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <>
              <Encabezado>Cámara</Encabezado>
              {disp.cams.map((x, i) => (
                <Opcion key={x.deviceId || i} marcado={x.deviceId === disp.cam} onClick={elegirY(usarCam, x.deviceId)}>
                  {nombreDe(x, "Cámara", i)}
                </Opcion>
              ))}
            </>
          )}
          {disp && (tipo === "audio" ? disp.mics : disp.cams).length === 0 ? (
            <p className="px-3 py-2 text-[color:var(--sala-supportive)]">
              No se encontró ningún dispositivo.
            </p>
          ) : null}
        </Menu>
      ) : null}
    </div>
  );
}

/**
 * EL botón de silenciar. Antes el tutor de una grupal tenía dos con el mismo
 * icono —su micro y «Silenciar a todos»— y no se sabía cuál era cuál. Ahora es
 * uno: para él despliega «Yo» (su micro) o «Sala» (todos menos él, M5); para
 * todos los demás sigue siendo un botón que alterna, sin menú de por medio.
 */
function BotonMicro({
  micro,
  silenciarTodos,
  call,
}: {
  micro: { activo: boolean; alternar: () => void };
  silenciarTodos?: () => void;
  call: DailyCall | null;
}) {
  const { abierto, setAbierto, ref } = useDesplegable();
  const icono = micro.activo ? <MicIcon className="size-5" aria-hidden /> : <MicOffIcon className="size-5" aria-hidden />;
  const cerrarY = (fn: () => void) => () => {
    setAbierto(false);
    fn();
  };
  return (
    <div className="flex items-start sm:relative">
      {silenciarTodos ? (
        <div ref={ref}>
          <Boton
            etiqueta="Silenciar: a mí o a la sala"
            rotulo={micro.activo ? "Silenciar" : "Activar"}
            apagado={!micro.activo}
            pulsable={false}
            expandido={abierto}
            menu="menu"
            onClick={() => setAbierto((v) => !v)}
          >
            {icono}
          </Boton>
          {abierto ? (
            <Menu etiqueta="Silenciar">
              <Opcion icono={icono} onClick={cerrarY(micro.alternar)}>
                <span className="block font-semibold">Yo</span>
                <span className="block text-xs text-[color:var(--sala-supportive)]">
                  {micro.activo ? "Silenciar mi micrófono" : "Activar mi micrófono"}
                </span>
              </Opcion>
              <Opcion icono={<UsersIcon className="size-5" aria-hidden />} onClick={cerrarY(silenciarTodos)}>
                <span className="block font-semibold">Sala</span>
                <span className="block text-xs text-[color:var(--sala-supportive)]">
                  Silenciar a todos los demás
                </span>
              </Opcion>
            </Menu>
          ) : null}
        </div>
      ) : (
        <Boton
          etiqueta={micro.activo ? "Silenciar el micrófono" : "Activar el micrófono"}
          rotulo={micro.activo ? "Silenciar" : "Activar"}
          apagado={!micro.activo}
          pulsable={false}
          onClick={micro.alternar}
        >
          {icono}
        </Boton>
      )}
      {call ? <FlechaDispositivos call={call} tipo="audio" /> : null}
    </div>
  );
}

function BotonCamara({
  camara,
  call,
}: {
  camara: { activo: boolean; alternar: () => void };
  call: DailyCall | null;
}) {
  return (
    <div className="flex items-start sm:relative">
      <Boton
        etiqueta={camara.activo ? "Apagar la cámara" : "Encender la cámara"}
        rotulo="Cámara"
        apagado={!camara.activo}
        pulsable={false}
        onClick={camara.alternar}
      >
        {camara.activo ? <VideoIcon className="size-5" aria-hidden /> : <VideoOffIcon className="size-5" aria-hidden />}
      </Boton>
      {call ? <FlechaDispositivos call={call} tipo="video" /> : null}
    </div>
  );
}

// ── Configuración ───────────────────────────────────────────────────────────

/** Qué procesa este navegador. `supportedBrowser` es estático de Daily: se
 *  importa al abrir, como hace la sala con `createCallObject`. */
let navegador: Promise<DailyBrowserInfo | null> | null = null;
function infoNavegador() {
  navegador ??= import("@daily-co/daily-js")
    .then((m) => m.default.supportedBrowser())
    .catch(() => null);
  return navegador;
}

function Interruptor({
  rotulo,
  detalle,
  activo,
  ocupado,
  onCambiar,
}: {
  rotulo: string;
  detalle?: string;
  activo: boolean;
  ocupado?: boolean;
  onCambiar: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span className="flex flex-col">
        <span>{rotulo}</span>
        {detalle ? <span className="text-xs text-[color:var(--sala-supportive)]">{detalle}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={activo}
        disabled={ocupado}
        onChange={(e) => onCambiar(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-white peer-disabled:opacity-50",
          activo ? "bg-[#fe6a00]" : "bg-[#3a3a45]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform",
            activo && "translate-x-4",
          )}
        />
      </span>
    </label>
  );
}

function Selector({
  rotulo,
  lista,
  valor,
  cambiar,
}: {
  rotulo: string;
  lista: MediaDeviceInfo[];
  valor: string;
  cambiar: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[color:var(--sala-supportive)]">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        className="rounded-md border border-[color:var(--sala-border)] bg-[color:var(--sala-surface)] px-2 py-1.5 text-sm text-white focus-visible:ring-2 focus-visible:ring-[#fe6a00] focus-visible:outline-none"
      >
        {lista.map((x, i) => (
          <option key={x.deviceId || i} value={x.deviceId}>
            {nombreDe(x, rotulo, i)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * «Configuración»: ya no es un desplegable sino un modal. Lo de antes (micro y
 * cámara), el altavoz, y lo que Daily procesa en el navegador:
 *
 * · Supresión de ruido — `updateInputSettings({ audio: { processor: { type:
 *   "noise-cancellation" } } })`. Daily lo hace en el navegador (Krisp) y solo
 *   donde `supportedBrowser().supportsAudioProcessing`.
 * · Desenfoque de fondo — `updateInputSettings({ video: { processor: { type:
 *   "background-blur" } } })`, donde `supportsVideoProcessing` (en móvil no).
 *   A los demás les llega ya desenfocado: es la pista que se publica.
 * · Altavoz — solo donde el navegador elige salida (`setSinkId`); en Safari
 *   la fila no se pinta.
 * · Espejo — solo cómo te ves tú (`preferencias-sala.ts`).
 *
 * Lo que este navegador no soporta NO se pinta, ni deshabilitado: un
 * interruptor que no hace nada es peor que no tenerlo. En la sala simulada
 * (`call === null`) no hay dispositivos y queda solo el espejo.
 *
 * El estado de los procesadores se LEE de Daily al abrir (`getInputSettings`):
 * no se guarda aquí, porque Daily los conserva aunque cambies de cámara.
 */
function BotonConfiguracion({ call }: { call: DailyCall | null }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const { disp, cargar, usarMic, usarCam, usarSalida } = useDispositivos(call);
  const { salida, espejo } = usePrefsSala();
  const [soporte, setSoporte] = useState<{ audio: boolean; video: boolean } | null>(null);
  const [ruido, setRuido] = useState(false);
  const [desenfoque, setDesenfoque] = useState(false);
  const [ocupado, setOcupado] = useState<"ruido" | "desenfoque" | null>(null);

  async function abrir() {
    dialogo.current?.showModal();
    setAbierto(true);
    if (!call) return;
    void cargar();
    const [info, ajustes] = await Promise.all([
      infoNavegador(),
      call.getInputSettings().catch(() => null),
    ]);
    setSoporte({
      audio: Boolean(info?.supportsAudioProcessing),
      video: Boolean(info?.supportsVideoProcessing),
    });
    setRuido(ajustes?.audio?.processor?.type === "noise-cancellation");
    setDesenfoque(ajustes?.video?.processor?.type === "background-blur");
  }

  async function procesar(cual: "ruido" | "desenfoque", v: boolean) {
    if (!call) return;
    const poner = cual === "ruido" ? setRuido : setDesenfoque;
    poner(v);
    setOcupado(cual);
    try {
      await call.updateInputSettings(
        cual === "ruido"
          ? { audio: { processor: { type: v ? "noise-cancellation" : "none" } } }
          : { video: { processor: v ? { type: "background-blur", config: { strength: 0.6 } } : { type: "none" } } },
      );
    } catch (e) {
      // Falló (p. ej. el modelo no cargó): el interruptor vuelve a como estaba.
      console.warn(`[sala] ${cual}:`, e);
      poner(!v);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <Boton
        etiqueta="Configuración"
        rotulo="Ajustes"
        pulsable={false}
        expandido={abierto}
        menu="dialog"
        onClick={() => void abrir()}
      >
        <SettingsIcon className="size-5" aria-hidden />
      </Boton>
      {/* Escape lo cierra el propio `<dialog>` (evento `cancel` → `close`), y
          al cerrar el navegador devuelve el foco al botón. Tocar el fondo
          también cierra: el clic cae en el `<dialog>` mismo, no en su caja. */}
      <dialog
        ref={dialogo}
        aria-labelledby="sala-configuracion-titulo"
        onClose={() => setAbierto(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-auto w-[min(28rem,calc(100%-2rem))] max-h-[85svh] overflow-hidden rounded-xl border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] p-0 text-sm text-[color:var(--sala-text)] shadow-2xl backdrop:bg-black/60"
      >
        {/* Siempre montado (cerrado no se ve): así `showModal()` encuentra ya
            el botón de cerrar y el foco entra en él. */}
        <div className="flex max-h-[85svh] flex-col">
          <div className="flex items-center justify-between border-b border-[color:var(--sala-border)] px-4 py-3">
            <h2 id="sala-configuracion-titulo" className="text-base font-semibold">
              Configuración
            </h2>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => dialogo.current?.close()}
              className="-mr-1.5 flex size-9 items-center justify-center rounded-full hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 py-4">
            {!call ? (
              <p className="text-[color:var(--sala-supportive)]">
                En la sala simulada no hay micrófono, cámara ni altavoz que configurar.
              </p>
            ) : (
              <section className="flex flex-col gap-3" aria-label="Dispositivos">
                {!disp ? (
                  <p className="text-[color:var(--sala-supportive)]">Cargando dispositivos…</p>
                ) : (
                  <>
                    <Selector rotulo="Micrófono" lista={disp.mics} valor={disp.mic} cambiar={usarMic} />
                    {disp.salidas.length > 0 ? (
                      <Selector
                        rotulo="Altavoz"
                        lista={disp.salidas}
                        valor={disp.salidas.find((x) => salidaMarcada(x, salida))?.deviceId ?? ""}
                        cambiar={usarSalida}
                      />
                    ) : null}
                    <Selector rotulo="Cámara" lista={disp.cams} valor={disp.cam} cambiar={usarCam} />
                  </>
                )}
              </section>
            )}
            <section className="flex flex-col divide-y divide-[color:var(--sala-border)]" aria-label="Audio y video">
              {call && soporte?.audio ? (
                <Interruptor
                  rotulo="Supresión de ruido"
                  detalle="Filtra el ruido de fondo: teclado, ventilador, la calle."
                  activo={ruido}
                  ocupado={ocupado === "ruido"}
                  onCambiar={(v) => void procesar("ruido", v)}
                />
              ) : null}
              {call && soporte?.video ? (
                <Interruptor
                  rotulo="Desenfocar el fondo"
                  detalle="Los demás te ven nítido y lo de atrás borroso."
                  activo={desenfoque}
                  ocupado={ocupado === "desenfoque"}
                  onCambiar={(v) => void procesar("desenfoque", v)}
                />
              ) : null}
              <Interruptor
                rotulo="Verme en espejo"
                detalle="Solo cambia cómo te ves tú; a los demás les llega igual."
                activo={espejo}
                onCambiar={elegirEspejo}
              />
            </section>
          </div>
        </div>
      </dialog>
    </>
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
  /** `enEscenario`: hay algo compartido y el botón va sobre el escenario
   *  (`EscenarioSala`), no aquí. */
  pantalla: { soportada: boolean; activa: boolean; alternar: () => void; enEscenario?: boolean };
  /** `null` en la sala simulada: no hay dispositivos que cambiar. */
  call: DailyCall | null;
  onSalir: () => void;
  /** M5 · solo el tutor de una grupal: silencia a todos menos a él. Con ella
   *  el botón del micro despliega «Yo» / «Sala». */
  silenciarTodos?: () => void;
  /** P43 · «clase» en una grupal, «mentoría» en 1:1. */
  sustantivo?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Controles de la sala"
      className="relative flex shrink-0 items-center gap-1 border-t border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] px-2 py-2 sm:px-3"
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

      {/* En móvil este grupo ocupa lo que deja «Salir» y se centra en ello;
          desde `sm` se queda en el medio entre los dos `flex-1`. */}
      <div className="flex flex-1 items-start justify-center gap-1 sm:flex-none sm:gap-1.5">
        <BotonMicro micro={micro} silenciarTodos={silenciarTodos} call={call} />
        <BotonCamara camara={camara} call={call} />
        <BotonCompartir compartir={compartir} sustantivo={sustantivo} />
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
        {/* También en la sala simulada: el modal sabe que no hay dispositivos. */}
        <BotonConfiguracion call={call} />
        {/* Con algo compartido se va al escenario (abajo a la derecha de lo
            compartido), que es donde se mira cuando se quiere agrandar. */}
        {pantalla.soportada && !pantalla.enEscenario ? (
          <Boton
            etiqueta={pantalla.activa ? "Salir de pantalla completa" : "Pantalla completa"}
            rotulo="Pantalla"
            activo={pantalla.activa}
            onClick={pantalla.alternar}
          >
            {pantalla.activa ? <MinimizeIcon className="size-5" aria-hidden /> : <MaximizeIcon className="size-5" aria-hidden />}
          </Boton>
        ) : null}
      </div>

      {/* «Salir», del todo a la derecha y separado del resto: lejos del micro
          para no colgar por error. Es también el contrapeso del aviso de
          grabación que deja los botones centrados en escritorio. */}
      <div className="flex justify-end sm:flex-1">
        <Boton etiqueta="Salir de la sala" rotulo="Salir" peligro pulsable={false} onClick={onSalir}>
          <PhoneOffIcon className="size-5" aria-hidden />
        </Boton>
      </div>
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
