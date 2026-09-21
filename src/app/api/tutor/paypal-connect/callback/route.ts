import { NextResponse } from "next/server";

import { canjearCodigoPaypal } from "@/lib/payments/paypal-provider";
import { siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * LA VUELTA DE «INICIAR SESIÓN CON PAYPAL».
 *
 * El tutor viene de PayPal con un `code`. Se canjea, se le pregunta a PayPal
 * quién es, y se guarda su `payer_id` como destino de cobro.
 *
 * ⚠️ POR QUÉ ESTO NO ES UN FORMULARIO MÁS. El dato que se guarda aquí no lo
 * teclea nadie: lo firma PayPal. Eso es justo lo que arregla el fallo que se
 * midió el 4-sep —cuatro payouts a un correo, cuatro `UNCLAIMED`— porque un
 * correo puede estar sin confirmar y no hay forma de comprobarlo al guardarlo.
 *
 * ⚠️ Y EL `state` NO ES DECORATIVO. Sin él, cualquiera podría traer un `code`
 * de OTRA cuenta de PayPal y quedárselo pegado a la sesión de este tutor — o
 * sea, apuntar los payouts de otro a su propia cuenta. Se compara con la cookie
 * que puso el enlace de ida, y si no cuadra no se guarda nada.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const destino = `${siteUrl()}/tutor/payouts`;

  const volver = (params: Record<string, string>) =>
    NextResponse.redirect(`${destino}?${new URLSearchParams(params)}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);

  const fallo = url.searchParams.get("error");
  if (fallo) {
    /**
     * ⚠️ NO TODO LO QUE VUELVE CON `error` ES UN «CANCELÉ». Aquí se contestaba
     * `cancelado` a cualquier valor, y eso le echaba la culpa al tutor de una
     * negativa de PayPal.
     *
     * `access_denied` sí es él diciendo que no en la pantalla de PayPal. El
     * resto es PayPal negándose, y el que se ha visto de verdad —21-sep-2026,
     * un tutor con cuenta de empresa en Perú— es `invalid_scope`: la pantalla
     * que dice «esta acción no se admite para su país (ámbito no válido)»
     * porque su país o su tipo de cuenta no admite los permisos que pedimos.
     * Eso no se arregla reintentando, y llamarlo «cancelado» hace justo lo
     * contrario de lo que hace falta: invita a repetir el único camino que no
     * puede funcionar.
     *
     * ⚠️ Y ESTO SOLO SE VE CUANDO PAYPAL NOS DEVUELVE AL SITIO. En el caso de
     * Perú no lo hizo: enseñó su propia pantalla de error y ahí se acabó el
     * viaje, así que este `else` no llegó a ejecutarse nunca. Por eso la
     * tarjeta de PayPal avisa ADEMÁS antes de salir (`paypal-conectar.tsx`):
     * un mensaje a la vuelta no sirve si no hay vuelta.
     */
    return volver({ paypal: fallo === "access_denied" ? "cancelado" : "rechazado" });
  }
  if (!code) return volver({ paypal: "sin-codigo" });

  const esperado = req.headers.get("cookie")?.match(/ey-paypal-state=([^;]+)/)?.[1];
  if (!state || !esperado || state !== decodeURIComponent(esperado)) {
    return volver({ paypal: "state-invalido" });
  }

  try {
    const cuenta = await canjearCodigoPaypal(code, `${siteUrl()}/api/tutor/paypal-connect/callback`);

    const { error } = await createAdminClient().rpc("conectar_cuenta_paypal", {
      p_tutor: user.id,
      p_payer_id: cuenta.payerId,
      p_email: cuenta.email ?? "",
      p_holder: cuenta.nombre ?? "",
    });
    // Se mira el error (regla de oro 10): sin esto, una RPC caída se vería como
    // un alta correcta y el tutor creería que ya puede cobrar.
    if (error) {
      console.error("[paypal-connect] no se pudo guardar la cuenta:", error);
      return volver({ paypal: "no-guardado" });
    }

    const res = volver({ paypal: "conectado" });
    res.cookies.set("ey-paypal-state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e) {
    console.error("[paypal-connect] falló el canje:", e);
    return volver({ paypal: "error" });
  }
}
