/**
 * ⚠️ Reenvío temporal. El formulario de alta se mudó a
 * `src/components/auth/signup-form.tsx` porque desde M-05 tiene DOS carcasas:
 * esta ruta y el modal (`SignupDialog`), y un componente compartido no puede
 * vivir dentro de la carpeta de una sola de ellas.
 *
 * Este archivo solo existe para no romper imports en vuelo; se puede borrar en
 * cuanto no quede ninguno (`grep -rn "signup/signup-form" src/`).
 */
export { SignupForm } from "@/components/auth/signup-form";
