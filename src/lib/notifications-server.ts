import { createClient } from "@/lib/supabase/server";

import {
  NOTICES_LIMIT,
  toNotice,
  type AppNotice,
  type NotificationRow,
} from "@/lib/notifications";

/**
 * Los avisos del usuario, para pintar la campana ya en el servidor.
 *
 * ⚠️ EL `eq("recipient_id")` NO SOBRA, Y QUITARLO ES UNA FUGA ENTRE CUENTAS.
 * Esta consulta se apoyaba solo en la RLS, y la RLS de esta tabla tiene DOS
 * políticas de lectura (`20260716170000:38-44`):
 *
 *     notifications_select_own    → auth.uid() = recipient_id
 *     notifications_select_admin  → has_role('admin')
 *
 * Las políticas de `select` se SUMAN (es un `or`), así que para un admin la
 * segunda abre la tabla ENTERA. Sin filtro, la campana de un administrador
 * pintaba los ocho avisos más recientes DE TODA LA PLATAFORMA — los de cualquier
 * alumno, con su texto. Es exactamente lo que reportó el cliente el 28-ago
 * («cuando inicié sesión como admin veía notificaciones de mi usuario
 * anterior»): no era estado que sobreviviera al `signOut`, era que el admin
 * podía ver los avisos del otro. El síntoma parecía de sesión y la causa era de
 * consulta.
 *
 * La política de admin se deja como está a propósito: la necesita
 * `/admin/notificaciones`, que es la supervisión de la cola de correo y para eso
 * sí hay que verla entera. Lo que estaba mal era que la campana —que es «mis
 * avisos»— no dijera de quién.
 *
 * El id llega por parámetro y no de un `auth.getUser()` de aquí dentro porque
 * los tres llamantes ya lo tienen resuelto: pedirlo otra vez sería un viaje al
 * servidor de Auth por cada carga de página.
 */
export async function listNotices(userId: string): Promise<AppNotice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, template, payload, created_at, read_at")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(NOTICES_LIMIT);
  return ((data ?? []) as NotificationRow[]).map(toNotice);
}
