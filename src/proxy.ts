import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { safeNext } from "@/lib/auth/roles";
import { hrefSignup, PARAM_YA_TENGO_CUENTA } from "@/components/auth/auth-links";

// Convención "proxy" de Next.js 16 (reemplaza al antiguo "middleware").
export async function proxy(request: NextRequest) {
  /*
   * El rebote `/login?next=` → `/signup` (M-05, ver `(auth)/login/page.tsx`)
   * se hace AQUÍ, como un 307 de verdad. Hecho con `redirect()` en la página
   * llegaba tarde: `(auth)/loading.tsx` envuelve la página en Suspense, el
   * shell ya ha salido por el cable y Next tiene que redirigir desde el
   * cliente, a mitad de hidratar. Ahí el router de Next 16 revienta con React
   * #310 («Rendered more hooks than during the previous render») y el usuario
   * ve la pantalla de error en vez del alta. Visto en Sentry/PostHog el
   * 24/25-sep, entrando desde enlaces a `/chat/…` y `/room/…` sin sesión.
   */
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/login" && !searchParams.get(PARAM_YA_TENGO_CUENTA)) {
    const destino = safeNext(searchParams.get("next"), "");
    if (destino) {
      return NextResponse.redirect(new URL(hrefSignup(destino), request.url));
    }
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Aplica a todas las rutas EXCEPTO:
     * - _next/static, _next/image (assets de Next)
     * - favicon.ico
     * - archivos estáticos de imagen, video y tipografía
     *
     * ⚠️ El .mp4 faltaba, y no era gratis: el fondo del hero se añadió el
     * 12-ago y nadie volvió aquí, así que CADA petición del video —y el móvil
     * lo pide por trozos, con Range— ejecutaba `updateSession()`, con su
     * `getClaims()` y su posible refresco contra Supabase Auth por delante del
     * primer byte. Y la respuesta salía con `Set-Cookie`, que la vuelve
     * incacheable para cualquier caché compartida: el CDN no guardaba nada.
     * Ninguna ruta de la app termina en estas extensiones, así que no se afloja
     * ninguna guarda de sesión.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm|m4v|mov|woff2?)$).*)",
  ],
};
