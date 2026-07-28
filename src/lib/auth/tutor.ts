import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { requireUser } from "./server";

type Approval = Database["public"]["Enums"]["tutor_approval_status"];

/**
 * Exige haber iniciado el onboarding de tutor (fila en `tutor_profiles`). Un
 * tutor puede preparar productos en borrador antes de la aprobación; PUBLICAR
 * exige `approved` (RN-23), lo fuerza el trigger `products_publish_guard` en BD.
 * Sin fila → a onboarding (no es tutor todavía).
 */
export async function requireTutorProfile(): Promise<{
  userId: string;
  approvalStatus: Approval;
}> {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("approval_status")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!data) redirect("/tutor/onboarding");
  return { userId: user.id, approvalStatus: data.approval_status };
}

/**
 * ¿Tiene perfil de tutor? Sin redirigir, para decidir cosas de UI (qué menú
 * pintar). `cache()` la memoiza por request.
 */
export const hasTutorProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("profile_id")
    .eq("profile_id", userId)
    .maybeSingle();
  return Boolean(data);
});
