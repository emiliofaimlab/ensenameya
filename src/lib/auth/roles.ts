import type { Database } from "@/lib/database.types";
import { PANEL_COOKIE, type Panel } from "../panel.ts";

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
  return panelValido(
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${PANEL_COOKIE}=`))
      ?.slice(PANEL_COOKIE.length + 1),
  );
}

/**
 * Valida un valor CRUDO de la cookie `ey-panel`.
 *
 * Existe aparte porque hay dos lectores: éste, de cliente, y el de servidor en
 * `lib/auth/server.ts`, que la saca de `cookies()`. Una cookie manipulada no
 * abre nada: `pickHome` vuelve a comprobar los permisos reales antes de
 * hacerle caso.
 */
export function panelValido(valor: string | null | undefined): Panel | null {
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
  /*
   * ⚠️ Se normaliza COMO LO HACE EL NAVEGADOR antes de decidir, no después.
   *
   * Verificado en vivo el 11-sep-2026: `/login?entrar=1&next=/\example.com`
   * + entrar con Google dejaba al usuario en `http://example.com/`. El filtro
   * de antes solo miraba `//`, y `"/\evil.com".startsWith("//")` es false —
   * pero al resolver la URL el navegador convierte `\` en `/`, así que eso es
   * `//evil.com`, o sea protocol-relative, o sea fuera del sitio. Y no hacía
   * falta ni un clic: lo ejecutaba el `router.replace()` del callback.
   *
   * Los tabuladores y los saltos de línea se borran por lo mismo: el navegador
   * los ignora al resolver, así que `/\t/evil.com` colaba igual.
   */
  const limpio = next.replace(/[\t\n\r]/g, "");
  if (!limpio.startsWith("/") || /^\/[/\\]/.test(limpio)) return fallback;
  return limpio;
}

/**
 * A qué asistente hay que mandar a alguien con el onboarding a medias, o `null`
 * si no tiene nada pendiente.
 *
 * ⚠️ Existe porque CUATRO sitios pintaban o calculaban «el panel de este
 * usuario» con `pickHome(roles)` a secas, y ninguno miraba el onboarding. Para
 * quien lo tiene pendiente eso apunta a `/app`, y `/app` responde con un
 * `redirect()` de SERVIDOR hacia el asistente. Verificado contra un build de
 * producción el 11-sep-2026: pulsar «Ir a mi panel» desde la home PÚBLICA
 * dejaba la pantalla en blanco y 102 peticiones al RSC en 5 segundos.
 *
 * (Curiosamente el mismo redirect DENTRO de `(app)` renderiza bien: lo que
 * rompe es cruzar de grupo de rutas y encontrarse el redirect a la vez. Por eso
 * el síntoma parecía caprichoso.)
 *
 * El reparto copia el de `requireUser()` a propósito, para que la barra de
 * navegación y el guarda no puedan contradecirse: quien se registró para
 * ENSEÑAR va a su asistente —`?start=1` entra directo al formulario, como
 * allí— y el resto al de alumno.
 */
export function destinoDeAsistente(
  onboardingComplete: boolean,
  intendedRole: unknown,
): string | null {
  if (onboardingComplete) return null;
  return intendedRole === "tutor" ? "/tutor/onboarding?start=1" : "/onboarding";
}
