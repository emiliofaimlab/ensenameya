"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CanalSala, Herramienta, MensajeSala } from "../canal-sala";

/**
 * EY-221 · El estado de la presentación y su sincronización.
 *
 * El TUTOR manda: abre el documento, pasa páginas, limpia y decide si el
 * alumno puede anotar. El alumno sigue. Estado mínimo, como se pidió:
 * `{docId, página, trazos por página}` (+ el interruptor del alumno).
 *
 * Los trazos se guardan en una ref y no en estado: llegan a trozos, ~20 por
 * segundo mientras alguien dibuja, y reconstruir objetos inmutables en cada uno
 * no aporta nada. `version` es lo que avisa al visor de que hay que repintar.
 */

export type Trazo = {
  id: string;
  c: string;
  h: Herramienta;
  /** x,y,x,y… en enteros 0..10000 sobre la página. */
  pts: number[];
};

export type EstadoPresentacion = {
  docId: string;
  nombre: string;
  pagina: number;
  alumnoAnota: boolean;
};

/**
 * ⚠️ Daily corta los app-message de más de unos KB. 300 enteros de hasta 5
 * cifras son ~2 KB de JSON: margen de sobra. Un trazo largo viaja en varios
 * mensajes con el mismo `id` y el receptor los concatena.
 */
const MAX_NUMEROS_POR_MENSAJE = 300;
/** Cada cuánto se manda lo dibujado: lo bastante rápido para verse «en vivo». */
const CADENCIA_MS = 50;
/** El tutor que recarga acepta que el alumno le devuelva la presentación. */
const VENTANA_RESTAURAR_MS = 8000;

