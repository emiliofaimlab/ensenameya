import { AuthShell } from "@/components/layout/auth-shell";

// ponytail: mismo shell que (auth)/layout pero SIN requireGuest — el paso
// /reset/update corre con una sesión de recuperación activa y requireGuest lo
// expulsaría a su home.
export default function RecoveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthShell className="max-w-[420px]">{children}</AuthShell>;
}
