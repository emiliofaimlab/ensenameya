import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Lo ÚNICO que el tutor puede leer de su alumno (N-13/N-14). No es un recorte
 * de la fila de `profiles`: es exactamente lo que devuelve la RPC
 * `tutor_students` (migración `20260817150000`), que es `SECURITY DEFINER` y
 * elige las columnas a mano. Teléfono, objetivo principal e intereses NO están
 * y no deben añadirse aquí: se añaden —si se decide— en la migración.
 */
export type StudentIdentity = {
  id: string;
  fullName: string | null;
  avatarPath: string | null;
  /** Zona horaria del alumno (RN-01/02): su 1:00 puede ser tu 10:00. */
  timezone: string | null;
};

/** Fila cruda de la RPC. Los tipos generados aún no la conocen. */
type TutorStudentRow = {
  student_id: string;
  full_name: string | null;
  avatar_path: string | null;
  timezone: string | null;
};

function toIdentity(row: TutorStudentRow): StudentIdentity {
  return {
    id: row.student_id,
    fullName: row.full_name,
    avatarPath: row.avatar_path,
    timezone: row.timezone,
  };
}

/**
 * Todos los alumnos del tutor que llama, indexados por id.
 *
 * Va en UNA consulta y no una por reserva a propósito: el listado del tutor
 * pinta hasta N filas y la RPC ya filtra por `auth.uid()`, así que traerlos
 * todos y resolver el nombre en memoria sale más barato que N llamadas. Un
 * tutor del MVP tiene un puñado de alumnos, no miles.
 *
 * Un alumno puede faltar del mapa aun teniendo reserva: la RPC solo devuelve
 * las relaciones vivas (ver "Decisión 2" de la migración). Por eso todos los
 * usos pasan por `studentName`, que tiene su respaldo.
 */
export async function studentsOfTutor(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, StudentIdentity>> {
  const { data } = await supabase.rpc("tutor_students");
  const rows = (data ?? []) as unknown as TutorStudentRow[];
  return new Map(rows.map((r) => [r.student_id, toIdentity(r)]));
}

/**
 * Un alumno concreto, o `null` si el tutor no tiene con él ninguna reserva que
 * dé acceso. El filtro lo hace la RPC en servidor: pasarle un uuid a mano no
 * abre nada (S-15 — el cliente nunca decide qué puede ver).
 */
export async function studentOfTutor(
  supabase: SupabaseClient<Database>,
  studentId: string,
): Promise<StudentIdentity | null> {
  const { data } = await supabase.rpc("tutor_students", {
    p_student_id: studentId,
  });
  const rows = (data ?? []) as unknown as TutorStudentRow[];
  return rows[0] ? toIdentity(rows[0]) : null;
}

/**
 * Nombre a pintar. El respaldo no es cosmético: `full_name` es nulo si el
 * alumno entró por Google sin nombre, y el mapa no trae a los alumnos cuya
 * única reserva se canceló. En ambos casos la fila sigue siendo válida.
 */
export function studentName(student: StudentIdentity | undefined | null): string {
  return student?.fullName?.trim() || "Alumno";
}
