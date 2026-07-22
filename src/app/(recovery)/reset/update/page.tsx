import Link from "next/link";

import { UpdatePasswordForm } from "./update-form";

export const metadata = { title: "Nueva contraseña · Enséñame Ya" };

/**
 * US-103 (SCR-AU03, estado 2) — Fijar la nueva contraseña. Se llega aquí con
 * una sesión de recuperación ya establecida por /auth/callback (AU04). Si el
 * enlace expiró no hay sesión y `updateUser` falla → el formulario invita a
 * pedir otro.
 */
export default function ResetUpdatePage() {
  return (
    <div className="rounded-[20px] border bg-card p-9 shadow-sm">
      <h1 className="text-center text-2xl font-bold tracking-tight">
        Crea una nueva contraseña
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Tu enlace es válido. Define una contraseña segura para tu cuenta.
      </p>

      <div className="mt-6">
        <UpdatePasswordForm />
      </div>

      <p className="mt-6 text-center">
        <Link
          href="/login"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Volver a iniciar sesión
        </Link>
      </p>
    </div>
  );
}
