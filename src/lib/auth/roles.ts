import type { Database } from "@/lib/database.types";
import { PANEL_COOKIE, type Panel } from "@/lib/panel";

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
 *
 * Con `opts.panel` (la cookie `ey-panel`) manda el último panel visitado, no el
 * rango: si vale para esta persona, ahí vuelve.
 */
export function pickHome(
  roles: AppRole[],
  opts?: {
    /**
     * Tiene fila en `tutor_profiles`. Hace falta porque el ROL `tutor` solo se
     * concede al APROBAR (`20260714120000`), así que quien está en revisión no
     * lo tiene todavía y aterrizaba en el panel de alumno — justo el panel que
     * no le sirve. Ser tutor, a efectos de a dónde entras, es haber empezado.
     */
    esTutor?: boolean;
    /**
     * Último panel visitado (cookie `ey-panel`, la escribe el proxy). Manda
     * sobre la prioridad de rol: quien administra pero estaba enseñando vuelve
     * a `/tutor`. Se valida contra los permisos reales —misma comprobación que
     * `panel-items.ts`—, así que una cookie manipulada no abre nada: como mucho
     * cae al default de siempre.
     */
    panel?: Panel | null;
  },
): string {
  const esTutor = roles.includes("tutor") || Boolean(opts?.esTutor);
  if (opts?.panel === "admin" && roles.includes("admin")) return ROLE_HOME.admin;
  if (opts?.panel === "tutor" && esTutor) return ROLE_HOME.tutor;
  if (opts?.panel === "alumno") return ROLE_HOME.alumno;

  if (roles.includes("admin")) return ROLE_HOME.admin;
  if (esTutor) return ROLE_HOME.tutor;
  return ROLE_HOME.alumno;
}

/**
 * La cookie `ey-panel` leída **en cliente**: no es `httpOnly` (la escribe el
 * proxy sin esa opción) porque no es un secreto, es de qué panel venías. Mismo
 * patrón que `refDeCookie()` en `signup-form`. En servidor se lee del `cookies()`
 * de Next, así que aquí solo interesa el caso navegador.
 */
export function panelDeCookie(): Panel | null {
  if (typeof document === "undefined") return null;
  const valor = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${PANEL_COOKIE}=`))
    ?.slice(PANEL_COOKIE.length + 1);
  return valor === "alumno" || valor === "tutor" || valor === "admin"
    ? valor
    : null;
}

/**
 * Paneles del switch del menú de cuenta (acuerdo del 17-jul, ampliado el
 * 24-jul): **Aprender y Enseñar salen siempre** con sesión. "Enseñar" es la
 * puerta de entrada a ser tutor, no un privilegio: /tutor ya resuelve la
 * cascada solo (sin perfil → onboarding vía `requireTutorProfile`; pendiente →
 * dashboard con el aviso "en revisión"; aprobado → panel normal).
 * "Administrar" sí exige el rol: no es un flujo al que un usuario se apunta.
 */
export function panelsFor(roles: AppRole[]): { href: string; label: string }[] {
  return [
    { href: ROLE_HOME.alumno, label: "Aprender" },
    { href: ROLE_HOME.tutor, label: "Enseñar" },
    ...(roles.includes("admin")
      // "Admin", no "Administrar": con tres paneles el switch se queda sin
      // ancho en el menú de cuenta, y es la misma palabra que la píldora del
      // header (24-jul).
      ? [{ href: ROLE_HOME.admin, label: "Admin" }]
      : []),
  ];
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
