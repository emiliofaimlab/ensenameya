/**
 * EY-194 · Las FAQ que el tutor escribe UNA vez y salen en todas sus mentorías.
 *
 * Aquí viven las dos cosas que comparten el editor del panel, la ficha pública
 * y la consulta del catálogo: el tipo y el parseo del jsonb.
 */

/** Una pregunta con su respuesta, tal y como se guarda en el jsonb. */
export type Faq = { q: string; a: string };

/**
 * jsonb → lista tipada. Descarta lo que no tenga forma `{q,a}` de texto y lo
 * que venga vacío.
 *
 * El filtro NO es paranoia de más: la columna la escribe el navegador bajo RLS
 * (es catálogo, no dinero), así que lo único que garantiza la BD es que sea una
 * lista. Vale igual para `products.faqs` y para `tutor_profiles.faqs` — el
 * mismo formato en las dos, a propósito, para poder concatenarlas al pintar.
 */
export function parseFaqs(value: unknown): Faq[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (f): f is Faq =>
        typeof (f as Faq | null)?.q === "string" &&
        typeof (f as Faq | null)?.a === "string",
    )
    .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
    .filter((f) => f.q !== "" && f.a !== "");
}

/** Cuántas preguntas admite el editor del perfil. */
export const MAX_TUTOR_FAQS = 15;
