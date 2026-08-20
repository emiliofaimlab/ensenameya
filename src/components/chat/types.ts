/**
 * M-12 · La forma de una conversación, compartida por servidor y navegador.
 *
 * Vive aparte de `conversations.ts` a propósito: aquel importa `server-only`
 * (consulta con la sesión del usuario) y la burbuja es un componente de
 * cliente. Un `import type` se borra al compilar, sí, pero tener los tipos en
 * un módulo neutro evita que el día que alguien importe por descuido un VALOR
 * de allí se entere por un error de build en Vercel y no aquí.
 */

/** Qué es el OTRO en esta conversación. El respaldo se redacta a partir de aquí. */
export type CounterpartRole = "tutor" | "student";

/** Una conversación tal y como la pinta la bandeja. */
export type Conversation = {
  id: string;
  /** El otro participante. Hace falta para cruzar con sus reservas. */
  counterpartId: string;
  /** Nombre del otro participante, o `null` si no hay ninguno legible. */
  counterpart: string | null;
  counterpartRole: CounterpartRole;
  /** Ruta en Storage de su foto (bucket `avatars`), o `null`. */
  avatarPath: string | null;
  /** Para ordenar la bandeja; `null` si todavía no se ha escrito nada. */
  lastMessageAt: string | null;
  /**
   * ¿Este par llegó a comprar? Decide dos cosas visibles: si se pueden mandar
   * adjuntos y si el hilo lleva el aviso de los topes previos a la reserva.
   */
  hasBooking: boolean;
  /**
   * MN-08 · Cuántas mentorías DISTINTAS le compró el alumno al tutor. Es la
   * lectura literal de «cuántas mentorías» y es la que se pinta hoy.
   */
  productCount: number;
  /**
   * MN-08 · Cuántas clases suman esas reservas. Se trae y NO SE PINTA todavía:
   * el cliente aún no ha dicho qué cuenta quiere ver (pregunta P-7 del Doc 20)
   * y las dos salen de la misma llamada. Cuando conteste, esto es cambiar
   * `productCount` por `sessionCount` en `conversationSubtitle` — no una
   * migración. Si la respuesta llega y elige clases, borra la que sobre en vez
   * de dejar las dos: un campo que nadie lee acaba mintiendo.
   */
  sessionCount: number;
  /** Bloqueada por moderación: se lee, no se escribe. */
  blocked: boolean;
  /** La reserva más reciente del par, si la hay (para adjuntos y contexto). */
  bookingId: string | null;
  /** Título de la mentoría de esa reserva, para la línea pequeña. */
  productTitle: string | null;
};

/**
 * «con tu tutor» / «con tu alumno»: el respaldo cuando no hay nombre.
 *
 * ⚠️ Nunca un nombre de relleno tipo "Alumno": escrito en una cabecera («Chat
 * con Alumno») se lee como un fallo de la aplicación. El respaldo lo pone cada
 * pantalla con sus propias palabras, y para eso se guarda el rol.
 */
export function counterpartFallback(role: CounterpartRole): string {
  return role === "tutor" ? "tu tutor" : "tu alumno";
}

/**
 * MN-08 · «3 mentorías» / «1 mentoría», o `null` si no hay ninguna.
 *
 * `null` y no «0 mentorías»: en un hilo previo a la compra el cero no es un
 * dato, es que todavía no ha pasado nada — y escribirlo suena a reproche.
 */
export function mentoriasLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "1 mentoría" : `${count} mentorías`;
}

/**
 * La línea pequeña de un hilo: el contador y, detrás, la mentoría de la última
 * reserva.
 *
 * Vive aquí y no en cada pantalla porque son TRES superficies (la fila de la
 * bandeja, la cabecera del hilo dentro de la burbuja y la página `/chat/[id]`)
 * y ya se habían desincronizado una vez.
 *
 * ⚠️ El contador va DELANTE del título a propósito. Las tres superficies
 * truncan con `truncate`, y en la fila de la bandeja —320 px— lo que se sale
 * por la derecha se pierde: si el orden fuera el natural («Álgebra desde
 * cero · 3 mentorías»), justo el número que pidió el cliente sería lo primero
 * en desaparecer.
 *
 * ⚠️ Cuando no hay contador, la línea queda EXACTAMENTE como estaba antes de
 * MN-08. No es pereza: `last_product_title` sale de la última reserva del par
 * SIN filtrar por estado, así que un par cuya única reserva se canceló tiene
 * título pero no cuenta. Ahí seguía pintándose el título y se sigue pintando.
 */
export function conversationSubtitle(
  c: Pick<Conversation, "productCount" | "productTitle">,
  fallback = "Consulta antes de reservar",
): string {
  const partes = [mentoriasLabel(c.productCount), c.productTitle].filter(
    (x): x is string => Boolean(x),
  );
  return partes.length > 0 ? partes.join(" · ") : fallback;
}

/**
 * Cómo se presenta un tiempo de respuesta (minutos) al alumno.
 *
 * En cubos y no en minutos exactos: «responde en 47 minutos» finge una
 * precisión que una mediana de cinco observaciones no tiene. Devuelve `null`
 * si no hay dato — y entonces NO SE PINTA NADA. Un «suele responder en 2
 * horas» inventado es una promesa que la plataforma no puede cumplir y que el
 * alumno usa para decidir la compra (ver `tutor_response_time` en la migración
 * `20260817210000`).
 */
export function responseTimeLabel(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return "Suele responder en menos de 1 hora";
  if (minutes < 6 * 60) return "Suele responder en unas horas";
  if (minutes < 24 * 60) return "Suele responder el mismo día";
  if (minutes < 48 * 60) return "Suele responder en 1 día";
  if (minutes < 7 * 24 * 60) return "Suele responder en unos días";
  // Más de una semana de mediana: decirlo igual. El alumno prefiere saberlo
  // antes de pagar que descubrirlo después.
  return "Suele tardar más de una semana en responder";
}
