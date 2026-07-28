/**
 * A qué "modo" pertenece una ruta del área autenticada. Vive aparte porque lo
 * consultan tanto el header como el pie, y **en cliente**: el layout de `(app)`
 * se renderiza una vez y se reutiliza al navegar, así que decidir el modo allí
 * dejaba el header del asistente ("Guardar y salir") pegado en el panel.
 */
export const isOnboardingRoute = (pathname: string) =>
  pathname.endsWith("/onboarding");

export const isAdminRoute = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");
