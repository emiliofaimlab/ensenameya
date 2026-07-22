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
 * Paneles a los que el usuario puede entrar, en orden de lectura
 * (aprender → enseñar → administrar). Alimenta el switch del menú de cuenta
 * (acuerdo de la reunión del 17-jul, 00:56:37): quien es alumno y tutor a la
 * vez tiene que poder cambiar de panel sin cerrar sesión.
 *
 * Los roles se ACUMULAN (S-14), así que esto es un filtro, no un `switch`.
 * Con un solo panel el switch no se pinta: no habría nada que elegir.
 */
export function panelsFor(roles: AppRole[]): { href: string; label: string }[] {
  const all: { role: AppRole; href: string; label: string }[] = [
    { role: "alumno", href: ROLE_HOME.alumno, label: "Aprender" },
    { role: "tutor", href: ROLE_HOME.tutor, label: "Enseñar" },
    { role: "admin", href: ROLE_HOME.admin, label: "Administrar" },
  ];
  return all.filter((p) => roles.includes(p.role)).map(({ href, label }) => ({ href, label }));
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
