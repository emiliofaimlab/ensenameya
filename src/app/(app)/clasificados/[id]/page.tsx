import { getFormatoHora, getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { VistaAlumno } from "./vista-alumno";
import { VistaTutor } from "./vista-tutor";

export const metadata = { title: "Clasificado · Enséñame Ya" };

/**
 * Un clasificado. `class_requests` solo la lee su dueño (y el admin) por RLS:
 * si la fila llega y es mía, soy el alumno; si no, la vista de quien postula,
 * que lo lee sin datos del alumno por `clasificados_publicos`.
 */
export default async function ClasificadoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { user }, tz, formato] = await Promise.all([
    params,
    requireUser(),
    getUserTimezone(),
    getFormatoHora(),
  ]);
  const supabase = await createClient();

  const { data: req, error } = await supabase
    .from("class_requests")
    .select(
      "id, student_id, goal, detail, slots, timezone, needed_by, status, expires_at, created_at, categories(name, slug, icon)",
    )
    .eq("id", id)
    .maybeSingle();
  // Un id mal formado también cae aquí (22P02): la vista del tutor dirá que no existe.
  if (error) console.error("[clasificados/id] class_requests", error);

  if (req && req.student_id === user.id) {
    return <VistaAlumno request={req} timeZone={tz} formato={formato} />;
  }
  return <VistaTutor requestId={id} userId={user.id} timeZone={tz} formato={formato} />;
}
