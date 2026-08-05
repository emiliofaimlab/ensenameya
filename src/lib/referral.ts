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

/**
 * US-1301 · La campaña de Referral Factory, si está configurada.
 *
 * La URL es el interruptor, igual que la credencial en Daily o el PSP: sin
 * `NEXT_PUBLIC_REFERRAL_URL` el bloque de referidos **no se pinta**. Un "Invita
 * y gana" que no lleva a ninguna parte es peor que no tenerlo.
 *
 * Pública a propósito: es la dirección del programa, la misma que el alumno va
 * a compartir. No hay secreto que proteger porque no hay lógica nuestra (RN-21).
 */
export function referralUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_REFERRAL_URL?.trim();
  return url ? url : null;
}
