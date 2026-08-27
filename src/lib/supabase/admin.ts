import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Cliente con `service_role`: **se salta la RLS por completo**. Es el primero
 * del proyecto, así que conviene ser explícito sobre cuándo se usa y cuándo no.
 *
 * Regla de oro 3: esta clave no aparece jamás en el navegador. El `server-only`
 * de arriba no es decorativo — si alguien importa este módulo desde un
 * componente cliente, el build FALLA en vez de filtrar la clave en el bundle.
 *
 * CUÁNDO USARLO: trabajo de sistema que por definición no tiene un usuario
 * detrás y necesita ver filas de todo el mundo — hoy solo el job diario de
 * purga de grabaciones, que recorre sesiones ajenas para cumplir la retención.
 *
 * CUÁNDO NO: cualquier cosa disparada por una persona. Ahí manda la RLS y se
 * usa `@/lib/supabase/server`. Saltarse la RLS "para que sea más fácil" es
 * exactamente cómo se convierte una regla default-deny en una fuga (RISK-13).
 *
 * No persiste sesión ni refresca token: no hay usuario que mantener, y dejarlo
 * activado haría que el cliente intentara escribir en un almacenamiento que en
 * el servidor no existe.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
