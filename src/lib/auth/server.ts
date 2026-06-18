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
};

/** Lee el usuario validado (auth server) y sus roles en una sola pasada. */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, roles: [] };

  // RLS `user_roles_select_own` ya limita a las filas propias; el filtro es
  // explícito para que la intención se lea en el código.
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  return { user, roles: (data ?? []).map((r) => r.role) };
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
