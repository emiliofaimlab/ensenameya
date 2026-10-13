"use client";

import { useEffect, useRef, useState } from "react";
import { FileTextIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOTIVO_NO_PRESENTABLE } from "../formatos-presentables";
import type { MaterialDeSala } from "@/lib/sala/materiales";

type Carga =
  | { fase: "cargando" }
  | { fase: "error"; mensaje: string }
  | { fase: "lista"; materiales: MaterialDeSala[] };

/**
 * EY-221 · «Presentar material»: el tutor elige qué PDF de la mentoría
 * enseñar. Los Word/PowerPoint/Excel salen en la lista, deshabilitados, con el
 * motivo — así el tutor sabe qué hacer para poder presentarlos.
 *
 * ⚠️ Se pinta DENTRO del contenedor de la sala y no como diálogo de Radix: un
 * diálogo va por portal al `body` y en pantalla completa no se vería.
 */
export function PanelMateriales({
  sessionId,
  docActual,
  onElegir,
  onCerrar,
}: {
  sessionId: string;
  docActual: string | null;
  onElegir: (m: MaterialDeSala) => void;
  onCerrar: () => void;
}) {
  const [carga, setCarga] = useState<Carga>({ fase: "cargando" });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/room/${encodeURIComponent(sessionId)}/materiales`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as {
          materiales?: MaterialDeSala[];
          error?: string;
        };
        if (!vivo) return;
        if (!r.ok || !b.materiales) {
          setCarga({
            fase: "error",
            mensaje: b.error ?? "No pudimos cargar los materiales.",
          });
        } else {
          setCarga({ fase: "lista", materiales: b.materiales });
        }
      })
      .catch(() => {
        if (vivo) {
          setCarga({ fase: "error", mensaje: "No pudimos cargar los materiales." });
        }
      });
    return () => {
      vivo = false;
    };
  }, [sessionId]);

  // Foco dentro al abrir; Escape cierra.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Presentar material"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCerrar();
        }
      }}
      className="absolute top-12 right-3 z-30 flex max-h-[70%] w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-lg border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] text-[color:var(--sala-text)] shadow-xl outline-none"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--sala-border)] px-3 py-2">
        <h2 className="text-sm font-semibold">Presentar material</h2>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="rounded-md p-1 text-[color:var(--sala-supportive)] hover:bg-white/10 hover:text-[color:var(--sala-text)]"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto p-2">
        {carga.fase === "cargando" ? (
          <p className="p-2 text-sm text-[color:var(--sala-supportive)]">
            Cargando materiales…
          </p>
        ) : carga.fase === "error" ? (
          <p role="alert" className="p-2 text-sm text-red-300">
            {carga.mensaje}
          </p>
        ) : carga.materiales.length === 0 ? (
          <p className="p-2 text-sm text-[color:var(--sala-supportive)]">
            Esta mentoría no tiene materiales. Puedes subirlos (en PDF) desde
            el formulario de la mentoría.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {carga.materiales.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={!m.presentable}
                  onClick={() => onElegir(m)}
                  aria-current={docActual === m.id ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm",
                    m.presentable
                      ? "hover:bg-white/10 focus-visible:bg-white/10"
                      : "cursor-not-allowed opacity-60",
                    docActual === m.id && "bg-white/15",
                  )}
                >
                  <FileTextIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate">{m.nombre}</span>
                    {!m.presentable ? (
                      <span className="block text-xs text-[color:var(--sala-supportive)]">
                        {MOTIVO_NO_PRESENTABLE}
                      </span>
                    ) : docActual === m.id ? (
                      <span className="block text-xs text-[color:var(--sala-supportive)]">
                        Presentando ahora
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
