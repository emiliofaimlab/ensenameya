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
 * US-1301 · La campaña de Referral Factory que le toca a cada rol.
 *
 * ⚠️ B1.11 · SON DOS PROGRAMAS, NO UNO CON DOS TEXTOS. El cliente los tiene
 * separados en Referral Factory —uno para alumnos, otro para tutores— y cada
 * uno vive en su propia URL, con sus propias reglas y sus propias recompensas.
 * Hasta hoy la tarjeta repartía la MISMA a los dos, así que un tutor que
 * pulsaba «Ver mi enlace» se daba de alta en el programa de alumnos.
 *
 * La URL es el interruptor, igual que la credencial en Daily o el PSP: sin ella
 * el bloque **no se pinta**. Un «Invita y gana» que no lleva a ninguna parte es
 * peor que no tenerlo.
 *
 * ⚠️ Y FALLA CERRADO POR ROL. Si está la del alumno pero no la del tutor, al
 * tutor no se le enseña nada — NO se le cae a la del alumno. Caer al otro
 * programa es exactamente el fallo que esta ficha viene a arreglar, y sería
 * además el más difícil de detectar: la tarjeta se vería bien.
 *
 * Públicas a propósito: son las direcciones que la gente va a compartir. No hay
 * secreto que proteger porque no hay lógica nuestra (RN-21).
 */
export function referralUrl(isTutor: boolean): string | null {
  const url = isTutor
    ? process.env.NEXT_PUBLIC_REFERRAL_URL_TUTOR
    : process.env.NEXT_PUBLIC_REFERRAL_URL;
  return url?.trim() ? url.trim() : null;
}
