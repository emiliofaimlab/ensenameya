import { getSessionContext } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { TimezoneSync } from "@/components/layout/timezone-sync";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Roles además del usuario: el header necesita saber a qué panel enlazar.
  const { user, roles } = await getSessionContext();
  return (
    <div className="flex min-h-svh flex-col">
      {/* Deja la tz del navegador en cookie: los horarios públicos se pintan en
          la hora del visitante aunque no tenga sesión (R24-22). */}
      <TimezoneSync />
      <SiteHeader user={toHeaderUser(user, roles)} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
