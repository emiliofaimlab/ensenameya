import Link from "next/link";

import { ResetForm } from "./reset-form";

export const metadata = { title: "Recuperar contraseña · Enséñame Ya" };

/**
 * US-103 (SCR-AU03, estado 1) — Solicitar enlace de restablecimiento. Correo →
 * Supabase envía el enlace de recuperación (NTF-02, email por defecto de Auth).
 * El enlace vuelve por /auth/callback (AU04) con `next=/reset/update`.
 */
export default function ResetPage() {
  return (
    <div className="rounded-[20px] border bg-card p-9 shadow-sm">
      <h1 className="text-center text-2xl font-bold tracking-tight">
        Recupera tu contraseña
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Ingresa tu correo y te enviaremos un enlace para restablecerla.
      </p>

      <div className="mt-6">
        <ResetForm />
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