export function usePresentacion({
  canal,
  isTutor,
}: {
  canal: CanalSala | null;
  isTutor: boolean;
}) {
  const [estado, setEstado] = useState<EstadoPresentacion | null>(null);
  const [version, setVersion] = useState(0);
  const estadoRef = useRef<EstadoPresentacion | null>(null);
  const trazos = useRef(new Map<number, Map<string, Trazo>>());
  const pendientes = useRef(new Map<string, { p: number; pts: number[] }>());
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restaurarHasta = useRef(0);

  const repintar = useCallback(() => setVersion((v) => v + 1), []);

  const fijarEstado = useCallback((e: EstadoPresentacion | null) => {
    estadoRef.current = e;
    setEstado(e);
  }, []);

  const trazosDe = useCallback((p: number): Trazo[] => {
    const m = trazos.current.get(p);
    return m ? [...m.values()] : [];
  }, []);

  // ── Envío a trozos ──────────────────────────────────────────────────────
  const vaciar = useCallback(() => {
    temporizador.current = null;
    if (!canal) {
      pendientes.current.clear();
      return;
    }
    pendientes.current.forEach(({ p, pts }, id) => {
      const t = trazos.current.get(p)?.get(id);
      if (!t) return;
      for (let i = 0; i < pts.length; i += MAX_NUMEROS_POR_MENSAJE) {
        canal.enviar({
          k: "trazo",
          id,
          p,
          c: t.c,
          h: t.h,
          pts: pts.slice(i, i + MAX_NUMEROS_POR_MENSAJE),
        });
      }
    });
    pendientes.current.clear();
  }, [canal]);

  const programarEnvio = useCallback(() => {
    temporizador.current ??= setTimeout(vaciar, CADENCIA_MS);
  }, [vaciar]);

  /** Reenvía TODO (para quien entra tarde o para el tutor que recarga). */
  const enviarTodo = useCallback(() => {
    const e = estadoRef.current;
    if (!canal || !e) return;
    canal.enviar({ k: "pres", ...e, reset: true });
    trazos.current.forEach((porId, p) => {
      porId.forEach((t) => {
        for (let i = 0; i < t.pts.length; i += MAX_NUMEROS_POR_MENSAJE) {
          canal.enviar({
            k: "trazo",
            id: t.id,
            p,
            c: t.c,
            h: t.h,
            pts: t.pts.slice(i, i + MAX_NUMEROS_POR_MENSAJE),
          });
        }
      });
    });
  }, [canal]);

  // ── Recepción ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canal) return;
    // El tutor que llega sin presentación abierta (p. ej. recargó) admite unos
    // segundos que el alumno le devuelva la que tenía. El `sync-request` lo
    // manda la sala justo después de montar esto.
    if (isTutor && !estadoRef.current) {
      restaurarHasta.current = Date.now() + VENTANA_RESTAURAR_MS;
    }

    const aplicar = (m: MensajeSala) => {
      const e = estadoRef.current;
      const restaurando = isTutor && Date.now() < restaurarHasta.current;
      switch (m.k) {
        case "sync-request":
          if (e) enviarTodo();
          return;
        case "pres": {
          // El tutor no obedece al alumno… salvo para recuperar lo perdido.
          if (isTutor && !(restaurando && !e)) return;
          if (m.reset || !e || e.docId !== m.docId) trazos.current.clear();
          fijarEstado({
            docId: m.docId,
            nombre: m.nombre,
            pagina: m.pagina,
            alumnoAnota: m.alumnoAnota,
          });
          repintar();
          return;
        }
        case "pres-fin":
          if (isTutor) return;
          trazos.current.clear();
          fijarEstado(null);
          repintar();
          return;
        case "trazo": {
          if (!e) return;
          // Del alumno solo se aceptan trazos si el tutor lo permitió (o si
          // está devolviendo la presentación al tutor que recargó).
          if (isTutor && !e.alumnoAnota && !restaurando) return;
          let porId = trazos.current.get(m.p);
          if (!porId) trazos.current.set(m.p, (porId = new Map()));
          const t = porId.get(m.id);
          if (t) t.pts.push(...m.pts);
          else porId.set(m.id, { id: m.id, c: m.c, h: m.h, pts: [...m.pts] });
          repintar();
          return;
        }
        case "borrar-trazo":
          // El alumno solo puede borrar lo suyo (ids `a-…`).
          if (isTutor && (!e?.alumnoAnota || !m.id.startsWith("a-"))) return;
          trazos.current.get(m.p)?.delete(m.id);
          repintar();
          return;
        case "limpiar":
          if (isTutor) return;
          trazos.current.delete(m.p);
          repintar();
          return;
      }
    };
    return canal.escuchar(aplicar);
  }, [canal, isTutor, enviarTodo, fijarEstado, repintar]);

  // Al desmontar, lo que quedara a medio enviar se descarta con la llamada.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  // ── Acciones del tutor ──────────────────────────────────────────────────
  const presentar = useCallback(
    (docId: string, nombre: string) => {
      if (!isTutor) return;
      trazos.current.clear();
      const e = { docId, nombre, pagina: 1, alumnoAnota: false };
      fijarEstado(e);
      repintar();
      canal?.enviar({ k: "pres", ...e, reset: true });
    },
    [canal, isTutor, fijarEstado, repintar],
  );

  const dejarDePresentar = useCallback(() => {
    if (!isTutor) return;
    trazos.current.clear();
    fijarEstado(null);
    repintar();
    canal?.enviar({ k: "pres-fin" });
  }, [canal, isTutor, fijarEstado, repintar]);

  const actualizar = useCallback(
    (cambio: Partial<Pick<EstadoPresentacion, "pagina" | "alumnoAnota">>) => {
      const e = estadoRef.current;
      if (!isTutor || !e) return;
      const nuevo = { ...e, ...cambio };
      fijarEstado(nuevo);
      canal?.enviar({ k: "pres", ...nuevo });
    },
    [canal, isTutor, fijarEstado],
  );

  const irAPagina = useCallback(
    (pagina: number) => actualizar({ pagina }),
    [actualizar],
  );
  const permitirAlumno = useCallback(
    (alumnoAnota: boolean) => actualizar({ alumnoAnota }),
    [actualizar],
  );

  const limpiarPagina = useCallback(
    (p: number) => {
      if (!isTutor) return;
      trazos.current.delete(p);
      repintar();
      canal?.enviar({ k: "limpiar", p });
    },
    [canal, isTutor, repintar],
  );

  // ── Dibujo (los dos, si el alumno tiene permiso) ────────────────────────
  const puedeAnotar = isTutor || Boolean(estado?.alumnoAnota);

  const empezarTrazo = useCallback(
    (p: number, c: string, h: Herramienta, x: number, y: number): string => {
      const id = `${isTutor ? "t" : "a"}-${Math.random().toString(36).slice(2, 10)}`;
      let porId = trazos.current.get(p);
      if (!porId) trazos.current.set(p, (porId = new Map()));
      porId.set(id, { id, c, h, pts: [x, y] });
      pendientes.current.set(id, { p, pts: [x, y] });
      programarEnvio();
      return id;
    },
    [isTutor, programarEnvio],
  );

  const seguirTrazo = useCallback(
    (p: number, id: string, x: number, y: number) => {
      const t = trazos.current.get(p)?.get(id);
      if (!t) return;
      t.pts.push(x, y);
      const pend = pendientes.current.get(id);
      if (pend) pend.pts.push(x, y);
      else pendientes.current.set(id, { p, pts: [x, y] });
      programarEnvio();
    },
    [programarEnvio],
  );

  const borrarTrazo = useCallback(
    (p: number, id: string) => {
      if (!isTutor && !id.startsWith("a-")) return;
      trazos.current.get(p)?.delete(id);
      pendientes.current.delete(id);
      repintar();
      canal?.enviar({ k: "borrar-trazo", id, p });
    },
    [canal, isTutor, repintar],
  );

  return {
    estado,
    version,
    trazosDe,
    puedeAnotar,
    presentar,
    dejarDePresentar,
    irAPagina,
    permitirAlumno,
    limpiarPagina,
    empezarTrazo,
    seguirTrazo,
    borrarTrazo,
  };
}

export type Presentacion = ReturnType<typeof usePresentacion>;
