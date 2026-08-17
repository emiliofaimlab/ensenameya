import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { PANEL_COOKIE, panelFromPath } from "@/lib/panel";
import { REFERRAL_COOKIE } from "@/lib/referral";

/**
 * Los dos asistentes de onboarding, a los que se llega SIEMPRE con `?next=…`.
 * Ver `rutaActual()`: son la excepción que se queda sin query.
 */
const ONBOARDINGS = new Set(["/onboarding", "/tutor/onboarding"]);

/**
 * M-10 · La ruta actual viaja CON su query.
 *
 * `requireUser()` (lib/auth/server.ts) arma el `?next=` del login con esta
 * cabecera. Mandaba solo el pathname, así que quien elegía horario sin sesión
 * en `/reservar/<id>?slot=…` volvía del login a la pantalla en blanco: el
 * horario que había elegido no llegaba nunca. `safeNext()` ya acepta cualquier
 * ruta interna, query incluida, así que no hay nada que aflojar ahí.
 *
 * ⚠️ Los dos onboardings se quedan con el pathname PELADO a propósito. Ese
 * mismo `requireUser()` decide "ya estoy dentro de un onboarding" comparando
 * esta cabecera con las cadenas `/onboarding` y `/tutor/onboarding`; como a
 * esas pantallas se entra justamente con `?next=…`, incluir la query rompería
 * la igualdad y el guarda se redirigiría a sí mismo para siempre, anidando un
 * `next` dentro de otro en cada vuelta.
 *
 * El valor es siempre ASCII: `URL#search` devuelve la query ya
 * percent-encoded, y una cabecera con bytes UTF-8 crudos reventaría en Node.
 */
function rutaActual(url: { pathname: string; search: string }): string {
  if (ONBOARDINGS.has(url.pathname)) return url.pathname;
  return url.pathname + url.search;
}

/**
 * Refresca la sesión de Supabase en cada request y la propaga a las cookies de
 * la respuesta. Patrón oficial de @supabase/ssr para Next.js App Router.
 */
export async function updateSession(request: NextRequest) {
  // Expone la ruta actual a los Server Components (guardas de rol → ?next=).
  request.headers.set("x-pathname", rutaActual(request.nextUrl));

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

  // US-1302 · el `?ref=` de Referral Factory puede llegar a CUALQUIER página
  // (el enlace que comparte el referidor suele apuntar al home, no a /signup).
  // Se guarda al vuelo para que siga vivo cuando el visitante se registre; sin
  // esto la atribución se pierde en silencio, que es la peor forma de perderla.
  const ref = request.nextUrl.searchParams.get("ref")?.trim();
  if (ref) {
    supabaseResponse.cookies.set(REFERRAL_COOKIE, ref.slice(0, 64), {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

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
