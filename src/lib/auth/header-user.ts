import type { User } from "@supabase/supabase-js";

import type { HeaderUser } from "@/components/layout/site-header";
import { storageUrl } from "@/lib/catalog/format";
import { panelsFor, pickHome, type AppRole } from "./roles";

/**
 * Reduce el `User` de Supabase a lo que el header necesita (nada sensible).
 * `homeHref` sale de `pickHome` (gana el rol más privilegiado) para que "Panel"
 * lleve a cada quien al suyo: admin → /admin, tutor → /tutor, alumno → /app.
 * Un enlace fijo a /app mandaría al tutor al panel del alumno.
 *
 * `panels` son TODOS los que puede ver, no solo el principal: con eso el menú
 * de cuenta pinta el switch de rol.
 *
 * El nombre y la foto llegan de `profiles` (los trae `getSessionContext`). El
 * metadata de Auth queda de reserva: viaja en el JWT y hay altas que no lo
 * escriben, que es lo que dejaba a algunas cuentas enseñando el correo.
 */
export function toHeaderUser(
  user: User | null,
  roles: AppRole[] = [],
  profile: { fullName?: string | null; avatarPath?: string | null } = {},
): HeaderUser | null {
  if (!user) return null;
  const metaName = user.user_metadata?.full_name as string | undefined;
  return {
    // La campana lo usa para acotar sus consultas a los avisos propios; ver la
    // nota del tipo `HeaderUser`.
    id: user.id,
    email: user.email ?? "",
    name: profile.fullName?.trim() || metaName?.trim() || null,
    avatarUrl: storageUrl("avatars", profile.avatarPath),
    homeHref: pickHome(roles),
    panels: panelsFor(roles),
  };
}
