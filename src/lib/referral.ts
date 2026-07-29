/**
 * US-1302 · Atribución de referidos (S-18, RN-21).
 *
 * El enlace que reparte Referral Factory trae `?ref=CODE` y puede apuntar a
 * cualquier página. El proxy lo guarda aquí para que siga vivo cuando el
 * visitante decida registrarse, aunque haya navegado por medio.
 *
 * Solo es atribución: el programa (montos, conversión válida, límites) vive
 * entero en Referral Factory. Nada de lógica de referidos en la app.
 */
export const REFERRAL_COOKIE = "ey-ref";
