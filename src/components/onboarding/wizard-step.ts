/**
 * Dónde arranca el asistente de onboarding.
 *
 * ⚠️ **28-ago-2026 · el cliente revirtió M-03.** Aquel cambio guardaba el paso
 * en una cookie para que salir y volver no reiniciara el asistente. En la demo
 * se leyó justo al revés —"cuando fui a tutor me saltó al paso 4 y con
 * estudiante al paso 3"— y la orden fue tajante: entrar al asistente empieza
 * **siempre** por el paso 1, tenga o no los campos llenos, sea tutor o alumno.
 *
 * Lo que NO cambia: los datos siguen persistiendo paso a paso en la base (cada
 * "Continuar" escribe, y `useSaveOnExit` guarda al salir por el header). Lo
 * único que se pierde es el marcador de por dónde ibas — el asistente se
 * recorre otra vez, con los campos ya rellenos.
 *
 * De M-03 sobrevive el espejo en la URL (`?paso=N`), porque no es la puerta de
 * entrada sino la navegación INTERNA del propio asistente: es lo que hace que
 * el botón "atrás" del navegador retroceda un paso en vez de sacarte, y que
 * recargar a media edición no te tire al principio. Entrar a `/onboarding` o a
 * `/tutor/onboarding` a pelo, sin parámetro, da el paso 1.
 *
 * La cookie `ey-onb-*` ya no se escribe. Sigue aquí `forgetStep` porque las que
 * se escribieron antes tienen un año de vida por delante: el asistente las
 * borra al montarse para que no queden rondando (y para que nadie las
 * resucite leyéndolas otra vez).
 *
 * ⚠️ Módulo NEUTRO (sin `"use client"`) a propósito: lo importan la página
 * (servidor, para el paso inicial) y el asistente (cliente, para la limpieza).
 * Exportado desde un fichero `"use client"`, el servidor recibiría una
 * *referencia de cliente* en vez del string del nombre de la cookie y leería
 * `undefined` — el mismo tropiezo que ya documenta `lib/tz.ts`.
 */

/** Cada asistente lleva su cuenta: el de alumno y el de tutor son distintos. */
export type WizardId = "alumno" | "tutor";

export const stepCookie = (wizard: WizardId) => `ey-onb-${wizard}`;

/** Número de paso válido dentro del asistente, o `null` si el valor no sirve. */
function parseStep(raw: string | null | undefined, total: number): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= total ? n : null;
}

/**
 * Paso con el que arranca el asistente: el de la URL si lo hay, y si no el 1.
 *
 * Se satura al rango [1, total] a propósito: un `?paso=99` escrito a mano —o el
 * que dejó una versión del asistente con más pasos— no debe dejar la pantalla
 * en blanco.
 */
export function resolveStep({
  param,
  total,
}: {
  param?: string | null;
  total: number;
}): number {
  return parseStep(param, total) ?? 1;
}

/**
 * Borra la cookie de paso heredada de M-03 (solo cliente; en servidor no hace
 * nada). Ya nadie la lee: esto es la limpieza del rastro que dejó.
 */
export function forgetStep(wizard: WizardId) {
  if (typeof document === "undefined") return;
  document.cookie = `${stepCookie(wizard)}=; path=/; max-age=0; SameSite=Lax`;
}
