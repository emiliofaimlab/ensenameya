import type { Database } from "@/lib/database.types";

/**
 * Helpers de rol **seguros para el navegador** (sin acceso a cookies/DB).
 * El tipo `AppRole` se deriva del enum real de la BD (Doc 3) para no
 * desincronizarse con `database.types.ts`.
 */
export type AppRole = Database["public"]["Enums"]["app_role"];

/** Home por defecto según rol (se acumulan; gana el más privilegiado). */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  tutor: "/tutor",
  alumno: "/app",
};

/**
 * Destino tras autenticarse: el rol más privilegiado manda (S-14, roles se
 * acumulan). En M0 sólo existe `alumno` (→ /app); /admin y /tutor llegan en
 * M2/M3, pero la prioridad ya queda cableada.
 */
export function pickHome(roles: AppRole[]): string {
  if (roles.includes("admin")) return ROLE_HOME.admin;
  if (roles.includes("tutor")) return ROLE_HOME.tutor;
  return ROLE_HOME.alumno;
}

/**
 * Sanea un `?next=` para evitar open-redirect: sólo rutas internas
 * (`/algo`), nunca `//host` ni URLs absolutas. Si no es válido, usa `fallback`.
 */
export function safeNext(
  next: string | null | undefined,
  fallback = "/app",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
