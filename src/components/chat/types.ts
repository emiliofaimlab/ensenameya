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
