import type { User } from "@supabase/supabase-js";

import type { HeaderUser } from "@/components/layout/site-header";
import { pickHome, type AppRole } from "./roles";

/**
 * Reduce el `User` de Supabase a lo que el header necesita (nada sensible).
 * `homeHref` sale de `pickHome` (gana el rol más privilegiado) para que "Panel"
 * lleve a cada quien al suyo: admin → /admin, tutor → /tutor, alumno → /app.
 * Un enlace fijo a /app mandaría al tutor al panel del alumno.
 */
export function toHeaderUser(user: User | null, roles: AppRole[] = []): HeaderUser | null {
  if (!user) return null;
  return {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    homeHref: pickHome(roles),
  };
}
