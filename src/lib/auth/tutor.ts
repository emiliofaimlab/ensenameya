import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { requireUser } from "./server";

type Approval = Database["public"]["Enums"]["tutor_approval_status"];

/**
 * La fila de `tutor_profiles` del usuario, o `null`. Sin guardas ni redirección.
 *
 * ⚠️ Es la puerta ÚNICA a esa lectura, y por eso está memoizada y exportada.
 * Antes cada llamante hacía la suya: `requireTutorProfile` una y
 * `hasTutorProfile` otra, a la misma tabla y por la misma clave. Y sobre todo,
 * `requireTutorProfile` la resolvía DESPUÉS de la sesión y ANTES de que la
 * pantalla lanzara sus propias consultas — medido en `/tutor/products`: un
 * peldaño de ~300 ms que pagaban las diez pantallas del tutor sin que ninguna
 * necesitara su resultado para pedir lo suyo.
 *
 * Exportada para que `(app)/tutor/layout.tsx` pueda ADELANTARLA: los layouts
 * corren antes que su pantalla, así que allí se lanza sin `await` y aquí se
 * encuentra ya resuelta.
 */
export const leerPerfilDeTutor = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tutor_profiles")
    .select("approval_status")
    .eq("profile_id", userId)
    .maybeSingle();
  return data;
});

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
  const data = await leerPerfilDeTutor(user.id);

  if (!data) redirect("/tutor/onboarding");
  return { userId: user.id, approvalStatus: data.approval_status };
}

/**
 * ¿Tiene perfil de tutor? Sin redirigir, para decidir cosas de UI (qué menú
 * pintar). Sale de la misma lectura memoizada, así que no cuesta un viaje
 * propio a quien ya la haya pedido.
 */
export const hasTutorProfile = async (userId: string) =>
  Boolean(await leerPerfilDeTutor(userId));
