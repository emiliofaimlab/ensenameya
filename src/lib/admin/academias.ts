import "server-only";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type AcademiaAdmin = Database["public"]["Functions"]["admin_academias"]["Returns"][number];

/** Todas, con el acuerdo y los contadores. Revienta si falla (regla de oro 10). */
export async function leerAcademias(): Promise<AcademiaAdmin[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_academias");
  if (error) throw new Error(`No se pudieron leer las academias: ${error.message}`);
  return data ?? [];
}

