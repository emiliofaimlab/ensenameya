import "server-only";

import { createClient } from "@/lib/supabase/server";
import { tutorCards, type TutorCardData } from "@/lib/booking";
import type { Database } from "@/lib/database.types";

/**
 * La TERCERA tarjeta del panel del alumno: su historial de reservas, con el
 * mismo lenguaje visual que `TutoresCard` y `SugerenciasCard`.
 *
 * El cliente lo pidió así, literal: «esos cuadros junto con uno nuevo que va a
 * replicar el historial de reservas, pero con el diseño que tienen tutores
 * favoritos y empieza aquí».
 *
 * ⚠️ **HISTORIAL ES LO YA TERMINADO, NO LO QUE ESTÁ EN CURSO.** Arriba, en
 * `/app`, ya hay una lista con las reservas VIVAS (`OPEN`: esperando al tutor,
 * confirmada, en curso). Si esta tarjeta las repitiera, la pantalla enseñaría
 * dos veces lo mismo con dos formas distintas. Aquí solo entran los estados
 * terminales.
 *
 * ⚠️ Y son los MISMOS TRES que `/reservas` agrupa bajo «Historial» —o sea, el
 * complemento de sus `OPEN`—, `refunded` incluido. La tarjeta lleva un «Ver
 * todas» a esa pantalla: si las dos listas no contaran lo mismo, el alumno
 * llegaría allí y encontraría reservas que la tarjeta le había ocultado, sin
 * poder saber por qué. `refunded` es dinero devuelto, que es justo lo que se
 * quiere poder consultar después.
 */

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/** Estados terminales. Complemento exacto de los `OPEN` de `/reservas`. */
const CERRADAS: BookingStatus[] = ["completed", "cancelled", "refunded"];

/**
 * Cuántas entran. Es el mismo número que `MAX_TUTORES` en `tutores.ts` y por el
 * mismo motivo: es un carrusel, cabe más que una fila, y por encima de ocho
 * deja de ser «un vistazo a lo tuyo» para ser un listado — que es lo que ya es
 * `/reservas`, a un clic de aquí.
 */
const MAX_RESERVAS = 8;

/** Una reserva terminada, con lo justo para pintar su tarjeta. */
export type ReservaDelHistorial = {
  id: string;
  /** Título de la mentoría. `products` es nulo si la borraron: RN nunca pasa hoy. */
  titulo: string;
  status: BookingStatus;
  /**
   * Instante UTC de la última sesión de la reserva, o `null` si nunca llegó a
   * tener ninguna (una `cancelled` antes de agendar). Se renderiza en la hora
   * local del usuario, como todo (RN-01/02).
   */
  cuando: string | null;
  /** Importe congelado en la reserva, en la menor unidad de su moneda. */
  importe: number;
  moneda: string;
  /** `undefined` = al tutor le retiraron la aprobación. Ver `tutorCards`. */
  tutor?: TutorCardData;
  /** ¿ya la reseñó? Solo tiene sentido en `completed` (RN-17: una por compra). */
  resenada: boolean;
};

export type PanelHistorial = {
  reservas: ReservaDelHistorial[];
};

/** La sesión que representa a la reserva terminada: la última que tuvo. */
function ultimaSesion(sesiones: { start_at: string }[] | null): string | null {
  return (
    [...(sesiones ?? [])].sort((x, y) => y.start_at.localeCompare(x.start_at))[0]
      ?.start_at ?? null
  );
}

/**
 * El historial del alumno para la tarjeta, o `null` si todavía no tiene
 * ninguno.
 *
 * `null` y no una lista vacía a propósito: es el mismo contrato que
 * `tutoresParaElAlumno` y `suggestedForStudent`, y quien pinta lo usa igual
 * —no monta la tarjeta—. Un carrusel vacío bajo un título es peor que no
 * ponerlo, y en `/app` además chocaría con el estado vacío que la propia
 * pantalla ya enseña («Aún no tienes mentorías reservadas»), que es el que
 * lleva al catálogo.
 */
export async function historialDelAlumno(
  studentId: string,
): Promise<PanelHistorial | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, status, total_amount, currency, products(title, tutor_id), sessions(start_at), reviews(rating)",
    )
    .eq("student_id", studentId)
    .in("status", CERRADAS)
    // Por fecha de compra y no por la de la sesión: es el orden que usa
    // `/reservas` (y el único que Postgres puede resolver sin salir de
    // `bookings`), así que las dos listas empiezan por la misma reserva.
    .order("created_at", { ascending: false })
    .limit(MAX_RESERVAS);

  if (error) {
    // No se propaga: el panel no se cae porque una tarjeta no tenga datos.
    // Se registra para que el fallo no pase inadvertido — mismo criterio que
    // `tutoresParaElAlumno`.
    console.error("[agendar] historial del alumno falló:", error.message);
    return null;
  }

  const filas = data ?? [];
  if (filas.length === 0) return null;

  // Una sola consulta para los tutores de todas las filas. `tutorCards`
  // devuelve un `Map` CON HUECOS: el tutor desaprobado no llega, y entonces la
  // tarjeta se pinta sin enlace a su ficha en vez de mandar al alumno a un 404
  // desde su propio panel.
  const fichas = await tutorCards(
    supabase,
    filas.map((b) => b.products?.tutor_id),
  );

  return {
    reservas: filas.map((b) => {
      const tutorId = b.products?.tutor_id;
      return {
        id: b.id,
        titulo: b.products?.title ?? "Mentoría",
        status: b.status,
        cuando: ultimaSesion(b.sessions),
        importe: b.total_amount,
        moneda: b.currency,
        tutor: tutorId ? fichas.get(tutorId) : undefined,
        // `reviews` llega como objeto o nulo, no como lista: `reviews.booking_id`
        // es `unique` (RN-17), así que PostgREST lo resuelve a uno.
        resenada: Boolean(b.reviews),
      };
    }),
  };
}
