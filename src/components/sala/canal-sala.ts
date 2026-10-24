import type { DailyCall, DailyEventObjectAppMessage } from "@daily-co/daily-js";

/**
 * EY-221 · El canal de la sala: mano levantada y presentación sincronizada.
 *
 * Va por `sendAppMessage` / `app-message` de Daily — SIN tabla ni servidor
 * nuevo. Es efímero a propósito: lo que se dibuja en una clase no se guarda, y
 * quien entra tarde lo pide al que ya está (`sync-request`, ver abajo).
 *
 * ── El protocolo ────────────────────────────────────────────────────────────
 *  · `sync-request` → lo manda cada participante al unirse. Quien tenga
 *    estado (mano arriba, presentación abierta) contesta reenviándolo. Lo
 *    mandan LOS DOS lados, así que da igual quién llegue primero, y también
 *    recupera al tutor si recarga mientras el alumno sigue dentro.
 *  · `mano` / `mano-bajar` → levantar/bajar la propia; pedir bajar la del otro.
 *    B8 · en una grupal `mano-bajar` lleva `a`: el `session_id` de Daily de
 *    quien debe bajarla (lo manda la tutora desde su cola; cada alumno solo
 *    obedece el que trae su id). Sin `a` es el 1:1 de siempre: lo baja el otro.
 *  · `pres` → {docId, página, alumnoAnota}. Con `reset` el receptor borra los
 *    trazos que tuviera antes de recibir los que siguen.
 *  · `trazo` → puntos que se AÑADEN al trazo `id` (lo crea si no existe). Se
 *    manda a trozos mientras se dibuja, así el otro lo ve aparecer en vivo.
 *  · `borrar-trazo`, `limpiar` → goma y «limpiar página».
 *  · `pres-fin` → se deja de presentar.
 *
 * ⚠️ Tamaño: Daily limita cada app-message a unos pocos KB, así que los trazos
 * NUNCA viajan enteros — ver `MAX_PUNTOS_POR_MENSAJE` en `use-presentacion.ts`.
 *
 * ⚠️ Daily no entrega a uno mismo sus propios mensajes: cada lado aplica su
 * cambio en local Y lo envía.
 */
export type Herramienta = "lapiz" | "resaltador";

export type MensajeSala =
  | { k: "sync-request" }
  | { k: "mano"; arriba: boolean }
  | { k: "mano-bajar"; a?: string }
  | {
      k: "pres";
      docId: string;
      nombre: string;
      pagina: number;
      alumnoAnota: boolean;
      reset?: boolean;
    }
  | { k: "pres-fin" }
  | {
      k: "trazo";
      id: string;
      p: number;
      c: string;
      h: Herramienta;
      /** x,y,x,y… en enteros 0..10000 (fracción de la página × 10⁴). */
      pts: number[];
    }
  | { k: "borrar-trazo"; id: string; p: number }
  | { k: "limpiar"; p: number };

/** Marca de los mensajes nuestros: Daily puede llevar otros por el mismo evento. */
const SELLO = "ey221";

type Sobre = { [SELLO]: 1; m: MensajeSala };

export type Oyente = (m: MensajeSala, de: string) => void;

export interface CanalSala {
  enviar(m: MensajeSala): void;
  escuchar(fn: Oyente): () => void;
}

function desensobrar(data: unknown): MensajeSala | null {
  if (!data || typeof data !== "object") return null;
  const s = data as Partial<Sobre>;
  if (s[SELLO] !== 1 || !s.m || typeof s.m !== "object") return null;
  return s.m;
}

/**
 * El canal sobre una llamada de Daily.
 *
 * ⚠️ `sendAppMessage` solo vale con la llamada unida; antes se encola y se
 * vacía en `joined-meeting`. Es lo que permite que los hooks manden su
 * `sync-request` en cuanto montan, sin saber en qué punto del `join` está.
 */
export function canalDaily(call: DailyCall): CanalSala & { cerrar(): void } {
  const oyentes = new Set<Oyente>();
  let cola: MensajeSala[] = [];

  const unido = () => {
    try {
      return call.meetingState() === "joined-meeting";
    } catch {
      return false;
    }
  };

  const mandar = (m: MensajeSala) => {
    try {
      call.sendAppMessage({ [SELLO]: 1, m } satisfies Sobre, "*");
    } catch (e) {
      console.warn("[sala] app-message no enviado:", e);
    }
  };

  const alMensaje = (e?: DailyEventObjectAppMessage) => {
    const m = desensobrar(e?.data);
    if (!m) return;
    oyentes.forEach((fn) => fn(m, e?.fromId ?? ""));
  };
  const alUnirse = () => {
    const pendientes = cola;
    cola = [];
    pendientes.forEach(mandar);
  };

  call.on("app-message", alMensaje);
  call.on("joined-meeting", alUnirse);

  return {
    enviar(m) {
      if (unido()) mandar(m);
      else cola.push(m);
    },
    escuchar(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    cerrar() {
      try {
        call.off("app-message", alMensaje);
        call.off("joined-meeting", alUnirse);
      } catch {
        /* la llamada ya se destruyó: no queda nada que soltar */
      }
      oyentes.clear();
      cola = [];
    },
  };
}

/**
 * El canal de la SALA SIMULADA (sin `DAILY_API_KEY`): `BroadcastChannel` entre
 * pestañas del mismo navegador. No es transporte de verdad —solo une pestañas
 * del mismo perfil—, pero deja probar la sincronización (presentación, trazos,
 * mano) abriendo la sala dos veces, sin Daily y sin servidor.
 */
export function canalSimulado(
  sessionId: string,
): CanalSala & { cerrar(): void; miId: string } {
  const yo = Math.random().toString(36).slice(2);
  const bc =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`ey-sala-sim:${sessionId}`);
  const oyentes = new Set<Oyente>();
  const alMensaje = (e: MessageEvent) => {
    const d = e.data as { de?: string; sobre?: unknown };
    if (!d || d.de === yo) return;
    const m = desensobrar(d.sobre);
    if (m) oyentes.forEach((fn) => fn(m, d.de ?? ""));
  };
  bc?.addEventListener("message", alMensaje);
  return {
    // B8 · sin Daily no hay `session_id`: es el id con el que los demás ven a
    // esta pestaña, y el que tiene que comparar `mano-bajar`.
    miId: yo,
    enviar(m) {
      bc?.postMessage({ de: yo, sobre: { [SELLO]: 1, m } satisfies Sobre });
    },
    escuchar(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    cerrar() {
      bc?.removeEventListener("message", alMensaje);
      bc?.close();
      oyentes.clear();
    },
  };
}
