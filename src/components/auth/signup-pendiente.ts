/**
 * El puente entre el registro y la pantalla de confirmación por código.
 *
 * Cuando un alta espera confirmación por correo (prod), `signup-form` no puede
 * pasarle el correo a `/signup/confirmar` por la URL: es un dato personal, y la
 * norma del proyecto es no meter datos personales en query params. Va por
 * `sessionStorage`, que es POR PESTAÑA — y eso es exactamente lo que se quiere:
 * «la pantalla que dejaste abierta» es la misma pestaña donde te registraste.
 *
 * ⚠️ El código NO viaja por aquí: se lee del correo en el móvil y se teclea en
 * esta pantalla. Aquí solo viaja lo que la pantalla necesita para NO volver a
 * pedírtelo (el correo) y para saber a dónde llevarte al confirmar (`next`).
 *
 * ⚠️ Todo en `try/catch`: `sessionStorage` peta en modo privado y en algunos
 * webviews. Si no está, la pantalla pide el correo a mano — no se queda muerta.
 */
const CLAVE = "ey-signup-pendiente";

export type SignupPendiente = { email: string; next?: string | null };

export function guardarSignupPendiente(v: SignupPendiente): void {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(v));
  } catch {
    // Sin sessionStorage la pantalla de confirmación pedirá el correo a mano.
  }
}

export function leerSignupPendiente(): SignupPendiente | null {
  try {
    const raw = sessionStorage.getItem(CLAVE);
    if (!raw) return null;
    const v = JSON.parse(raw) as SignupPendiente;
    return typeof v?.email === "string" ? v : null;
  } catch {
    return null;
  }
}

export function limpiarSignupPendiente(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Da igual: caduca con la pestaña.
  }
}
