"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EraserIcon,
  HighlighterIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Herramienta } from "../canal-sala";
import { abrirMaterial } from "./pdf";
import type { Presentacion, Trazo } from "./use-presentacion";

/** Los tres colores de anotación. Rojo, el azul de marca y verde. */
const COLORES = [
  { valor: "#e5484d", nombre: "Rojo" },
  { valor: "#0080ff", nombre: "Azul" },
  { valor: "#16a34a", nombre: "Verde" },
] as const;

type Util = Herramienta | "goma";

/** Las coordenadas viajan como enteros 0..10000 sobre la página. */
const ESCALA = 10_000;
/** Distancia mínima entre puntos consecutivos: menos mensajes, mismo trazo. */
const PASO_MIN = 15;
/** Radio de la goma, en las mismas unidades. */
const RADIO_GOMA = 180;

function pintarTrazos(
  ctx: CanvasRenderingContext2D,
  trazos: Trazo[],
  w: number,
  h: number,
) {
  ctx.clearRect(0, 0, w, h);
  for (const t of trazos) {
    if (t.pts.length < 2) continue;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = t.c;
    if (t.h === "resaltador") {
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(10, w * 0.022);
    } else {
      ctx.lineWidth = Math.max(2, w * 0.0035);
    }
    ctx.beginPath();
    ctx.moveTo((t.pts[0] / ESCALA) * w, (t.pts[1] / ESCALA) * h);
    if (t.pts.length === 2) {
      // Un toque sin arrastre: un punto, no nada.
      ctx.lineTo((t.pts[0] / ESCALA) * w + 0.1, (t.pts[1] / ESCALA) * h);
    }
    for (let i = 2; i < t.pts.length; i += 2) {
      ctx.lineTo((t.pts[i] / ESCALA) * w, (t.pts[i + 1] / ESCALA) * h);
    }
    // Un solo `stroke()` por trazo: el resaltador no se oscurece donde el
    // trazo se cruza consigo mismo.
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * EY-221 · El visor del PDF que se presenta, con su capa de anotaciones.
 *
 * Dos lienzos superpuestos del mismo tamaño: abajo la página (pdf.js), arriba
 * los trazos. Así repintar un trazo nunca obliga a re-renderizar el PDF.
 *
 * El tutor pasa páginas (botones o flechas del teclado) y el alumno sigue la
 * misma; cada uno renderiza a SU tamaño de pantalla, por eso los trazos van en
 * coordenadas relativas a la página y no en píxeles.
 */
export function VisorPresentacion({
  pres,
  sessionId,
  isTutor,
  herramientas,
}: {
  pres: Presentacion;
  sessionId: string;
  isTutor: boolean;
  /** Contador y herramientas de la sala: mientras se presenta viven en ESTA
   *  barra, no sobre la franja de vídeo, que en escritorio mide 320px. */
  herramientas?: ReactNode;
}) {
  const estado = pres.estado;
  const docId = estado?.docId ?? null;
  const pagina = estado?.pagina ?? 1;

  // Documento cargado, con la clave de qué docId es: así no hace falta un
  // `setState(null)` síncrono al cambiar de material — si no coincide, no vale.
  const [cargado, setCargado] = useState<{
    docId: string;
    doc: PDFDocumentProxy | null;
    error: string | null;
  } | null>(null);
  const doc = cargado?.docId === docId ? cargado.doc : null;
  const error = cargado?.docId === docId ? cargado.error : null;

  useEffect(() => {
    if (!docId) return;
    let vivo = true;
    abrirMaterial(sessionId, docId).then(
      (d) => vivo && setCargado({ docId, doc: d, error: null }),
      (e: unknown) =>
        vivo &&
        setCargado({
          docId,
          doc: null,
          error:
            e instanceof Error ? e.message : "No pudimos abrir el material.",
        }),
    );
    return () => {
      vivo = false;
    };
  }, [sessionId, docId]);

  const total = doc?.numPages ?? 0;

  // ── Tamaño disponible ───────────────────────────────────────────────────
  const zonaRef = useRef<HTMLDivElement>(null);
  const [zona, setZona] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = zonaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setZona({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Render de la página ─────────────────────────────────────────────────
  const paginaRef = useRef<HTMLCanvasElement>(null);
  const [caja, setCaja] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!doc || zona.w < 10 || zona.h < 10) return;
    const n = Math.min(Math.max(1, pagina), doc.numPages);
    let tarea: RenderTask | null = null;
    let vivo = true;
    void (async () => {
      const page = await doc.getPage(n);
      if (!vivo) return;
      const base = page.getViewport({ scale: 1 });
      const escala = Math.min(zona.w / base.width, zona.h / base.height);
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: escala * dpr });
      const canvas = paginaRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const w = Math.floor(base.width * escala);
      const h = Math.floor(base.height * escala);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setCaja({ w, h });
      tarea = page.render({ canvas, viewport: vp });
      try {
        await tarea.promise;
      } catch {
        /* cancelado por una página nueva: es lo esperado */
      }
    })();
    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [doc, pagina, zona.w, zona.h]);

  // ── Capa de anotaciones ─────────────────────────────────────────────────
  const notasRef = useRef<HTMLCanvasElement>(null);
  const { trazosDe } = pres;
  const repintarNotas = useCallback(() => {
    const c = notasRef.current;
    if (!c || caja.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.floor(caja.w * dpr)) c.width = Math.floor(caja.w * dpr);
    if (c.height !== Math.floor(caja.h * dpr)) c.height = Math.floor(caja.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pintarTrazos(ctx, trazosDe(pagina), caja.w, caja.h);
  }, [caja.w, caja.h, pagina, trazosDe]);

  useEffect(() => {
    repintarNotas();
  }, [repintarNotas, pres.version]);

  const [util, setUtil] = useState<Util>("lapiz");
  const [color, setColor] = useState<string>(COLORES[0].valor);
  const dibujando = useRef<{ id: string | null; x: number; y: number } | null>(
    null,
  );

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * ESCALA),
      y: Math.round(Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) * ESCALA),
    };
  };

  const borrarEn = (x: number, y: number) => {
    for (const t of pres.trazosDe(pagina)) {
      if (!isTutor && !t.id.startsWith("a-")) continue;
      for (let i = 0; i < t.pts.length; i += 2) {
        if (Math.hypot(t.pts[i] - x, t.pts[i + 1] - y) < RADIO_GOMA) {
          pres.borrarTrazo(pagina, t.id);
          break;
        }
      }
    }
  };

  const alBajar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pres.puedeAnotar || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = punto(e);
    if (util === "goma") {
      dibujando.current = { id: null, x, y };
      borrarEn(x, y);
      return;
    }
    const id = pres.empezarTrazo(pagina, color, util, x, y);
    dibujando.current = { id, x, y };
    repintarNotas();
  };

  const alMover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dibujando.current;
    if (!d) return;
    const { x, y } = punto(e);
    if (Math.hypot(x - d.x, y - d.y) < PASO_MIN) return;
    d.x = x;
    d.y = y;
    if (d.id === null) {
      borrarEn(x, y);
      return;
    }
    pres.seguirTrazo(pagina, d.id, x, y);
    repintarNotas();
  };

  const alSoltar = () => {
    dibujando.current = null;
  };

  // ── Teclado (tutor): flechas y Av/Re Pág ────────────────────────────────
  const alTeclear = (e: React.KeyboardEvent) => {
    if (!isTutor || !total) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      if (pagina < total) pres.irAPagina(pagina + 1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      if (pagina > 1) pres.irAPagina(pagina - 1);
    }
  };

  // El padre solo monta el visor con una presentación abierta (el
  // `ResizeObserver` de arriba necesita que la zona exista desde el montaje).
  if (!estado) return null;

  const botonUtil = (u: Util, etiqueta: string, Icono: typeof PencilIcon) => (
    <button
      type="button"
      onClick={() => setUtil(u)}
      aria-pressed={util === u}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn(
        "rounded-md p-1.5 hover:bg-white/10",
        util === u && "bg-white/20",
      )}
    >
      <Icono className="size-4" aria-hidden />
    </button>
  );

  return (
    <section
      aria-label={`Presentación: ${estado.nombre}`}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[color:var(--sala-video)]"
    >
      {/* Barra de la presentación */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] px-3 py-1.5 text-xs text-[color:var(--sala-text)]">
        <p className="min-w-0 max-w-[40%] truncate font-medium" title={estado.nombre}>
          {estado.nombre}
        </p>

        <div className="flex items-center gap-1">
          {isTutor ? (
            <button
              type="button"
              onClick={() => pres.irAPagina(pagina - 1)}
              disabled={pagina <= 1}
              aria-label="Página anterior"
              className="rounded-md p-1 hover:bg-white/10 disabled:opacity-40"
            >
              <ChevronLeftIcon className="size-4" aria-hidden />
            </button>
          ) : null}
          <span className="tabular-nums" aria-live="polite">
            Página {pagina}
            {total ? ` de ${total}` : ""}
          </span>
          {isTutor ? (
            <button
              type="button"
              onClick={() => pres.irAPagina(pagina + 1)}
              disabled={!total || pagina >= total}
              aria-label="Página siguiente"
              className="rounded-md p-1 hover:bg-white/10 disabled:opacity-40"
            >
              <ChevronRightIcon className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        {pres.puedeAnotar ? (
          <div
            role="toolbar"
            aria-label="Herramientas de anotación"
            className="flex items-center gap-1"
          >
            {botonUtil("lapiz", "Lápiz", PencilIcon)}
            {botonUtil("resaltador", "Resaltador", HighlighterIcon)}
            {botonUtil("goma", "Borrar trazo", EraserIcon)}
            <span aria-hidden className="mx-1 h-4 w-px bg-white/20" />
            {COLORES.map((c) => (
              <button
                key={c.valor}
                type="button"
                onClick={() => {
                  setColor(c.valor);
                  if (util === "goma") setUtil("lapiz");
                }}
                aria-pressed={color === c.valor}
                aria-label={`Color ${c.nombre.toLowerCase()}`}
                title={c.nombre}
                className={cn(
                  "size-5 rounded-full border-2",
                  color === c.valor ? "border-white" : "border-transparent",
                )}
                style={{ backgroundColor: c.valor }}
              />
            ))}
            {isTutor ? (
              <button
                type="button"
                onClick={() => pres.limpiarPagina(pagina)}
                aria-label="Limpiar la página"
                title="Limpiar la página"
                className="ml-1 rounded-md p-1.5 hover:bg-white/10"
              >
                <Trash2Icon className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[color:var(--sala-supportive)]">
            Presenta el tutor
          </span>
        )}

        {isTutor ? (
          <div className="ml-auto flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={estado.alumnoAnota}
                onChange={(e) => pres.permitirAlumno(e.target.checked)}
                className="accent-[#fe6a00]"
              />
              El alumno puede anotar
            </label>
            <button
              type="button"
              onClick={pres.dejarDePresentar}
              className="inline-flex items-center gap-1 rounded-md border border-[color:var(--sala-border)] px-2 py-1 hover:bg-white/10"
            >
              <XIcon className="size-3.5" aria-hidden />
              Dejar de presentar
            </button>
          </div>
        ) : null}
        {herramientas ? (
          <div className={cn("flex items-center gap-2", !isTutor && "ml-auto")}>
            {herramientas}
          </div>
        ) : null}
      </div>

      {/* La página */}
      <div
        ref={zonaRef}
        tabIndex={isTutor ? 0 : -1}
        onKeyDown={alTeclear}
        aria-label={
          isTutor
            ? "Página presentada. Usa las flechas para cambiar de página."
            : "Página presentada"
        }
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 outline-none focus-visible:ring-2 focus-visible:ring-[#fe6a00]"
      >
        {error ? (
          <p className="max-w-sm text-center text-sm text-[color:var(--sala-supportive)]">
            {error}
          </p>
        ) : !doc ? (
          <p className="text-sm text-[color:var(--sala-supportive)]">
            Cargando el material…
          </p>
        ) : null}
        <div
          className={cn("relative bg-white shadow-lg", !doc && "hidden")}
          style={{ width: caja.w || undefined, height: caja.h || undefined }}
        >
          <canvas ref={paginaRef} className="block" aria-hidden />
          <canvas
            ref={notasRef}
            aria-hidden
            onPointerDown={alBajar}
            onPointerMove={alMover}
            onPointerUp={alSoltar}
            onPointerCancel={alSoltar}
            className={cn(
              "absolute inset-0 size-full touch-none",
              pres.puedeAnotar && (util === "goma" ? "cursor-cell" : "cursor-crosshair"),
            )}
          />
        </div>
      </div>
    </section>
  );
}
