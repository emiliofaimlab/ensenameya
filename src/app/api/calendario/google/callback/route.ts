import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canjearCodigo, cifrar, googleCalendarConfigurado, sincronizar } from "@/lib/google-calendar";

/** Vuelta de Google: guarda el refresh token (cifrado) y vuelca las sesiones
 *  futuras del usuario, para que no haga falta esperar al siguiente cambio. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const volver = (r: string) => {
    const res = NextResponse.redirect(`${origin}/account?google=${r}`);
    res.cookies.delete({ name: "ey-gcal-state", path: "/api/calendario/google" });
    return res;
  };

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!googleCalendarConfigurado() || !code || !state || state !== req.cookies.get("ey-gcal-state")?.value) {
    return volver("error");
  }

  const { data } = await (await createClient()).auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(`${origin}/login?next=/account`);

  const canje = await canjearCodigo(code, origin);
  if (!canje) return volver("error");

  const { error } = await createAdminClient()
    .from("google_calendar_connections")
    .upsert({
      user_id: userId,
      refresh_token: cifrar(canje.refreshToken),
      google_email: canje.email,
      updated_at: new Date().toISOString(),
    });
  if (error) {
    console.error("google-calendar: no se guardó la conexión", error.message);
    return volver("error");
  }

  // El volcado inicial no bloquea la conexión: si falla, el siguiente cambio
  // de cada sesión la pone al día.
  await sincronizar(origin, { sesiones: null, usuario: userId }).catch((e) =>
    console.error("google-calendar: volcado inicial", e),
  );
  return volver("ok");
}
