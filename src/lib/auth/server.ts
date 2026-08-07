import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { TZ_COOKIE } from "@/lib/tz";
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
  /**
   * Nombre y foto de `profiles`, para el menú de cuenta. Salen de la consulta
   * que ya se hacía. El metadata de Auth NO sirve: viaja dentro del JWT, así
   * que se queda con lo que hubiera al emitirlo (y hay altas que nunca lo
   * escriben) — por eso a algunas cuentas les salía el correo.
   */
  fullName: string | null;
  avatarPath: string | null;
};

/** Lee el usuario validado (auth server), sus roles y el flag de onboarding. */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const empty = { fullName: null, avatarPath: null };
  if (!user)
    return { user: null, roles: [], onboardingComplete: false, ...empty };

  // RLS ya limita a las filas propias; los filtros son explícitos para leer la
  // intención. Roles + flag de onboarding en paralelo.
  const [{ data: roleRows }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("onboarding_complete, full_name, avatar_path")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return {
    user,
    roles: (roleRows ?? []).map((r) => r.role),
    onboardingComplete: profile?.onboarding_complete ?? false,
    fullName: profile?.full_name ?? null,
    avatarPath: profile?.avatar_path ?? null,
  };
}

/** Usuario actual o `null` (sin redirección). */
export async function getUser(): Promise<User | null> {
  return (await getSessionContext()).user;
}

/**
 * Zona horaria IANA del usuario (`profiles.timezone`, la que fijó en el
 * onboarding). Para formatear horas en componentes **server**: sin ella el SSR
 * usa la tz del servidor —UTC— y no la del usuario (bug R24-12 / RN-01/02).
 * `cache()` la memoiza por request: aunque varios sitios la pidan, una consulta.
 * Sin sesión → "UTC" (el llamador puede preferir la del navegador en cliente).
 */
export const getUserTimezone = cache(async (): Promise<string> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "UTC";
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  return data?.timezone ?? "UTC";
});

/**
 * Zona horaria del **visitante**, tenga sesión o no (R24-22): la del perfil si
 * está identificado; si no, la que dejó el navegador en la cookie `ey-tz`
 * (`TimezoneSync`). "UTC" solo en el primer render de un anónimo, antes de que
 * la cookie exista.
 *
 * Es la que deben usar las pantallas **públicas** con horarios: un visitante en
 * Venezuela tiene que ver la clase de un tutor de México en su propia hora.
 */
export const getViewerTimezone = cache(async (): Promise<string> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    if (data?.timezone) return data.timezone;
  }
  const jar = await cookies();
  const fromBrowser = jar.get(TZ_COOKIE)?.value;
  return fromBrowser ? decodeURIComponent(fromBrowser) : "UTC";
});

/** Roles del usuario actual (vacío si anónimo). */
export async function getUserRoles(): Promise<AppRole[]> {
  return (await getSessionContext()).roles;
}

/**
 * Exige sesión. Si no hay, redirige a /login conservando el destino previo
 * (`?next=`, SCR-AU01). Devuelve el contexto con `user` no nulo.
 */
export async function requireUser(): Promise<
  { user: User } & Omit<SessionContext, "user">
> {
  const ctx = await getSessionContext();
  if (!ctx.user) {
    const next = await currentPath();
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  // US-201 / RN-44: onboarding obligatorio antes de usar el área autenticada.
  // `/tutor/onboarding` también vale: recoge los mismos básicos (nombre, zona
  // horaria, teléfono) y marca `onboarding_complete` al guardarlos, así que
  // obligar a pasar antes por el de alumno sería pedir dos veces lo mismo.
  const path = await currentPath();
  const enAlgunOnboarding =
    path === "/onboarding" || path === "/tutor/onboarding";
  if (!ctx.onboardingComplete && !enAlgunOnboarding) {
    redirect(`/onboarding?next=${encodeURIComponent(path)}`);
  }
  return { ...ctx, user: ctx.user };
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
