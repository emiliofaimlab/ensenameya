import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Recuperar contraseña · Enséñame Ya" };

/**
 * US-103 (SCR-AU03) — Solicitar enlace de restablecimiento. Correo → Supabase
 * envía el enlace de recuperación (NTF-02, email por defecto de Auth). El enlace
 * vuelve por /auth/callback (AU04) con `next=/reset/update`.
 */
export default function ResetPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">¿Olvidaste tu contraseña?</CardTitle>
        <CardDescription>
          Escribe tu correo y te enviamos un enlace para crear una nueva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetForm />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-foreground hover:underline"
        >
          Volver a iniciar sesión
        </Link>
      </CardFooter>
    </Card>
  );
}
