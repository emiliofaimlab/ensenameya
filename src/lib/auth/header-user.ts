import type { User } from "@supabase/supabase-js";

import type { HeaderUser } from "@/components/layout/site-header";

/** Reduce el `User` de Supabase a lo que el header necesita (nada sensible). */
export function toHeaderUser(user: User | null): HeaderUser | null {
  if (!user) return null;
  return {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
  };
}
