import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { googleCalendarConfigurado, urlDeConsentimiento } from "@/lib/google-calendar";

/** «Conectar Google Calendar»: manda a la pantalla de permiso de Google. El
 *  `state` va en una cookie httpOnly y el callback exige que coincida (CSRF). */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!googleCalendarConfigurado()) return NextResponse.redirect(`${origin}/account`);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return NextResponse.redirect(`${origin}/login?next=/account`);

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(
    urlDeConsentimiento(origin, state, data.claims.email ?? undefined),
  );
  res.cookies.set("ey-gcal-state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/api/calendario/google",
    maxAge: 600,
  });
  return res;
}
