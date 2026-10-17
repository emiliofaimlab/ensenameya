"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { MicOffIcon, MoreVerticalIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDesplegable } from "./barra-herramientas";
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

/** Lo que el tutor de una grupal puede hacer sobre la tesela de un alumno. */
export type AccionesTesela = {
  silenciar: () => void;
  sacar: () => void;
  /** M5 · el alumno entra sin poder compartir pantalla; se lo concede el tutor. */
  pantalla?: { permitida: boolean; alternar: () => void };
};

/**
 * La cámara de una persona. `acciones` solo llega para el tutor en una
 * grupal (RG-12: silenciar o sacar a alguien), que es lo que antes hacía la
 * lista de participantes de Prebuilt.
 *
 * P16 · el menú es el desplegable de la barra (`useDesplegable`): se cierra
 * con Escape o tocando fuera, así que abrir el de otra tesela cierra éste.
 * Antes era un `useState` suelto y podían quedar varios abiertos a la vez.
 */
export function Tesela({
  p,
  className,
  style,
  acciones,
}: {
  p: Participante;
  className?: string;
  /** B11 · el ancho que le da la galería. */
  style?: CSSProperties;
  acciones?: AccionesTesela;
}) {
  const { abierto, setAbierto, ref } = useDesplegable();
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // P16 · al abrir, el foco entra al menú (a la primera opción que se pueda
  // pulsar: «Silenciar» está deshabilitada si ya tiene el micro apagado).
  useEffect(() => {
    if (abierto) {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    }
  }, [abierto]);
  // B11 · con la galería sin scroll una tesela puede medir 160×90: el menú va
  // `fixed` (la tesela y la galería son `overflow-hidden` y lo recortaban) y
  // se coloca antes de pintar, hacia arriba si abajo no cabe. Sigue dentro del
  // árbol: hereda los colores de la sala, la pantalla completa y el «clic
  // fuera» de `useDesplegable`. Ojo: un `transform` en un ancestro lo rompería.
  useLayoutEffect(() => {
    const b = botonRef.current;
    const m = menuRef.current;
    if (!abierto || !b || !m) return;
    const win = b.ownerDocument.defaultView ?? window;
    const r = b.getBoundingClientRect();
    const abajo = r.bottom + 4;
    const top = abajo + m.offsetHeight > win.innerHeight - 8 ? Math.max(8, r.top - 4 - m.offsetHeight) : abajo;
    const left = Math.min(Math.max(8, r.right - m.offsetWidth), win.innerWidth - m.offsetWidth - 8);
    m.style.top = `${top}px`;
    m.style.left = `${left}px`;
  }, [abierto]);
  const cerrarY = (fn: () => void) => () => {
    setAbierto(false);
    fn();
  };
  return (
    <div
      style={style}
      className={cn(
        "relative overflow-hidden rounded-lg bg-[color:var(--sala-surface)]",
        className,
      )}
    >
      {p.video ? <Video track={p.video} espejo={p.local} /> : <Iniciales nombre={p.nombre} />}
      <p className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
        {/* P17 · el anfitrión se distingue (en 1:1 y en grupal el token del
            tutor es `is_owner`, y nadie más lo es). Va junto al nombre: arriba
            a la izquierda lo tapaba el contador cuando el tutor va primero. */}
        {p.owner ? (
          <span className="shrink-0 rounded bg-[#fe6a00] px-1 text-[11px] font-semibold">Tutor</span>
        ) : null}
        {!p.micro ? <MicOffIcon className="size-3 shrink-0 text-red-400" aria-label="Micrófono apagado" /> : null}
        <span className="truncate">{p.local ? `${p.nombre} (tú)` : p.nombre}</span>
      </p>
      {acciones ? (
        <div
          ref={ref}
          className="absolute top-1.5 right-1.5"
          onKeyDown={(e) => {
            // El desplegable ya se cierra con Escape (escucha en `document`);
            // aquí solo se devuelve el foco al botón que lo abrió.
            if (e.key === "Escape") botonRef.current?.focus();
          }}
        >
          <button
            ref={botonRef}
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={abierto}
            aria-label={`Opciones de ${p.nombre}`}
            className="rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <MoreVerticalIcon className="size-4" aria-hidden />
          </button>
          {abierto ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Opciones de ${p.nombre}`}
              style={{ top: 0, left: 0 }}
              className="fixed z-50 flex w-52 flex-col overflow-hidden rounded-md border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] text-sm shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                disabled={!p.micro}
                onClick={cerrarY(acciones.silenciar)}
                className="px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-40"
              >
                Silenciar
              </button>
              {acciones.pantalla ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={cerrarY(acciones.pantalla.alternar)}
                  className="px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                >
                  {acciones.pantalla.permitida
                    ? "Quitar permiso de pantalla"
                    : "Permitir compartir pantalla"}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAbierto(false);
                  if (window.confirm(`¿Sacar a ${p.nombre} de la sala?`)) acciones.sacar();
                }}
                className="px-3 py-2 text-left text-red-400 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
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
