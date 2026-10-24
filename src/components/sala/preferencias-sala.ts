"use client";

import { useSyncExternalStore } from "react";

/**
 * Lo que se elige en «Configuración» y NO vive en Daily: la salida de audio y
 * el espejo de la vista propia.
 *
 * · La SALIDA: en modo call object Daily no reproduce nada —el sonido de los
 *   demás lo ponen nuestros `<audio>` (`AudiosRemotos`, `tesela.tsx`)—, así
 *   que `setOutputDeviceAsync` solo deja a Daily al tanto. Quien cambia de
 *   verdad el altavoz es `setSinkId` sobre cada `<audio>`, y por eso el valor
 *   tiene que estar donde lo lean ellos, aunque se remonten. Solo en memoria:
 *   un `deviceId` guardado de otro día puede no existir ya.
 * · El ESPEJO: la vista propia se pinta volteada (como un espejo, lo normal
 *   en Meet o Zoom); quien escribe en una pizarra detrás suele preferirla
 *   sin voltear. Es solo cómo TE ves tú: a los demás les llega igual. Se
 *   recuerda en este navegador (`localStorage`, y si falla, no pasa nada).
 */
type Prefs = { salida: string; espejo: boolean };

const CLAVE_ESPEJO = "ey-sala-espejo";
const PREFS_SERVIDOR: Prefs = { salida: "", espejo: true };
let prefs: Prefs = { salida: "", espejo: leerEspejo() };
const oyentes = new Set<() => void>();

function leerEspejo() {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(CLAVE_ESPEJO) !== "0";
  } catch {
    return true;
  }
}

function cambiar(parcial: Partial<Prefs>) {
  prefs = { ...prefs, ...parcial };
  oyentes.forEach((o) => o());
}

function suscribir(o: () => void) {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}

export function usePrefsSala() {
  return useSyncExternalStore(
    suscribir,
    () => prefs,
    // En el servidor, el valor por defecto: la sala no se pinta en SSR viva.
    // Una constante: un objeto nuevo en cada llamada es un bucle de renders.
    () => PREFS_SERVIDOR,
  );
}

export function elegirSalida(salida: string) {
  cambiar({ salida });
}

export function elegirEspejo(espejo: boolean) {
  cambiar({ espejo });
  try {
    window.localStorage.setItem(CLAVE_ESPEJO, espejo ? "1" : "0");
  } catch {
    // Modo privado o almacenamiento bloqueado: vale para esta visita.
  }
}

/** Safari (y Firefox hasta hace poco) no eligen salida: ahí ni se ofrece. */
export function eligeSalida() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}
