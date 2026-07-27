import { headers } from "next/headers";

import { requireUser } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { AdminFooter } from "@/components/layout/admin-footer";
import { ChatLauncher } from "@/components/chat/chat-launcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Área autenticada: sin sesión → /login?next=… (SCR-AU01).
  const { user, roles } = await requireUser();

  // AL01/TU01: durante el onboarding el header va desnudo (sin Panel ni menú
  // de cuenta) y solo ofrece "Guardar y salir". En /admin el header lleva la
  // píldora negra "Admin" (AD02). La ruta llega en el header `x-pathname` que
  // inyecta el proxy — un layout no la conoce de otro modo.
  const path = (await headers()).get("x-pathname") ?? "";
  const onboarding = path.endsWith("/onboarding");
  const admin = path === "/admin" || path.startsWith("/admin/");

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader
        user={toHeaderUser(user, roles)}
        onboarding={onboarding}
        admin={admin}
      />
      <main className="flex-1">{children}</main>
      {/* Bandeja de chat flotante (R24-21). En admin no: no participa en los
          hilos (RLS por participantes) y no tendría conversaciones. */}
      {admin ? null : <ChatLauncher />}
      {admin ? <AdminFooter /> : <SiteFooter />}
    </div>
  );
}
