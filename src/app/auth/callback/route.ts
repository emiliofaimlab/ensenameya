import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { pickHome, safeNext, type AppRole } from "@/lib/auth/roles";

/**
 * AU04 — Callback de OAuth / confirmación de correo.
 * Intercambia el `code` (PKCE) por sesión y enruta al destino previo (`next`)
 * o al home por rol. Cualquier fallo vuelve a /login con un aviso genérico.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  // Si viene un destino interno seguro, gana; si no, home por rol.
  let dest = safeNext(next, "");
  if (!dest) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data } = user
      ? await supabase.from("user_roles").select("role").eq("user_id", user.id)
      : { data: [] };
    dest = pickHome((data ?? []).map((r) => r.role as AppRole));
  }

  return NextResponse.redirect(`${origin}${dest}`);
}
