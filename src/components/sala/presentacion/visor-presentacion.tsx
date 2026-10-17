"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EraserIcon,
  HighlighterIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Herramienta } from "../canal-sala";
import { abrirMaterial } from "./pdf";
import type { Presentacion, Trazo } from "./use-presentacion";
import { usePistaDocumento } from "./use-pista-documento";

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
 *
 * Corrección 9 · sin barra de arriba. El paginador va abajo a la derecha y
 * solo aparece al pasar el ratón; abajo a la izquierda, un lápiz flotante que
 * enciende la anotación y abre sus opciones. «Dejar de presentar» vive en el
 * botón Compartir de la barra de controles.
 *
 * `mini`: la versión de la franja (corrección 10, cuando una pantalla
 * compartida pasa por delante), sin controles y sin dibujar.
 *
 * `call` (M30): solo el visor PRINCIPAL del tutor la recibe; con ella publica
 * el documento como pista para la grabación (`usePistaDocumento`).
 */
export function VisorPresentacion({
  pres,
  sessionId,
  isTutor,
  mini,
  call,
}: {
  pres: Presentacion;
  sessionId: string;
  isTutor: boolean;
  mini?: boolean;
  call?: DailyCall | null;
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
    // El de la ventana DUEÑA del nodo: en la ventana flotante el visor vive en
    // otro documento (Document Picture-in-Picture).
    const RO = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const ro = new RO(([e]) => {
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

  // M30 · mientras el tutor presenta, página + trazos van a la grabación.
  usePistaDocumento(call ?? null, isTutor && !mini && Boolean(call) && Boolean(docId), paginaRef, notasRef);

  const [util, setUtil] = useState<Util>("lapiz");
  // El lápiz flotante: encendido, el lienzo dibuja y se ven las opciones.
  const [anotando, setAnotando] = useState(false);
  const dibuja = pres.puedeAnotar && anotando && !mini;
  // El paginador aparece al mover el ratón o tocar y se esconde a los 2,5 s
  // (laboratorio de Emilio): así también existe en pantallas táctiles.
  const [paginador, setPaginador] = useState(false);
  const ocultar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mostrarPaginador = () => {
    setPaginador(true);
    if (ocultar.current) clearTimeout(ocultar.current);
    ocultar.current = setTimeout(() => setPaginador(false), 2500);
  };
  useEffect(() => () => {
    if (ocultar.current) clearTimeout(ocultar.current);
  }, []);
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
    if (!dibuja || e.button !== 0) return;
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
  //
  // En el DOCUMENTO y no en la página: tras elegir el material en «Compartir»
  // el foco se queda en la barra de controles, y un `onKeyDown` en la página
  // solo oía las flechas si antes se hacía clic en ella (que con el lápiz
  // encendido es dibujar). Se ignora lo que se escribe —el chat, un
  // `<select>`— y los atajos con modificador.
  const { irAPagina } = pres;
  useEffect(() => {
    if (!isTutor || !total || mini) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        if (pagina < total) irAPagina(pagina + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (pagina > 1) irAPagina(pagina - 1);
      }
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [isTutor, total, mini, pagina, irAPagina]);

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

  const IconoUtil =
    util === "resaltador" ? HighlighterIcon : util === "goma" ? EraserIcon : PencilIcon;

  return (
    <section
      aria-label={`Presentación: ${estado.nombre}`}
      onPointerMove={mini ? undefined : mostrarPaginador}
      onPointerDown={mini ? undefined : mostrarPaginador}
      className="relative flex size-full min-h-0 min-w-0 flex-col bg-[color:var(--sala-video)]"
    >
      {/* La página */}
      <div
        ref={zonaRef}
        tabIndex={isTutor && !mini ? 0 : -1}
        aria-label={
          isTutor && !mini
            ? "Página presentada. Usa las flechas para cambiar de página."
            : "Página presentada"
        }
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[#fe6a00]",
          mini ? "p-0.5" : "p-2",
        )}
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
              "absolute inset-0 size-full",
              dibuja && "touch-none",
              dibuja && (util === "goma" ? "cursor-cell" : "cursor-crosshair"),
            )}
          />
        </div>
      </div>

      {mini ? (
        <p
          className="pointer-events-none absolute top-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
          title={estado.nombre}
        >
          {estado.nombre}
        </p>
      ) : null}

      {mini ? null : (
        <>
          {/* Paginador: abajo a la derecha, con el nombre del documento dentro.
              Aparece al mover el ratón o tocar (y con el foco dentro). */}
          <div
            className={cn(
              "absolute right-3 bottom-3 z-20 flex max-w-[calc(100%-5rem)] items-center gap-1 rounded-full bg-black/75 py-1 pr-1 pl-3 text-xs text-white shadow-lg transition-opacity focus-within:pointer-events-auto focus-within:opacity-100",
              paginador ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <span className="min-w-0 truncate opacity-80" title={estado.nombre}>
              {estado.nombre}
            </span>
            <span aria-hidden className="mx-1 h-3.5 w-px bg-white/25" />
            {isTutor ? (
              <button
                type="button"
                onClick={() => pres.irAPagina(pagina - 1)}
                disabled={pagina <= 1}
                aria-label="Página anterior"
                className="rounded-full p-1 hover:bg-white/15 disabled:opacity-40"
              >
                <ChevronLeftIcon className="size-4" aria-hidden />
              </button>
            ) : null}
            <span className={cn("whitespace-nowrap tabular-nums", !isTutor && "pr-2")} aria-live="polite">
              {pagina}
              {total ? ` de ${total}` : ""}
            </span>
            {isTutor ? (
              <button
                type="button"
                onClick={() => pres.irAPagina(pagina + 1)}
                disabled={!total || pagina >= total}
                aria-label="Página siguiente"
                className="rounded-full p-1 hover:bg-white/15 disabled:opacity-40"
              >
                <ChevronRightIcon className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {/* El lápiz flotante: lleva el icono de la herramienta activa y un
              punto con el color; al pulsarlo enciende la anotación y abre sus
              opciones encima. Escape las cierra. */}
          {pres.puedeAnotar ? (
            <div className="absolute bottom-3 left-3 z-20 flex flex-col-reverse items-start gap-2">
              <button
                type="button"
                onClick={() => setAnotando((v) => !v)}
                aria-pressed={anotando}
                aria-label={anotando ? "Dejar de anotar" : "Anotar"}
                title={anotando ? "Dejar de anotar" : "Anotar"}
                className={cn(
                  "relative flex size-11 items-center justify-center rounded-full text-white shadow-lg transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
                  anotando ? "bg-[#fe6a00]" : "bg-black/70 hover:bg-black/85",
                )}
              >
                <IconoUtil className="size-5" aria-hidden />
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full border-2 border-[color:var(--sala-video)]"
                  style={{ backgroundColor: color }}
                />
              </button>
              {anotando ? (
                <div
                  role="toolbar"
                  aria-label="Herramientas de anotación"
                  onKeyDown={(e) => e.key === "Escape" && setAnotando(false)}
                  className="flex flex-col gap-2 rounded-xl border border-[color:var(--sala-border)] bg-[color:var(--sala-bg)]/95 p-2 text-xs text-[color:var(--sala-text)] shadow-xl"
                >
                  <div className="flex items-center gap-1">
                    {botonUtil("lapiz", "Lápiz", PencilIcon)}
                    {botonUtil("resaltador", "Resaltador", HighlighterIcon)}
                    {botonUtil("goma", "Borrar trazo", EraserIcon)}
                    {isTutor ? (
                      <button
                        type="button"
                        onClick={() => pres.limpiarPagina(pagina)}
                        aria-label="Limpiar la página"
                        title="Limpiar la página"
                        className="rounded-md p-1.5 hover:bg-white/10"
                      >
                        <Trash2Icon className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 px-0.5">
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
                          "size-6 rounded-full border-2",
                          color === c.valor ? "border-white" : "border-transparent",
                        )}
                        style={{ backgroundColor: c.valor }}
                      />
                    ))}
                  </div>
                  {isTutor ? (
                    <label className="flex cursor-pointer items-center gap-1.5 border-t border-[color:var(--sala-border)] px-0.5 pt-2">
                      <input
                        type="checkbox"
                        checked={estado.alumnoAnota}
                        onChange={(e) => pres.permitirAlumno(e.target.checked)}
                        className="accent-[#fe6a00]"
                      />
                      El alumno puede anotar
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
