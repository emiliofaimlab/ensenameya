import { requireGuest } from "@/lib/auth/server";
import { AuthShell } from "@/components/layout/auth-shell";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Quien ya tiene sesión no debería ver login/registro: a su home.
  await requireGuest();

  return <AuthShell>{children}</AuthShell>;
}
