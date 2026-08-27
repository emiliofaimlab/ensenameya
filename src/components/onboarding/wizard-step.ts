/**
 * M-03 · Dónde se quedó el asistente.
 *
 * El fallo reportado: sales del onboarding, vuelves y reapareces en "Paso 1 de
 * 3". Lo escrito seguía en la base (cada paso persiste al avanzar), pero el
 * número de paso vivía SOLO en `useState`, así que cualquier ida y vuelta lo
 * borraba y parecía que se había perdido todo.
 *
 * Se guarda en DOS sitios a propósito, y ninguno necesita migración:
 *
 *  · **La URL (`?paso=N`)** es el estado *direccionable*: recargar, abrir el
 *    enlace en otra pestaña o volver con el botón del navegador ya no
 *    reinician el asistente.
 *  · **La cookie** es el estado *duradero*: la cabecera ofrece "Guardar y
 *    salir" y lleva a `/`, así que al volver la URL ya no trae `?paso`. Sin la
 *    cookie el enlace seguiría mintiendo.
 *
 * Se descartó la columna `profiles.onboarding_step` porque exige migración (y
 * este carril no puede hacerlas). Su ventaja real sería cruzar de dispositivo;
 * si algún día se añade, manda ella y esto queda como respaldo — no al revés.
 *
 * ⚠️ Módulo NEUTRO (sin `"use client"`) a propósito: lo importan la página
 * (servidor, para el paso inicial) y el asistente (cliente, para recordarlo).
 * Exportado desde un fichero `"use client"`, el servidor recibiría una
 * *referencia de cliente* en vez del string del nombre de la cookie y leería
 * `undefined` — el mismo tropiezo que ya documenta `lib/tz.ts`.
 */

/** Cada asistente lleva su cuenta: el de alumno y el de tutor son distintos. */
export type WizardId = "alumno" | "tutor";

export const stepCookie = (wizard: WizardId) => `ey-onb-${wizard}`;

/** Un año: el asistente se abandona por semanas, no por minutos. */
const MAX_AGE = 31_536_000;

/** Número de paso válido dentro del asistente, o `null` si el valor no sirve. */
function parseStep(raw: string | null | undefined, total: number): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= total ? n : null;
}

/**
 * Paso con el que arranca el asistente. Manda la URL (es lo que el usuario
 * pidió explícitamente), luego la cookie y, si no hay nada usable, el 1.
 *
 * Se satura al rango [1, total] a propósito: `?paso=99` o una cookie de una
 * versión anterior con más pasos no deben dejar el asistente en blanco.
 */
export function resolveStep({
  param,
  cookie,
  total,
}: {
  param?: string | null;
  cookie?: string | null;
  total: number;
}): number {
  return parseStep(param, total) ?? parseStep(cookie, total) ?? 1;
}

/** Recuerda el paso (solo cliente; en servidor no hace nada). */
export function rememberStep(wizard: WizardId, step: number) {
  if (typeof document === "undefined") return;
  // Sin `Secure`: en local la app corre en http y la cookie no llegaría nunca.
  // No lleva nada sensible — es un número de paso.
  document.cookie = `${stepCookie(wizard)}=${step}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}

/** Olvida el paso: el asistente terminó y volver a entrar empieza de cero. */
export function forgetStep(wizard: WizardId) {
  if (typeof document === "undefined") return;
  document.cookie = `${stepCookie(wizard)}=; path=/; max-age=0; SameSite=Lax`;
}
