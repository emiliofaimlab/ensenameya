import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { pickHome } from "./roles";
import { requireUser } from "./server";

/**
 * Guarda del panel `/academia`: exige ser DUEÑO de una academia
 * (`academies.owner_id`, la misma condición que `es_admin_de_academia()`), o
 * ser admin de EY mirando una concreta («Ver como la academia», A2: `?a=<id>`).
 * Sin academia → a su home por rol.
 *
 * Antes de mirar, aterriza la invitación pendiente a su correo
 * (`aceptar_invitacion_de_academia`, 20261109150000): el correo NTF-40 trae aquí.
 *
 * `mi_academia()` y no un filtro por `owner_id`: esa columna no tiene grant para
 * `authenticated` (permission denied). Excluye las suspendidas (§5). ponytail:
 * la fila se lee por la RLS pública, así que una academia en BORRADOR la ve el
 * admin de EY pero no su dueño; el portal (A3) lo resuelve con `academia_*`.
 */
export async function requireAcademiaPropia(verComo?: string) {
  const ctx = await requireUser();
  const supabase = await createClient();
  const esAdminEY = ctx.roles.includes("admin");

  if (!esAdminEY || !verComo) {
    const { error } = await supabase.rpc("aceptar_invitacion_de_academia");
    if (error) throw error;
  }

  let id = esAdminEY && verComo ? verComo : null;
  if (!id) {
    const { data: mia, error } = await supabase.rpc("mi_academia");
    if (error) throw error;
    id = mia;
  }
  if (!id) redirect(pickHome(ctx.roles));
  // Solo columnas de la cara pública: el resto no tiene grant (20261009170100).
  const { data, error } = await supabase
    .from("academies")
    .select("id, name, slug, status")
    .eq("id", id)
    .maybeSingle();
  // Regla de oro 10: el error no se convierte en «no tienes academia».
  if (error) throw error;
  if (!data) redirect(pickHome(ctx.roles));
  return { ...ctx, academia: data, verComo: esAdminEY && Boolean(verComo) };
}
