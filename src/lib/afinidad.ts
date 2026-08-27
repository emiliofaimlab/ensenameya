
import type { TutorCardData } from "@/lib/booking";

/**
 * Una fila de `student_tutor_affinity()`. Es la ficha pública del tutor MÁS el
 * desglose de por qué está en la lista.
 *
 * El desglose no es telemetría: lo pinta la tarjeta. Una recomendación que no
 * explica por qué recomienda se lee como publicidad — el mismo criterio con el
 * que N-30 puso subtítulo a «Sugeridas para ti».
 */
export type AfinidadRow = {
  tutor_id: string;
  display_name: string | null;
  avatar_path: string | null;
  headline: string | null;
  rating_avg: number | null;
  rating_count: number;
  /** Puntuación total. Solo para depurar «¿por qué este primero?». */
  score: number;
  /** Clases suyas que el alumno terminó. */
  sesiones: number;
  /** Mentorías suyas que el alumno pagó. */
  compras: number;
  /** La última nota que el alumno le puso (1–5); `null` = no le ha reseñado. */
  mi_nota: number | null;
  /** Veces que abrió su ficha (con antirrebote de 30 min). */
  vistas: number;
  /** Veces que abrió una mentoría suya. */
  vistas_clase: number;
  /** Lo más reciente de todo lo anterior; `null` solo en casos de borde. */
  ultima_vez: string | null;
};

/**
 * `AfinidadRow` → la ficha que ya sabe pintar `TutorSummary` (V-6). Se
 * reutiliza esa forma en vez de estrenar una quinta manera de dibujar un tutor.
 *
 * ⚠️ `display_name` viene `string | null` del tipo de la RPC porque la columna
 * es nullable en `tutor_profiles`, pero la función YA filtra
 * `display_name is not null`: aquí nunca llega vacío. Se respeta el tipo en vez
 * de forzarlo para que el día que ese filtro cambie el compilador avise.
 */
export function aTutorCard(r: AfinidadRow): TutorCardData {
  return {
    id: r.tutor_id,
    displayName: r.display_name,
    avatarPath: r.avatar_path,
    headline: r.headline,
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count,
  };
}

/**
 * POR QUÉ ESTE TUTOR ESTÁ EN TU CARRUSEL, en una frase.
 *
 * Se elige UN motivo, el más fuerte, y no se enumeran los cuatro: «2 clases ·
 * 1 compra · 5 vistas · 4★» es un informe, no una explicación. El orden de
 * preferencia es el mismo que el de los pesos del algoritmo, así que la frase
 * y la posición en la lista no se pueden contradecir.
 *
 * ⚠️ La reseña se dice ANTES que las clases cuando es buena, aunque pese menos
 * en la suma: «le pusiste 5 estrellas» es la razón que el alumno reconoce como
 * suya. Las malas no se mencionan nunca — un tutor con reseña mala casi nunca
 * llega aquí (la resta lo hunde), y si llega por volumen de clases, recordarle
 * al alumno que le puso 2★ mientras se le invita a repetir es absurdo.
 */
export function motivoDeAfinidad(r: AfinidadRow): string {
  if (r.mi_nota != null && r.mi_nota >= 4) {
    return `Le pusiste ${r.mi_nota} ${r.mi_nota === 1 ? "estrella" : "estrellas"}`;
  }
  if (r.sesiones > 0) {
    return r.sesiones === 1
      ? "Diste una clase con él"
      : `Diste ${r.sesiones} clases con él`;
  }
  if (r.compras > 0) {
    return r.compras === 1
      ? "Reservaste una mentoría suya"
      : `Reservaste ${r.compras} mentorías suyas`;
  }
  if (r.vistas_clase > 0) {
    return r.vistas_clase === 1
      ? "Miraste una mentoría suya"
      : "Miraste varias mentorías suyas";
  }
  // Único caso que queda: solo vio la ficha. No se dice «lo viste 3 veces»
  // —contarle a alguien cuántas veces ha entrado suena a que se le vigila—,
  // solo que estuvo por ahí.
  return "Estuviste viendo su perfil";
}
