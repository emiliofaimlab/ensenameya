import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { PANEL_COOKIE, panelFromPath } from "@/lib/panel";

/**
 * Refresca la sesión de Supabase en cada request y la propaga a las cookies de
 * la respuesta. Patrón oficial de @supabase/ssr para Next.js App Router.
 */
export async function updateSession(request: NextRequest) {
  // Expone la ruta actual a los Server Components (guardas de rol → ?next=).
  request.headers.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: no insertar lógica entre createServerClient y getUser().
  // getUser() valida el token contra el servidor de Auth y renueva la sesión.
  await supabase.auth.getUser();

  // Último panel visitado: lo leen las pantallas compartidas (/pagos, /account)
  // para enseñar el menú del panel del que vienes. Solo decide el menú, así que
  // no necesita ser httpOnly ni de sesión larga.
  const panel = panelFromPath(request.nextUrl.pathname);
  if (panel) {
    supabaseResponse.cookies.set(PANEL_COOKIE, panel, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return supabaseResponse;
}
