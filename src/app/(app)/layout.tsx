import { requireUser } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { cartCount } from "@/lib/cart/resolve";
import { listConversations } from "@/components/chat/conversations";
import { SiteHeader } from "@/components/layout/site-header";
import { AppChrome } from "@/components/layout/app-chrome";
import { ChatLauncher } from "@/components/chat/chat-launcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Área autenticada: sin sesión → /login?next=… (SCR-AU01).
  const { user, roles, fullName, avatarPath, notices, onboardingComplete } =
    await requireUser();
  // US-1203: la campana se pinta ya en el servidor, sin ida y vuelta extra.
  // EY-177 · el mismo contador que en lo público: el carrito es del navegador
  // (cookie), no de la sesión, así que cruzar de `(public)` a `(app)` no lo
  // pierde ni lo cambia.
  // Los dos JUNTOS: encadenados eran dos peldaños de latencia, y el segundo ni
  // siquiera va a la base — pero esperaba igual a que volviera el primero.
  // La burbuja de chat pide `listConversations()` desde dentro de `AppChrome`,
  // o sea al final del árbol: sin este empujón no arrancaba hasta que la
  // pantalla había terminado, y era un peldaño de ~200 ms en cada navegación.
  // Memoizada con `cache()`, así que la burbuja encuentra esta misma promesa.
  void listConversations().catch(() => {});

  // Los avisos ya vienen en `requireUser()` (`session_bootstrap`): eran una
  // consulta más, y encadenada, porque necesitaban el id de la sesión.
  const carrito = await cartCount();

  // El modo de la ruta (asistente AL01/TU01 con "Guardar y salir", admin con su
  // píldora y su pie) NO se decide aquí: este layout se renderiza una vez y se
  // reutiliza al navegar, así que el modo se quedaba congelado en el primero
  // que tocara. Lo miran el header y `AppChrome`, que son de cliente y sí ven
  // la ruta actual.
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader
        user={toHeaderUser(user, roles, {
          fullName,
          avatarPath,
          onboardingComplete,
        })}
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
