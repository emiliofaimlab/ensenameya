import { getSessionContext } from "@/lib/auth/server";
import { toHeaderUser } from "@/lib/auth/header-user";
import { cartCount } from "@/lib/cart/resolve";
import { listConversations } from "@/components/chat/conversations";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ChatLauncher } from "@/components/chat/chat-launcher";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Roles además del usuario: el header necesita saber a qué panel enlazar.
  // US-1203: los avisos vienen en el MISMO viaje que roles y perfil
  // (`session_bootstrap`); sin sesión llegan vacíos y la campana ni se monta.
  const { user, roles, fullName, avatarPath, notices, onboardingComplete } =
    await getSessionContext();
  // EY-177 · el contador del carrito. Se lee de la cookie, no de la base, así
  // que no cuesta un viaje y funciona igual SIN sesión — que es el caso que
  // importa: un anónimo puede apuntar mentorías antes de registrarse.
  // Mismo empujón que en `(app)`: la burbuja la pide al final del árbol.
  if (user) void listConversations().catch(() => {});
  const carrito = await cartCount();
  return (
    <div className="flex min-h-svh flex-col">
      {/* `TimezoneSync` estaba aquí y subió al layout raíz (RV-03): montado solo
          en lo público, quien entraba directo a /app o /reservas nunca dejaba la
          cookie y el servidor le pintaba las horas en UTC. */}
      <SiteHeader
        user={toHeaderUser(user, roles, {
          fullName,
          avatarPath,
          onboardingComplete,
        })}
        notices={notices}
        cartCount={carrito}
      />
      {/* `flex flex-col` (y no solo `flex-1`) para que la pantalla de carga
          pueda estirarse hasta el pie con `flex-1`. Sin esto medía lo que
          midiera su contenido —el logo y poco más—, el pie se subía a media
          pantalla y bajaba de golpe al llegar el contenido: el salto que
          reportó el cliente. Los layouts de `(app)` y `(checkout)` ya eran así. */}
      <main className="flex flex-1 flex-col">{children}</main>
      {/* Solo se pinta con sesión (lo decide el propio launcher). */}
      <ChatLauncher />
      <SiteFooter />
    </div>
  );
}
