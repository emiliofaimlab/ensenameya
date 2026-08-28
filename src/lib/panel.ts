/**
 * De qué panel es una ruta, y en cuál estabas.
 *
 * `/pagos` y `/account` los comparten los tres perfiles, así que no pueden
 * deducir su menú de la ruta. Antes lo sacaban del rol, y ahí fallaba: el rol
 * `tutor` solo se concede **al aprobar** (US-1101), así que un tutor en revisión
 * entraba desde su panel y se encontraba el menú de alumno.
 *
 * El proxy deja el último panel visitado en la cookie `ey-panel` y estas
 * pantallas la leen. Es solo para pintar el menú: cada destino sigue teniendo
 * su propia guarda, así que una cookie manipulada no abre nada.
 */
export const PANEL_COOKIE = "ey-panel";

export type Panel = "alumno" | "tutor" | "admin";

/**
 * Las consulta también el header y el pie, **en cliente**: el layout de `(app)`
 * se renderiza una vez y se reutiliza al navegar, así que decidir el modo allí
 * dejaba el header del asistente ("Guardar y salir") pegado en el panel.
 */
export const isOnboardingRoute = (pathname: string) =>
  pathname.endsWith("/onboarding");

export const isAdminRoute = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

/** Panel al que pertenece una ruta, o `null` si es compartida o pública. */
export function panelFromPath(pathname: string): Panel | null {
  // El asistente no cuenta: entrar a "Enseñar" sin ser tutor todavía no debe
  // dejarte el menú de tutor pegado en el resto de pantallas.
  if (isOnboardingRoute(pathname)) return null;
  if (isAdminRoute(pathname)) return "admin";
  if (pathname === "/tutor" || pathname.startsWith("/tutor/")) return "tutor";
  // `/agendar` es del alumno como `/app` y `/reservas`: sin él, quien viniera
  // de ahí a `/pagos` o `/account` se llevaría el menú del panel anterior.
  if (
    pathname === "/app" ||
    pathname === "/agendar" ||
    pathname.startsWith("/reservas")
  )
    return "alumno";
  return null;
}
