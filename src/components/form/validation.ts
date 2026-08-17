/**
 * Reglas de validación compartidas por los formularios de auth y de cuenta.
 *
 * Existen para que el mensaje sea NUESTRO (RV-14): el del navegador lo escribe
 * el sistema operativo —sale en inglés si el equipo está en inglés, aunque la
 * app esté en español—, aparece en un globo que los lectores de pantalla no
 * anuncian de forma fiable y desaparece solo. Aquí el texto se pinta bajo el
 * campo, en español, y se ata al input con `aria-describedby`.
 */

/**
 * RV-12 · Mínimo de contraseña. Eran 6.
 *
 * ⚠️ **Sin máximo a propósito**: un tope corto rompe a los gestores de
 * contraseñas y las cuentas de prueba de dev usan una de 12.
 *
 * ⚠️ El mínimo que MANDA es el del servidor de Auth de Supabase. Mientras siga
 * en 6 en su panel, esto solo frena al navegador: un `signUp` programático
 * seguiría creando cuentas con 6 caracteres. Es una tarea de configuración, no
 * de código (ver el resumen del carril).
 */
export const PASSWORD_MIN = 8;

/** Mensaje de error de una contraseña nueva, o `null` si vale. */
export function passwordError(password: string): string | null {
  if (!password) return "Escribe una contraseña.";
  if (password.length < PASSWORD_MIN)
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  return null;
}

/**
 * Mensaje de error de un correo, o `null` si vale. La comprobación es
 * deliberadamente laxa —algo@algo.algo—: quien valida de verdad es el servidor
 * de Auth, y una regex estricta rechaza direcciones legítimas.
 */
export function emailError(email: string): string | null {
  const valor = email.trim();
  if (!valor) return "Escribe tu correo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor))
    return "Ese correo no parece válido. Revísalo.";
  return null;
}

/** Mensaje de error de un campo obligatorio de texto, o `null` si vale. */
export function requiredError(valor: string, mensaje: string): string | null {
  return valor.trim() ? null : mensaje;
}

/**
 * `aria-describedby` de un campo: el error manda, pero la pista (si la hay) se
 * conserva — el lector de pantalla debe anunciar las dos cosas, no solo la
 * última. Devuelve `undefined` cuando no hay nada que describir, que es lo que
 * espera el atributo para no existir en el HTML.
 */
export function describedBy(
  ...ids: (string | false | null | undefined)[]
): string | undefined {
  const usables = ids.filter(Boolean) as string[];
  return usables.length > 0 ? usables.join(" ") : undefined;
}
