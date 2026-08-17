import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { tutorNames } from "@/lib/booking";
import { studentsOfTutor } from "@/app/(app)/tutor/students";

/**
 * N-28 · Con QUIÉN estás hablando.
 *
 * La cabecera del chat decía "Chat con el alumno" y la bandeja "con tu alumno",
 * sin nombre, y no era un descuido: `profiles` es own-only por RLS, así que el
 * tutor literalmente no podía leer el nombre de la persona a la que le va a dar
 * clase. Se resolvió el 17-ago con la RPC `tutor_students` (`20260817150000`),
 * que es `SECURITY DEFINER`, devuelve columnas elegidas a mano y solo las de
 * alumnos con los que el tutor comparte una reserva viva.
 *
 * ⚠️ SON DOS CAMINOS DISTINTOS Y NO SE UNIFICAN.
 *   · Alumno → tutor: el nombre del tutor es PÚBLICO. Sale de
 *     `tutor_profiles.display_name` (DD-01), que es la copia publicable del
 *     perfil; el catálogo entero lo usa.
 *   · Tutor → alumno: el nombre del alumno es PRIVADO. Sale de la RPC, con su
 *     comprobación de reserva compartida dentro.
 * Meterlos en una sola consulta exigiría una superficie que leyera `profiles`
 * para los dos lados, que es exactamente el agujero que la migración de hoy
 * evitó abrir. Aquí se resuelven por separado y se juntan al final.
 *
 * ⚠️ NO devuelve un nombre de relleno. Un `?? "Alumno"` aquí acabaría escrito en
 * la cabecera como "Chat con Alumno", que parece un error de la aplicación. El
 * respaldo lo pone cada pantalla con sus propias palabras ("con tu alumno"), y
 * para eso se devuelve también el rol.
 */

/** El otro lado de la conversación. */
export type ChatCounterpart = {
  /** Nombre a pintar, o `null` si no hay ninguno legible. */
  name: string | null;
  /** Qué es el OTRO en esta reserva: el respaldo se redacta a partir de aquí. */
  role: "tutor" | "student";
};

/** Lo mínimo que hace falta de la reserva para saber quién es el otro. */
type BookingParties = {
  id: string;
  student_id: string;
  tutor_id: string;
};

/**
 * Nombre del otro participante de cada reserva, indexado por id de reserva.
 *
 * Dos consultas como mucho, en paralelo, sea cual sea el número de reservas: la
 * de tutores pide todos los ids de golpe y la de alumnos es una sola llamada a
 * la RPC (que ya devuelve TODOS los alumnos del tutor). Ninguna se lanza si no
 * hace falta — un alumno puro no llama nunca a `tutor_students`.
 */
export async function chatCounterparts(
  supabase: SupabaseClient<Database>,
  userId: string,
  bookings: BookingParties[],
): Promise<Map<string, ChatCounterpart>> {
  const comoAlumno = bookings.filter((b) => b.student_id === userId);
  const comoTutor = bookings.filter((b) => b.tutor_id === userId);

  const [tutores, alumnos] = await Promise.all([
    comoAlumno.length > 0
      ? tutorNames(
          supabase,
          comoAlumno.map((b) => b.tutor_id),
        )
      : new Map<string, string>(),
    comoTutor.length > 0
      ? studentsOfTutor(supabase)
      : new Map<string, { fullName: string | null }>(),
  ]);

  const out = new Map<string, ChatCounterpart>();

  for (const b of comoAlumno) {
    out.set(b.id, {
      name: tutores.get(b.tutor_id)?.trim() || null,
      role: "tutor",
    });
  }
  for (const b of comoTutor) {
    // Puede faltar aunque exista la reserva: la RPC solo devuelve las
    // relaciones vivas (una reserva cancelada retira el dato personal), y
    // `full_name` es nulo si esa persona entró con Google y nunca lo puso.
    out.set(b.id, {
      name: alumnos.get(b.student_id)?.fullName?.trim() || null,
      role: "student",
    });
  }

  return out;
}

/** La versión de una sola reserva (la página del hilo y la descarga). */
export async function chatCounterpart(
  supabase: SupabaseClient<Database>,
  userId: string,
  booking: BookingParties,
): Promise<ChatCounterpart> {
  const map = await chatCounterparts(supabase, userId, [booking]);
  return (
    map.get(booking.id) ?? {
      name: null,
      // Ni alumno ni tutor de esta reserva: no debería llegar aquí (la RLS no
      // le habría dejado leerla), pero si llega, el respaldo genérico.
      role: booking.tutor_id === userId ? "student" : "tutor",
    }
  );
}

/** «con tu tutor» / «con tu alumno»: el respaldo cuando no hay nombre. */
export function counterpartFallback(role: ChatCounterpart["role"]): string {
  return role === "tutor" ? "tu tutor" : "tu alumno";
}
