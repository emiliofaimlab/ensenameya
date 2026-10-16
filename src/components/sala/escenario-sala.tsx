"use client";

import type { ReactNode } from "react";
import { FileTextIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tesela, Video } from "./tesela";
import type { Participante } from "./use-participante-remoto";

type Acciones = { silenciar: () => void; sacar: () => void };

/**
 * Lo que se ve encima de la barra de controles (correcciones 7, 8 y 10).
 *
 * · Sin nada compartido: la rejilla de cámaras.
 * · Con algo compartido —pantalla o documento, el mismo trato—: lo ÚLTIMO
 *   ocupa el escenario y todo lo demás (lo compartido antes y las cámaras) va
 *   en una franja aparte, abajo en móvil y a la derecha en escritorio, para que
 *   nada tape lo que se está viendo.
 *
 * `compartidos` llega ya ordenado (`escenario.ts`): el último es el principal.
 * Se pinta igual en la sala y en la ventana flotante (`compacto`).
 *
 * Del laboratorio de Emilio: la franja se decide por el ancho del ESCENARIO
 * (container query `@container/area`), no de la pantalla — con el chat abierto
 * el escenario se estrecha y la franja baja sola; el documento, cuando no es lo
 * principal, va en la franja como TARJETA (nombre y página), no como miniatura
 * ilegible; y en 1:1 la tesela del otro está siempre, aunque no haya llegado.
 */
export function EscenarioSala({
  participantes,
  compartidos,
  documento,
  tarjetaDoc,
  ausente,
  acciones,
  compacto,
  vacio,
}: {
  participantes: Participante[];
  compartidos: string[];
  /** El visor del documento presentado, cuando es lo principal. */
  documento: ReactNode;
  /** Lo que dice la tarjeta del documento en la franja. */
  tarjetaDoc: { nombre: string; pagina: number } | null;
  /** 1:1 sin el otro: el rótulo de su tesela vacía («Esperando al alumno…»). */
  ausente?: string | null;
  acciones?: (p: Participante) => Acciones | undefined;
  compacto?: boolean;
  /** Lo que se pinta sin nadie en la llamada (sala simulada). */
  vacio?: ReactNode;
}) {
  const tesela = (p: Participante, className?: string) => (
    <Tesela key={p.id} p={p} acciones={acciones?.(p)} className={className} />
  );
  const teselas = (className: string) => [
    ...participantes.map((p) => tesela(p, className)),
    ausente && participantes.length > 0 ? (
      <div
        key="ausente"
        className={cn(
          "flex items-center justify-center rounded-lg border border-dashed border-[color:var(--sala-border)] p-2 text-center text-xs text-[color:var(--sala-supportive)]",
          className,
        )}
      >
        {ausente}
      </div>
    ) : null,
  ];

  if (compartidos.length === 0) {
    if (participantes.length === 0) return <>{vacio}</>;
    return (
      <div
        className={cn(
          "grid size-full content-center gap-2 overflow-auto p-2",
          compacto
            ? "grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))]"
            : "grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))]",
        )}
      >
        {teselas("aspect-video")}
      </div>
    );
  }

  const principal = compartidos[compartidos.length - 1];
  const anteriores = compartidos.slice(0, -1);
  const enFranja = compacto
    ? "aspect-video h-full shrink-0"
    : "aspect-video h-full shrink-0 @4xl/area:h-auto @4xl/area:w-full";

  const compartido = (clave: string, mini: boolean) => {
    if (clave === "doc") {
      return mini ? (
        <div
          key={clave}
          className={cn(
            "flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-[color:var(--sala-border)] bg-[color:var(--sala-surface)] p-2 text-center text-[11px] text-[color:var(--sala-supportive)]",
            enFranja,
          )}
        >
          <FileTextIcon className="size-5 text-white" aria-hidden />
          <span className="line-clamp-2 text-white">{tarjetaDoc?.nombre}</span>
          <span>Página {tarjetaDoc?.pagina}</span>
        </div>
      ) : (
        <div key={clave} className="relative size-full">
          {documento}
        </div>
      );
    }
    const p = participantes.find((x) => `pantalla:${x.id}` === clave);
    if (!p?.pantalla) return null;
    const rotulo = p.local ? "Estás compartiendo tu pantalla" : `Pantalla de ${p.nombre}`;
    return (
      <div
        key={clave}
        className={cn(
          "relative overflow-hidden bg-black",
          mini ? cn("rounded-lg", enFranja) : "size-full",
        )}
      >
        <Video track={p.pantalla} ajuste="contain" />
        <p className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {rotulo}
        </p>
      </div>
    );
  };

  return (
    <div className="@container/area size-full">
      <div className={cn("flex size-full flex-col", !compacto && "@4xl/area:flex-row")}>
        <div className="relative min-h-0 min-w-0 flex-1">{compartido(principal, false)}</div>
        <div
          aria-label="Cámaras"
          className={cn(
            "flex shrink-0 flex-row gap-2 overflow-auto p-2",
            compacto
              ? "h-20"
              : "h-28 border-t border-[color:var(--sala-border)] sm:h-32 @4xl/area:h-auto @4xl/area:w-64 @4xl/area:flex-col @4xl/area:border-t-0 @4xl/area:border-l",
          )}
        >
          {anteriores.map((c) => compartido(c, true))}
          {teselas(enFranja)}
        </div>
      </div>
    </div>
  );
}
