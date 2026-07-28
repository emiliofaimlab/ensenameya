import { requireUser } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { SiteHeader } from "@/components/layout/site-header";
import { AppChrome } from "@/components/layout/app-chrome";
import { ChatLauncher } from "@/components/chat/chat-launcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Área autenticada: sin sesión → /login?next=… (SCR-AU01).
  const { user, roles, fullName, avatarPath } = await requireUser();

  // El modo de la ruta (asistente AL01/TU01 con "Guardar y salir", admin con su
  // píldora y su pie) NO se decide aquí: este layout se renderiza una vez y se
  // reutiliza al navegar, así que el modo se quedaba congelado en el primero
  // que tocara. Lo miran el header y `AppChrome`, que son de cliente y sí ven
  // la ruta actual.
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader user={toHeaderUser(user, roles, { fullName, avatarPath })} />
      <main className="flex-1">{children}</main>
      {/* Bandeja de chat flotante (R24-21). */}
      <AppChrome chat={<ChatLauncher />} />
    </div>
  );
}
