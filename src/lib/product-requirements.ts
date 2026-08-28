/**
 * Requerimientos de sesión · lo que el alumno tiene que tener listo ANTES de la
 * clase (un portátil, un ventilador, el libro de la asignatura…).
 *
 * Vive aquí y no suelto en cada pantalla por el mismo motivo que
 * `tutor-faqs.ts`: los escribe el panel del tutor y los leen la ficha pública,
 * la confirmación del pedido/la reserva y el detalle de la reserva. Un criterio
 * de parseo distinto en cualquiera de esos sitios se vería como requisitos que
 * salen en una pantalla y no en la otra, que es lo peor que puede pasarle a un
 * dato cuya única razón de ser es que el alumno lo lea a tiempo.
 */

/**
 * jsonb → lista de textos. Descarta lo que no sea cadena y lo que quede vacío
 * al recortar.
 *
 * El filtro no es paranoia de más: la columna la escribe el navegador bajo RLS
 * (es catálogo, no dinero), así que lo único que garantiza la BD es que sea una
 * lista — el check `products_requirements_es_lista` de su migración
 * (`20260828143000`). Todo lo de dentro llega sin revisar.
 */
export function parseRequirements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim())
    .filter((r) => r !== "");
}

/**
 * Cuántos requisitos admite el formulario de la mentoría.
 *
 * El tope es de usabilidad, no de esquema: una lista de "lo que necesitas" con
 * veinte líneas deja de leerse justo antes de reservar, que es cuando importa.
 */
export const MAX_REQUIREMENTS = 10;

/** Tope por requisito: es una frase corta («una laptop con cámara»), no un párrafo. */
export const MAX_REQUIREMENT_LEN = 120;
