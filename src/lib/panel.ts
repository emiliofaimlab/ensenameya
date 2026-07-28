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

/** Panel al que pertenece una ruta, o `null` si es compartida o pública. */
export function panelFromPath(pathname: string): Panel | null {
  // El asistente no cuenta: entrar a "Enseñar" sin ser tutor todavía no debe
  // dejarte el menú de tutor pegado en el resto de pantallas.
  if (pathname.endsWith("/onboarding")) return null;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/tutor" || pathname.startsWith("/tutor/")) return "tutor";
  if (pathname === "/app" || pathname.startsWith("/reservas")) return "alumno";
  return null;
}
