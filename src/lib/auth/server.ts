import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { pickHome, type AppRole } from "./roles";

/**
 * Guardas de ruta por rol (Doc 3), reutilizables en Server Components,
 * Route Handlers y Server Actions. Todo pasa por RLS (cliente ANON + sesión);
 * el `service_role` jamás se usa aquí.
 */

type SessionContext = {
  user: User | null;
  roles: AppRole[];
  onboardingComplete: boolean;
};

/** Lee el usuario validado (auth server), sus roles y el flag de onboarding. */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, roles: [], onboardingComplete: false };

  // RLS ya limita a las filas propias; los filtros son explícitos para leer la
  // intención. Roles + flag de onboarding en paralelo.
  const [{ data: roleRows }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("onboarding_complete")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return {
    user,
    roles: (roleRows ?? []).map((r) => r.role),
    onboardingComplete: profile?.onboarding_complete ?? false,
  };
}

/** Usuario actual o `null` (sin redirección). */
export async function getUser(): Promise<User | null> {
  return (await getSessionContext()).user;
}

/** Roles del usuario actual (vacío si anónimo). */
export async function getUserRoles(): Promise<AppRole[]> {
  return (await getSessionContext()).roles;
}

/**
 * Exige sesión. Si no hay, redirige a /login conservando el destino previo
 * (`?next=`, SCR-AU01). Devuelve el contexto con `user` no nulo.
 */
export async function requireUser(): Promise<{ user: User; roles: AppRole[] }> {
  const ctx = await getSessionContext();
  if (!ctx.user) {
    const next = await currentPath();
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  // US-201 / RN-44: onboarding obligatorio antes de usar el área autenticada.
  const path = await currentPath();
  if (!ctx.onboardingComplete && path !== "/onboarding") {
    redirect(`/onboarding?next=${encodeURIComponent(path)}`);
  }
  return { user: ctx.user, roles: ctx.roles };
}

/**
 * Exige NO tener sesión (login/registro). Si ya hay sesión, manda a su home.
 */
export async function requireGuest(): Promise<void> {
  const ctx = await getSessionContext();
  if (ctx.user) redirect(pickHome(ctx.roles));
}

/**
 * Exige un rol concreto. Sin sesión → /login; con sesión pero sin el rol →
 * su propio home (no se filtra que la ruta existía).
 */
export async function requireRole(
  role: AppRole,
): Promise<{ user: User; roles: AppRole[] }> {
  const ctx = await requireUser();
  if (!ctx.roles.includes(role)) redirect(pickHome(ctx.roles));
  return ctx;
}

/** Ruta actual, leída del header `x-pathname` que inyecta el proxy. */
async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/app";
}
