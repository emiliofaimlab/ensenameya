import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UpdatePasswordForm } from "./update-form";

export const metadata = { title: "Nueva contraseña · Enséñame Ya" };

/**
 * US-103 (SCR-AU03) — Fijar la nueva contraseña. Se llega aquí con una sesión
 * de recuperación ya establecida por /auth/callback (AU04). Si el enlace expiró
 * no hay sesión y `updateUser` falla → el formulario invita a pedir otro.
 */
export default function ResetUpdatePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Crea una contraseña nueva</CardTitle>
        <CardDescription>
          Escríbela dos veces para confirmar el cambio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UpdatePasswordForm />
      </CardContent>
    </Card>
  );
}
