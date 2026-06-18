import Link from "next/link";

import { requireGuest } from "@/lib/auth/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Quien ya tiene sesión no debería ver login/registro: a su home.
  await requireGuest();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-muted/30 px-4 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Enséñame Ya
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
