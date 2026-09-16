import { ConfirmarForm } from "./confirmar-form";

export const metadata = { title: "Confirma tu cuenta · Enséñame Ya" };

/**
 * AU · «la pantalla que dejaste abierta» del correo de alta.
 *
 * Se llega aquí desde `signup-form` cuando el alta espera confirmación por
 * correo (prod), o abriendo la URL directamente. El correo trae un código de 8
 * dígitos y esta pantalla lo canjea con `verifyOtp` — la salida cross-device
 * que el enlace PKCE no da (todo el porqué, en `confirmar-form.tsx`).
 *
 * Cuelga de `(auth)`, cuyo layout hace `requireGuest()`: un usuario sin
 * confirmar NO tiene sesión, así que pasa; uno que ya entró se va a su home.
 * Sin guarda propia y sin datos: el correo lo pone el cliente desde
 * `sessionStorage` o a mano, nunca la URL.
 */
export default function ConfirmarSignupPage() {
  return (
    <div className="rounded-[20px] border bg-card p-10 shadow-sm">
      <h1 className="text-center text-[26px] font-bold tracking-tight">
        Confirma tu cuenta
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Escribe el código que te enviamos por correo para activarla.
      </p>

      <div className="mt-6">
        <ConfirmarForm />
      </div>
    </div>
  );
}
