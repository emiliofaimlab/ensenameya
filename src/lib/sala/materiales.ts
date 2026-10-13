import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { esPresentable } from "@/components/sala/formatos-presentables";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * EY-221 · Los materiales de la mentoría de UNA sesión, vistos por uno de sus
 * dos participantes. Lo comparten los dos Route Handlers de la sala
 * (`/api/room/<sesión>/materiales` y `/materiales/<id>`).
 *
 * ⚠️ Sin `service_role`, a propósito (regla de oro 3): todo va con el cliente
 * del usuario y la RLS ya dice lo que hace falta —
 *   · `sessions_select_participant`: solo alumno y tutor leen la sesión. La
 *     comprobación explícita de abajo está porque `sessions_select_admin`
 *     también deja leerla al admin, y el admin no es parte de la clase.
 *   · `tutor_materials` (dueño) y `tutor_materials_select_student`
 *     (`20260911200000`): el tutor ve los suyos; el alumno, los del producto de
 *     una reserva suya `confirmed`/`in_progress`/`completed` — la misma lista
 *     que deja abrir la sala.
 *   · `materials_select_student` en `storage.objects`: la que deja FIRMAR.
 * Si alguna de las tres dice que no, aquí sale vacío o `null`, nunca un
 * fichero ajeno.
 */
export type MaterialDeSala = {
  id: string;
  nombre: string;
  tamano: number;
  presentable: boolean;
};

type Fila = {
  id: string;
  file_name: string;
  size_bytes: number;
  storage_path: string;
};

/** `null` = no eres parte de esta sesión (o no existe): el handler da 404. */
export async function materialesDeLaSesion(
  supabase: Supabase,
  sessionId: string,
  userId: string,
): Promise<Fila[] | null> {
  const { data: s, error } = await supabase
    .from("sessions")
    .select("id, tutor_id, student_id, bookings(product_id)")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!s || (s.tutor_id !== userId && s.student_id !== userId)) return null;

  const productId = s.bookings?.product_id;
  if (!productId) return [];

  const { data, error: e2 } = await supabase
    .from("tutor_materials")
    .select("id, file_name, size_bytes, storage_path")
    .eq("product_id", productId)
    .order("created_at", { ascending: true });
  // Regla de oro 10: una lista que alimenta una pantalla mira su `error`. Un
  // fallo aquí convertido en «esta mentoría no tiene materiales» es una mentira
  // creíble delante del alumno.
  if (e2) throw e2;
  return data ?? [];
}

export function aMaterialDeSala(f: Fila): MaterialDeSala {
  return {
    id: f.id,
    nombre: f.file_name,
    tamano: f.size_bytes,
    presentable: esPresentable(f.file_name),
  };
}
