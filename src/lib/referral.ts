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
 * ⚠️ B1.11 · OJO: LA PREMISA DE ESTA FUNCIÓN NO SE CUMPLE HOY, Y ESTÁ MEDIDO.
 *
 * Se escribió afirmando que el cliente tiene DOS programas separados en
 * Referral Factory —uno para alumnos, otro para tutores—, cada uno con su URL,
 * sus reglas y sus recompensas. El 26-ago se consultó su API con la clave real
 * y **solo existe UNA campaña**: `id 50297`, «Campaign for Enséñame Ya»,
 * `launched`, y su URL es exactamente la que hay en `NEXT_PUBLIC_REFERRAL_URL`.
 * Tampoco existe en su modelo ningún concepto de audiencia o rol dentro de una
 * campaña. O nunca hubo dos, o la segunda no llegó a crearse.
 *
 * O sea que `NEXT_PUBLIC_REFERRAL_URL_TUTOR` **no tiene a qué apuntar**, y por
 * eso hoy al tutor no se le enseña nada.
 *
 * La función se deja como está a la espera de una decisión de negocio, y no por
 * pereza: mientras el reparto por rol siga aquí, crear la segunda campaña es
 * poner una variable. Si se decide que hay un solo programa para todos, lo que
 * sobra es la mitad de esta función — y eso es diez minutos. Lo que NO se puede
 * hacer es que el tutor caiga a la campaña del alumno: darlo de alta en el
 * programa equivocado sin que se note es peor que no enseñarle nada.
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

/**
 * US-1301 · La misma campaña, pero servida DENTRO de la app (petición del
 * cliente, 28-ago: «cuando le damos a invita y gana nos abre una url externa»).
 *
 * Es una variable APARTE y no se deriva de `NEXT_PUBLIC_REFERRAL_URL` añadiéndole
 * un sufijo: lo que hay en esa otra es la **landing pública** de la campaña —el
 * sitio de Referral Factory con su propio cromo—, y el `src` que RF da para
 * embeber no tiene por qué ser esa misma dirección. Derivarla sería adivinar, y
 * el modo de fallar es el peor posible: la landing puede responder con
 * `X-Frame-Options` y dejar un recuadro EN BLANCO dentro del panel, que es
 * exactamente lo que `referral-card.tsx` evitaba abriendo pestaña nueva.
 *
 * La URL es el interruptor, igual que arriba: sin ella no se monta ningún
 * iframe y `/referidos` cae al enlace externo de siempre, que es el
 * comportamiento de hoy y no falla nunca.
 *
 * ⚠️ Y FALLA CERRADO POR ROL, por el mismo motivo que `referralUrl`: si algún
 * día existe la campaña de tutores, su embed será OTRO. Al tutor NO se le cae
 * al embed del alumno — darlo de alta en el programa equivocado dentro de
 * nuestro propio cromo sería aún más difícil de notar que en una pestaña nueva,
 * porque ya ni cambia la barra de direcciones.
 */
export function referralEmbedUrl(isTutor: boolean): string | null {
  const url = isTutor
    ? process.env.NEXT_PUBLIC_REFERRAL_EMBED_URL_TUTOR
    : process.env.NEXT_PUBLIC_REFERRAL_EMBED_URL;
  return url?.trim() ? url.trim() : null;
}

/**
 * ¿Hay algo que ofrecerle a este rol, embebido o en su web?
 *
 * Una sola respuesta para las dos puertas —la tarjeta del panel y la ruta
 * `/referidos`— para que no puedan discrepar: si la tarjeta se pinta, la
 * pantalla a la que lleva existe, y si no hay nada configurado no aparece
 * ningún botón que acabe en un 404.
 */
export function hasReferralProgram(isTutor: boolean): boolean {
  return Boolean(referralEmbedUrl(isTutor) ?? referralUrl(isTutor));
}
