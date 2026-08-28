import { requireUser } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { listNotices } from "@/lib/notifications-server";
import { cartCount } from "@/lib/cart/resolve";
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
  // US-1203: la campana se pinta ya en el servidor, sin ida y vuelta extra.
  const notices = await listNotices(user.id);
  // EY-177 · el mismo contador que en lo público: el carrito es del navegador
  // (cookie), no de la sesión, así que cruzar de `(public)` a `(app)` no lo
  // pierde ni lo cambia.
  const carrito = await cartCount();

  // El modo de la ruta (asistente AL01/TU01 con "Guardar y salir", admin con su
  // píldora y su pie) NO se decide aquí: este layout se renderiza una vez y se
  // reutiliza al navegar, así que el modo se quedaba congelado en el primero
  // que tocara. Lo miran el header y `AppChrome`, que son de cliente y sí ven
  // la ruta actual.
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader
        user={toHeaderUser(user, roles, { fullName, avatarPath })}
        notices={notices}
        cartCount={carrito}
      />
      {/* Columna flexible: el fondo de cada pantalla lo pone ELLA, así que para
          que llegue hasta abajo tiene que poder estirarse. Sin esto, `main`
          crecía con `flex-1` pero el envoltorio de la pantalla se quedaba a la
          altura de su contenido y dejaba una franja blanca (visible en /app
          cuando el alumno aún no tiene reservas). */}
      <main className="flex flex-1 flex-col">{children}</main>
      {/* Bandeja de chat flotante (R24-21). */}
      <AppChrome chat={<ChatLauncher />} />
    </div>
  );
}
