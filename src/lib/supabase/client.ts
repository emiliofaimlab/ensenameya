import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/**
 * Cliente de Supabase para el NAVEGADOR (Client Components).
 * Usa la ANON key (pública) y queda sujeto a las políticas RLS (Doc 3).
 *
 * ⚠️ `detectSessionInUrl` viene ENCENDIDO por defecto en `@supabase/ssr`, y no
 * es un detector pasivo: el constructor lanza `initialize()`, que ve el `?code=`
 * de la URL, lo CANJEA él solo y borra el `code_verifier` al terminar. Quien
 * quiera canjear a mano tiene que apagarlo — `exchangeCodeForSession()` empieza
 * con `await this.initializePromise`, así que llega SIEMPRE segundo y SIEMPRE se
 * encuentra sin verifier. Devolvía error con la sesión ya creada, y AU04 lo leía
 * como "falló Google" y rebotaba a `/login?error=oauth`; desde ahí `requireGuest`
 * volvía a redirigir al home. Tres redirecciones de servidor encadenadas dentro
 * de una navegación de cliente: eso era la pantalla en blanco que había que
 * refrescar a mano, y por eso solo la veía quien arrastraba un salto más
 * (usuario nuevo → `/onboarding`).
 *
 * Lo apaga SOLO `/auth/callback` (AU04), la única pantalla a la que llega un
 * `code`.
 */
export function createClient(opciones?: { detectSessionInUrl?: boolean }) {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // `undefined` cae al default de la librería (`?? isBrowser()`), así que los
    // otros 29 llamadores no se enteran de que este parámetro existe.
    { auth: { detectSessionInUrl: opciones?.detectSessionInUrl } },
  );
}
