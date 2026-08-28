import { getSessionContext } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { listNotices } from "@/lib/notifications-server";
import { cartCount } from "@/lib/cart/resolve";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ChatLauncher } from "@/components/chat/chat-launcher";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Roles además del usuario: el header necesita saber a qué panel enlazar.
  const { user, roles, fullName, avatarPath } = await getSessionContext();
  // US-1203: sin sesión no hay avisos que pedir (la campana ni se monta).
  const notices = user ? await listNotices(user.id) : [];
  // EY-177 · el contador del carrito. Se lee de la cookie, no de la base, así
  // que no cuesta un viaje y funciona igual SIN sesión — que es el caso que
  // importa: un anónimo puede apuntar mentorías antes de registrarse.
  const carrito = await cartCount();
  return (
    <div className="flex min-h-svh flex-col">
      {/* `TimezoneSync` estaba aquí y subió al layout raíz (RV-03): montado solo
          en lo público, quien entraba directo a /app o /reservas nunca dejaba la
          cookie y el servidor le pintaba las horas en UTC. */}
      <SiteHeader
        user={toHeaderUser(user, roles, { fullName, avatarPath })}
        notices={notices}
        cartCount={carrito}
      />
      <main className="flex-1">{children}</main>
      {/* Solo se pinta con sesión (lo decide el propio launcher). */}
      <ChatLauncher />
      <SiteFooter />
    </div>
  );
}
