import { createClient } from "@/lib/supabase/server";

import {
  NOTICES_LIMIT,
  toNotice,
  type AppNotice,
  type NotificationRow,
} from "@/lib/notifications";

/**
 * Los avisos del usuario, para pintar la campana ya en el servidor. La RLS
 * (`notifications_select_own`) es la que acota a los suyos; sin sesión no hay
 * filas y la campana ni se monta.
 */
export async function listNotices(): Promise<AppNotice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, template, payload, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(NOTICES_LIMIT);
  return ((data ?? []) as NotificationRow[]).map(toNotice);
}
