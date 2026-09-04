import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { urlDeConexionPaypal } from "@/lib/payments/paypal-provider";
import { siteUrl } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

/**
 * LA IDA DE «INICIAR SESIÓN CON PAYPAL».
 *
 * Es una ruta y no un enlace pintado en la página por UNA razón: el `state`.
 * Hay que generarlo, dejarlo en una cookie y mandarlo a PayPal en la misma
 * operación; un enlace estático no puede poner cookies, y sin `state` el
 * callback aceptaría un `code` traído por cualquiera.
 *
 * ⚠️ POST y no GET: manda al tutor a un flujo de autorización, así que un
 * prefetch del router no debe dispararlo.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const state = randomUUID();
  const url = urlDeConexionPaypal({
    returnUrl: `${siteUrl()}/api/tutor/paypal-connect/callback`,
    state,
  });
  if (!url) return NextResponse.json({ error: "falta PAYPAL_CLIENT_ID" }, { status: 503 });

  const res = NextResponse.json({ url });
  // Corta de vida y del propio sitio: solo tiene que sobrevivir al viaje.
  // `lax` y no `strict` porque la vuelta llega desde paypal.com; con `strict`
  // el navegador no la mandaría y ningún alta cuadraría nunca.
  res.cookies.set("ey-paypal-state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 900,
  });
  return res;
}
