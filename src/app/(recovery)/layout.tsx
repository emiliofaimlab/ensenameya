import Link from "next/link";

// ponytail: mismo shell centrado que (auth)/layout pero SIN requireGuest — el
// paso /reset/update corre con una sesión de recuperación activa y requireGuest
// lo expulsaría a su home. No merece un componente compartido por ~10 líneas.
export default function RecoveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-muted/30 px-4 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Enséñame Ya
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
