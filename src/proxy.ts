import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Convención "proxy" de Next.js 16 (reemplaza al antiguo "middleware").
export async function proxy(request: NextRequest) {
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
