import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * EY-194 · Las FAQ que el tutor escribe UNA vez y salen en todas sus mentorías.
 *
 * Aquí viven las tres cosas que comparten el editor del panel, la ficha pública
 * y la consulta del catálogo: el tipo, el parseo del jsonb y la puerta a la
 * columna que los tipos generados todavía no conocen.
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

/**
 * ⚠️ TEMPORAL — SE BORRA ENTERO AL REGENERAR LOS TIPOS.
 *
 * `database.types.ts` se regenera con `npm run db:types` DESPUÉS de aplicar la
 * migración (`20260826150000`) y no se edita a mano (regla de oro 6). Hasta
 * entonces `tutor_profiles.faqs` no existe para TypeScript: pedirla en un
 * `select` no es un fallo en tiempo de ejecución, es que el `select` entero
 * deja de tipar y se lleva por delante las columnas que sí existen.
 *
 * Se declara UNA puerta —el mismo patrón que `components/chat/rpc.ts` abrió
 * para las RPC de M-12— en vez de repartir `as unknown as` por los tres sitios
 * que la tocan. El día que se regeneren los tipos: borrar `TutorFaqsTable` y
 * `asFaqsTable`, y cambiar las tres llamadas por `supabase` a secas.
 *
 * La firma se declara estrecha a propósito (solo `select('faqs')` y
 * `update({faqs})` sobre `tutor_profiles`): un `any` abriría la mano para
 * cualquier tabla y cualquier columna, que es justo lo que no se quiere dejar
 * suelto por el código.
 */
export type TutorFaqsTable = {
  from: (table: "tutor_profiles") => {
    select: (columns: "faqs") => {
      eq: (
        column: "profile_id",
        value: string,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: { faqs: unknown } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (values: { faqs: Faq[] }) => {
      eq: (
        column: "profile_id",
        value: string,
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/** ⚠️ Temporal — ver `TutorFaqsTable`. */
export function asFaqsTable(client: SupabaseClient<Database>): TutorFaqsTable {
  return client as unknown as TutorFaqsTable;
}

/** Cuántas preguntas admite el editor del perfil. */
export const MAX_TUTOR_FAQS = 15;
