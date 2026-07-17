import { requireUser } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Área autenticada: sin sesión → /login?next=… (SCR-AU01).
  const { user, roles } = await requireUser();
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader user={toHeaderUser(user, roles)} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
