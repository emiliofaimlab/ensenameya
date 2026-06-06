import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Cliente de Supabase para el SERVIDOR (Server Components, Route Handlers,
 * Server Actions). Usa la ANON key + la sesión del usuario desde las cookies,
 * por lo que SIGUE sujeto a RLS (no es service_role).
 *
 * Para escritura financiera / saltarse RLS se usa la SERVICE_ROLE key dentro de
 * Edge Functions (S-15 / RN-26), nunca aquí en el render.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Invocado desde un Server Component: ignorable.
            // El proxy (src/proxy.ts) refresca la sesión.
          }
        },
      },
    },
  );
}
