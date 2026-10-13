"use client";

import {
  HandIcon,
  MaximizeIcon,
  MinimizeIcon,
  PictureInPicture2Icon,
  PresentationIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * EY-221 · Los botones de la sala que van SOBRE el vídeo: presentar material
 * (tutor), levantar la mano, ventana flotante y pantalla completa.
 *
 * Van aquí y no en la cabecera blanca porque en pantalla completa la cabecera
 * desaparece: el contenedor que se agranda es el del vídeo, y los controles
 * tienen que venir con él. La mano además está en la barra de Daily (botón
 * custom, como el chat); aquí está su gemelo, alcanzable con teclado y lector
 * de pantalla y presente también en la sala simulada.
 */
function Boton({
  etiqueta,
  activo,
  onClick,
  children,
  pulsable = true,
}: {
  etiqueta: string;
  activo?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** `aria-pressed` solo para los interruptores de verdad. */
  pulsable?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      aria-pressed={pulsable ? Boolean(activo) : undefined}
      title={etiqueta}
      className={cn(
        "rounded-full p-2 text-white shadow-md backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
        activo ? "bg-[#fe6a00] hover:bg-[#e55f00]" : "bg-black/60 hover:bg-black/80",
      )}
    >
      {children}
    </button>
  );
}

export function BarraHerramientas({
  isTutor,
  panelMaterialesAbierto,
  presentando,
  onPresentar,
  manoArriba,
  onMano,
  flotante,
  pantalla,
  className,
}: {
  isTutor: boolean;
  panelMaterialesAbierto: boolean;
  presentando: boolean;
  onPresentar: () => void;
  manoArriba: boolean;
  onMano: () => void;
  flotante: { soportada: boolean; abierta: boolean; alternar: () => void };
  pantalla: { soportada: boolean; activa: boolean; alternar: () => void };
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Herramientas de la sala"
      className={cn("flex items-center gap-1.5", className)}
    >
      {isTutor ? (
        <Boton
          etiqueta={presentando ? "Cambiar el material presentado" : "Presentar material"}
          activo={panelMaterialesAbierto || presentando}
          pulsable={false}
          onClick={onPresentar}
        >
          <PresentationIcon className="size-4" aria-hidden />
        </Boton>
      ) : null}
      <Boton
        etiqueta={manoArriba ? "Bajar la mano" : "Levantar la mano"}
        activo={manoArriba}
        onClick={onMano}
      >
        <HandIcon className="size-4" aria-hidden />
      </Boton>
      {flotante.soportada ? (
        <Boton
          etiqueta={flotante.abierta ? "Cerrar la ventana flotante" : "Ventana flotante"}
          activo={flotante.abierta}
          onClick={flotante.alternar}
        >
          <PictureInPicture2Icon className="size-4" aria-hidden />
        </Boton>
      ) : null}
      {pantalla.soportada ? (
        <Boton
          etiqueta={pantalla.activa ? "Salir de pantalla completa" : "Pantalla completa"}
          activo={pantalla.activa}
          onClick={pantalla.alternar}
        >
          {pantalla.activa ? (
            <MinimizeIcon className="size-4" aria-hidden />
          ) : (
            <MaximizeIcon className="size-4" aria-hidden />
          )}
        </Boton>
      ) : null}
    </div>
  );
}

/** El indicador de «levantó la mano», sobre el vídeo. */
export function AvisoMano({
  quien,
  onBajar,
  className,
}: {
  quien: string;
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
      <span>{quien} levantó la mano</span>
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
