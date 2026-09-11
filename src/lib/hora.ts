/**
 * ── 12 H O 24 H, LA PREFERENCIA DE QUIEN MIRA ───────────────────────────────
 *
 * Módulo NEUTRO —sin `server-only`, sin `"use client"`, sin imports— por lo
 * mismo que `lib/dinero.ts` y `lib/tz.ts`: lo leen los Server Components, el
 * conmutador del navegador y `node` a pelo vía `lib/booking.ts`. Si el nombre
 * de la cookie viviera en un fichero `"use client"`, el import desde un Server
 * Component recibiría una *referencia de cliente* en vez del string y la
 * lectura saldría `undefined` — es la trampa que documenta `lib/tz.ts`.
 *
 * 🔴 LO QUE ESTO NO TOCA: los CORREOS. Un correo se compone en un job, sin
 * navegador y sin cookie, y su hora se congela cuando se encola. Se quedan en
 * 24 h, que es lo que pinta el sitio por defecto. Cambiar eso sería llevar la
 * preferencia a `profiles`, y es otra conversación.
 */

export const HORA_COOKIE = "ey-h12";

/** `"12"` = 1:30 p. m. · `"24"` = 13:30. El sitio arranca en 24 h. */
export type FormatoHora = "12" | "24";

export const FORMATO_POR_DEFECTO: FormatoHora = "24";

/** Un valor de cookie cualquiera → formato, cayendo al de por defecto. */
export function formatoDeCookie(valor: string | null | undefined): FormatoHora {
  return valor?.trim() === "12" ? "12" : FORMATO_POR_DEFECTO;
}

/**
 * Deja la preferencia en la cookie, desde el navegador.
 *
 * Vive aquí y no en el conmutador por dos motivos, y el segundo no es de estilo:
 *
 *  1. El nombre, la duración y las banderas de la cookie se escriben UNA vez, al
 *     lado de quien la lee. Un año, como `ey-tz`: es una preferencia, no una
 *     sesión. `SameSite=Lax` y sin `httpOnly` porque la escriben los dos lados.
 *  2. El compilador de React prohíbe mutar un valor de fuera del componente
 *     dentro del cuerpo de uno (`react-hooks/immutability`), y `document.cookie`
 *     lo es. Sacar la escritura a una función de módulo es la salida corta; la
 *     otra era un `useEffect` que solo existiría para callar al linter.
 *
 * No hace nada fuera del navegador, para que un import desde servidor —o desde
 * `node` en un `check:*`— no reviente al no haber `document`.
 */
export function guardarFormatoHora(formato: FormatoHora): void {
  if (typeof document === "undefined") return;
  document.cookie = `${HORA_COOKIE}=${formato}; path=/; max-age=31536000; SameSite=Lax`;
}

/**
 * Las opciones de `Intl` que ese formato implica.
 *
 * ⚠️ `hourCycle` EXPLÍCITO Y NO SOLO `hour12`, en los dos sentidos. Es la misma
 * advertencia que ya dejó escrita `account-form.tsx` para las 24 h, y vale
 * igual para las 12:
 *
 *   · `hour12: false` a secas deja al runtime elegir entre `h23` (00:05) y
 *     `h24` (24:05), y hay motores que resuelven a `h24`: la medianoche saldría
 *     «24:05», que nadie escribe así.
 *   · `hour12: true` a secas deja elegir entre `h12` (12:05 a. m.) y `h11`
 *     (0:05 a. m.). El de las doce es el que espera quien pide 12 h.
 *
 * Hoy este motor resuelve bien en los dos casos, así que estas dos líneas no
 * cambian nada: existen para que deje de depender del motor.
 */
export function opcionesDeHora(formato: FormatoHora): {
  hour12: boolean;
  hourCycle: "h12" | "h23";
} {
  return formato === "12"
    ? { hour12: true, hourCycle: "h12" }
    : { hour12: false, hourCycle: "h23" };
}
