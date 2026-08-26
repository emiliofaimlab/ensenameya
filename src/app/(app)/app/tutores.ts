import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listFeaturedTutors } from "@/lib/catalog/queries";
import type { TutorCardData } from "@/lib/booking";
import {
  aTutorCard,
  motivoDeAfinidad,
  type AfinidadRow,
} from "@/lib/afinidad";

/**
 * EY-186 · B5.3 — QUÉ TUTORES SALEN EN EL CARRUSEL DEL PANEL DEL ALUMNO.
 *
 * La petición del responsable, literal: «Es en el home de estudiante. Acá
 * debemos tener un algoritmo de tutores favoritos dependiendo de mis visitas a
 * clases, clases compradas, tutores vistos.»
 *
 * ⚠️ **Es un ALGORITMO, no un botón de guardar.** La ficha de Jira dejaba
 * abierto «definir si se guarda el tutor o la mentoría como favorito» —o sea,
 * favoritos explícitos—; el responsable pidió lo contrario, que la plataforma
 * lo DEDUZCA. Manda lo segundo, y por eso aquí no hay ninguna tabla de
 * marcadores ni ningún toggle: todo sale de lo que el alumno ya hizo.
 *
 * ── DÓNDE VIVE EL ALGORITMO: EN POSTGRES ────────────────────────────────────
 * `student_tutor_affinity()` (`20260827140000`) cruza cuatro señales en una
 * consulta. Aquí NO se reparten pesos ni se ordena nada: esta función pide la
 * lista, decide el caso vacío y traduce las filas a lo que sabe pintar
 * `TutorSummary`. Los pesos y su porqué están en la migración, en un solo
 * sitio, porque son la parte que el cliente va a querer discutir.
 *
 * ── ESTO SUSTITUYE AL BLOQUE «TUS ÚLTIMOS TUTORES» ──────────────────────────
 * El de `4f56bb2` (25-ago) salía gratis de las reservas que la página ya había
 * cargado, pero **no era una consulta de historial**: `.limit(3)` sobre las
 * completadas y `.slice(0, 4)` encima, así que un alumno con veinte clases veía
 * los tutores de sus tres últimas. Aquí el agregado es sobre TODO su historial.
 * No se dejan los dos: dos bloques de tutores en la misma pantalla es ruido.
 */

/** Un tutor del carrusel, con la frase que explica por qué está ahí. */
export type TutorDelPanel = {
  tutor: TutorCardData;
  /** «Diste 3 clases con él», «Le pusiste 5 estrellas»… Ver `motivoDeAfinidad`. */
  motivo: string;
};

export type PanelTutores = {
  tutores: TutorDelPanel[];
  source:
    | /** Salen de su historial: es lo que se pidió. */ "afinidad"
    | /** Alumno sin historial (el caso más común al principio). */ "destacados";
};

/** Cuántos entran. Es un carrusel, así que caben más que en la rejilla de
 *  cuatro de antes; por encima de ocho ya no es «tus tutores», es un directorio. */
const MAX_TUTORES = 8;

export async function tutoresParaElAlumno(): Promise<PanelTutores | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "student_tutor_affinity",
    { p_limit: MAX_TUTORES },
  );

  if (error) {
    // No se propaga: el panel del alumno no se cae porque un carrusel no tenga
    // datos. Es además EL caso de la ventana entre mergear el código y aplicar
    // la migración, en la que PostgREST responde «no existe la función». Se
    // registra para que esa ventana no pase inadvertida si se alarga.
    console.error("[EY-186] student_tutor_affinity falló:", error.message);
  }

  const filas = (error ? [] : ((data ?? []) as AfinidadRow[])).filter(
    (r) => r.display_name,
  );

  if (filas.length > 0) {
    return {
      tutores: filas.map((r) => ({ tutor: aTutorCard(r), motivo: motivoDeAfinidad(r) })),
      source: "afinidad",
    };
  }

  /**
   * EL ALUMNO SIN HISTORIAL — que al principio no es el caso raro, es el caso
   * NORMAL: cuenta recién creada, cero reservas y cero fichas vistas.
   *
   * Se cae a los tutores mejor valorados y se dice la verdad en el subtítulo,
   * en vez de esconder la sección. Es exactamente lo que ya hace `sugerencias.
   * ts` (N-30) con las mentorías cuando el alumno no declaró intereses, y
   * repetir ese patrón importa: la pantalla no debería tener dos maneras de
   * comportarse ante el mismo vacío.
   *
   * ⚠️ Esta consulta va DESPUÉS y no en paralelo con la de arriba, a propósito:
   * hasta que no vuelve la afinidad no se sabe si hace falta. Encadenar dos
   * viajes solo le pasa a quien no tiene historial —que es justo a quien el
   * panel le carga en nada— y pedir siempre las dos le costaría dos consultas a
   * todos los demás para tirar una.
   */
  const destacados = await listFeaturedTutors(MAX_TUTORES);
  const tutores = destacados
    .filter((t) => t.displayName)
    .map((t) => ({
      tutor: {
        id: t.id,
        displayName: t.displayName,
        avatarPath: t.avatarPath,
        headline: t.headline,
        ratingAvg: t.ratingAvg,
        ratingCount: t.ratingCount,
      },
      // Sin historial no hay motivo personal que dar, y aquí el subtítulo de la
      // tarjeta ya explica de dónde salen: repetirlo en cada ficha sería ruido.
      motivo: "",
    }));

  // Catálogo sin tutores aprobados: mejor no montar la tarjeta que enseñar un
  // hueco con título. Mismo criterio que `suggestedForStudent`.
  return tutores.length > 0 ? { tutores, source: "destacados" } : null;
}
